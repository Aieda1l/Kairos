import {test,expect} from '@playwright/test';
import {prepareFixtureUser,waitForAppHydration} from './helpers';

test('established empty account stays on the dashboard',async({page,context})=>{
  await prepareFixtureUser(context);
  await page.goto('/sources');await waitForAppHydration(page);
  for(const name of ['Canvas','Gradescope','Ed']){
    const card=page.locator('section').filter({has:page.getByRole('heading',{name,exact:true})});
    await expect(card.getByText('Not connected',{exact:true})).toBeVisible();
  }
  await page.goto('/assignments');await waitForAppHydration(page);
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole('button',{name:/^View .* details$/})).toHaveCount(0);
  await page.goto('/upcoming');await waitForAppHydration(page);
  await expect(page).toHaveURL(/\/upcoming$/);
  const {state}=await (await context.request.get('/api/settings/onboarding')).json();
  expect(state.status).toBe('completed');
  await page.goto('/settings');await expect(page).toHaveURL(/\/settings$/);
});

test('new-user direct dashboard entry redirects to optional setup',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  await page.goto('/calendar');await waitForAppHydration(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading',{name:'Welcome to Kairos'})).toBeVisible();
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:false});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const install=page.getByRole('link',{name:'Install from Mozilla Add-ons'});
  await expect(install).toBeVisible();
  await expect(install).toHaveAttribute('href','https://addons.mozilla.org/en-US/firefox/addon/kairos-bridge/');
  await expect(install).toHaveAttribute('target','_blank');
  await expect(install).toHaveAttribute('rel','noreferrer');
  await expect(page.getByText(/awaiting review/)).toHaveCount(0);
});

test('two users retain independent setup progress and revisions',async({context,browser},testInfo)=>{
  const other=await browser.newContext({baseURL:testInfo.project.use.baseURL as string});
  try{
    await prepareFixtureUser(context,'alice','new');await prepareFixtureUser(other,'bob','new');
    const read=async(c:typeof context)=>(await (await c.request.get('/api/settings/onboarding')).json()).state;
    const alice=await read(context),bob=await read(other);
    expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'visit',step:'ed'},expectedRevision:alice.revision}})).ok()).toBe(true);
    expect(await read(other)).toEqual(bob);
    expect((await other.request.patch('/api/settings/onboarding',{data:{command:{type:'defer'},expectedRevision:bob.revision}})).ok()).toBe(true);
    expect(await read(context)).toMatchObject({status:'active',currentStep:'ed',revision:alice.revision+1});
    expect(await read(other)).toMatchObject({status:'deferred',currentStep:'timezone'});
    expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'finish'},expectedRevision:alice.revision}})).status()).toBe(409);
    expect((await read(context)).status).toBe('active');
  }finally{await other.close();}
});

test('denied Google Calendar consent returns to saved optional setup with recovery guidance',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  const {state}=await (await context.request.get('/api/settings/onboarding')).json();
  expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'visit',step:'calendars'},expectedRevision:state.revision}})).ok()).toBe(true);
  const start=await context.request.post('/api/calendars/google/start',{data:{returnTo:'/onboarding'}}),body=await start.json();
  const reason=body.message==='OAuth production origin must be https://mykairos.me.'?'origin_policy':body.message==='Google Calendar client configuration is missing.'?'client_configuration':'other';
  expect(start.ok(),`Synthetic calendar start: HTTP ${start.status()}, ${reason}`).toBe(true);
  const authorization=new URL(body.authorizationUrl),nonce=authorization.searchParams.get('state');expect(nonce).toBeTruthy();
  const denied=await context.request.get('/api/calendars/google/callback?error=access_denied&state='+encodeURIComponent(nonce!));
  expect(new URL(denied.url()).pathname).toBe('/onboarding');
  await page.goto(denied.url());await waitForAppHydration(page);
  await expect(page.getByText('Google Calendar authorization was not completed.',{exact:true})).toBeVisible();
  expect((await (await context.request.get('/api/settings/onboarding')).json()).state).toMatchObject({status:'active',currentStep:'calendars'});
  expect((await (await context.request.get('/api/calendars')).json()).connections).toEqual([]);
  await page.getByRole('button',{name:'Skip',exact:true}).click();await page.getByRole('button',{name:'Finish setup'}).click();
  await expect(page).toHaveURL(/\/upcoming$/);
});

test('failed Canvas replacement retains the connected feed and accepted assignments',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice');
  const accepted=await context.request.post('/api/sources/canvas/connect',{data:{feedUrl:'https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics?token=synthetic-working'}});
  expect(accepted.ok()).toBe(true);const connectionId=(await accepted.json()).connection.id;
  await page.goto('/upcoming');await waitForAppHydration(page);
  await expect(page.getByText('Fixture Homework').first()).toBeVisible();
  await page.goto('/sources');await waitForAppHydration(page);
  const card=page.locator('section').filter({has:page.getByRole('heading',{name:'Canvas',exact:true})});
  await card.getByLabel('Canvas calendar feed URL').fill('https://canvas.uw.edu/feeds/calendars/synthetic-invalid.ics?token=synthetic-replacement');
  const failed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sources/canvas/connect'&&response.request().method()==='POST');
  await card.getByRole('button',{name:'Connect Canvas',exact:true}).click();
  const rejected=await failed;
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).code).toBe('NETWORK_ERROR');
  await expect(card.getByText('Connected',{exact:true})).toBeVisible();
  await expect(page).toHaveURL(/\/sources$/);
  const synchronized=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sources/canvas/sync'&&response.request().method()==='POST');
  await card.getByRole('button',{name:'Sync Now',exact:true}).click();
  const synced=await synchronized;expect(synced.ok()).toBe(true);
  expect((await synced.json()).connectionId).toBe(connectionId);
  await expect(card.getByRole('button',{name:'Sync Now',exact:true})).toBeEnabled();
  await page.getByRole('link',{name:'Upcoming',exact:true}).click();await page.waitForURL('**/upcoming');
  await expect(page.getByText('Fixture Homework').first()).toBeVisible();
});
