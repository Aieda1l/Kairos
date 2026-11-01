import {test,expect} from '@playwright/test';
import {prepareFixtureUser,waitForAppHydration} from './helpers';
test('authenticated route guard overwrites spoofed path for new and completed users',async({context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  for(const path of ['/upcoming','/assignments','/calendar','/sources','/settings']){
    const response=await context.request.get(path,{headers:{'x-kairos-pathname':'/onboarding'}});
    expect(response.status()).toBe(200);expect(new URL(response.url()).pathname).toBe('/onboarding');
  }
  const own=await context.request.get('/onboarding');expect(own.status()).toBe(200);expect(new URL(own.url()).pathname).toBe('/onboarding');
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','completed');
  for(const path of ['/sources','/assignments','/settings']){
    const response=await context.request.get(path,{headers:{'x-kairos-pathname':'/onboarding'}});expect(response.status()).toBe(200);expect(new URL(response.url()).pathname).toBe(path);
  }
});
test('optional setup keeps private input in memory, defers, resumes and finishes without integrations',async({page,context,browserName})=>{
  const phaseTimeout=30_000;test.setTimeout(4*phaseTimeout);page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(30_000);
  await test.step("Initialize setup and verify the Firefox visit",async()=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  expect((await context.request.get('/api/settings/submission-status')).ok()).toBe(true);
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:false});
  await page.goto('/onboarding');await waitForAppHydration(page);
  await page.getByLabel('Display timezone').fill('Asia/Kathmandu');
  const progress=page.waitForResponse(response=>{
    const request=response.request();if(new URL(response.url()).pathname!=='/api/settings/onboarding'||request.method()!=='PATCH')return false;
    const body=request.postDataJSON();return body?.command?.type==='visit'&&body.command.step==='firefox';
  });
  await page.getByRole('button',{name:'Continue',exact:true}).click();expect((await progress).ok()).toBe(true);
  await expect(page.getByRole('heading',{name:'Firefox',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Install from Mozilla Add-ons'})).toHaveAttribute('href','https://addons.mozilla.org/en-US/firefox/addon/kairos-bridge/');
  await page.getByRole('button',{name:'Check extension'}).click();await expect(page.getByText(/not detected.*continue/)).toBeVisible();
  },{timeout:phaseTimeout});
  await test.step("Preserve private input and defer setup",async()=>{
  await page.getByRole('button',{name:'Skip',exact:true}).click();
  const secret='https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=browser-memory-only';
  await page.getByLabel('Canvas calendar feed URL').fill(secret);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Canvas calendar feed URL')).toHaveValue(secret);expect(await page.content()).not.toContain('browser-memory-only');
  await page.getByLabel('Canvas calendar feed URL').fill('');
  await page.getByRole('button',{name:'Save for later'}).click();await page.waitForURL('**/upcoming');
  },{timeout:phaseTimeout});
  await test.step("Resume Canvas and finish the remaining steps",async()=>{
  await page.goto('/onboarding');await waitForAppHydration(page);
  const resumed=page.waitForResponse(response=>{
    const request=response.request();if(new URL(response.url()).pathname!=='/api/settings/onboarding'||request.method()!=='PATCH')return false;
    return request.postDataJSON()?.command?.type==='resume';
  });
  await page.getByRole('button',{name:'Resume setup'}).click();
  const resumeResponse=await resumed;expect(resumeResponse.status()).toBe(200);
  expect((await resumeResponse.json()).state).toMatchObject({status:'active',currentStep:'canvas'});
  await expect(page.getByRole('heading',{name:'Canvas',exact:true})).toBeVisible();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Skip',exact:true}).click();
  await page.getByRole('button',{name:'Finish setup'}).click();await page.waitForURL('**/upcoming');
  },{timeout:phaseTimeout});
  await test.step("Verify settings, storage privacy and narrow layout",async()=>{
  const state=await (await context.request.get('/api/settings/onboarding')).json();expect(state.state.status).toBe('completed');
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:false});
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('browser-memory-only');
  await page.setViewportSize({width:320,height:800});await page.goto('/onboarding');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  },{timeout:phaseTimeout});
});
test('saved private Canvas candidate connects through admitted services and finishes with one source',async({page,context,browserName})=>{
  const phaseTimeout=30_000;test.setTimeout(4*phaseTimeout);page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(30_000);
  await test.step("Visit Canvas and save the candidate privately",async()=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  const read=await context.request.get('/api/settings/onboarding');const {state}=await read.json();
  expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'visit',step:'canvas'},expectedRevision:state.revision}})).ok()).toBe(true);
  await page.goto('/onboarding');await waitForAppHydration(page);
  const input='https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics?token=private-synthetic-candidate';
  await page.getByLabel('Canvas calendar feed URL').fill(input);await page.getByRole('button',{name:'Save privately',exact:true}).click();
  await expect(page.getByText('Saved privately',{exact:true})).toBeVisible();
  },{timeout:phaseTimeout});
  await test.step("Reload and verify private candidate is not exposed",async()=>{
  await page.reload();await waitForAppHydration(page);await expect(page.getByLabel('Canvas calendar feed URL')).toHaveValue('');
  expect(await page.content()).not.toContain('private-synthetic-candidate');
  const metadata=await context.request.get('/api/settings/onboarding/draft');expect(await metadata.json()).toEqual({drafts:[{kind:'canvas',saved:true}]});
  },{timeout:phaseTimeout});
  await test.step("Test and connect through admitted services",async()=>{
  await page.getByRole('button',{name:'Test connection',exact:true}).click();await expect(page.getByText(/1 assignments found/)).toBeVisible();
  await page.getByRole('button',{name:'Connect Canvas',exact:true}).click();await expect(page.getByText(/Canvas connected. You can continue/)).toBeVisible();
  await expect(page.getByText('Connected',{exact:true})).toBeVisible();
  expect(await (await context.request.get('/api/settings/onboarding/draft')).json()).toEqual({drafts:[]});
  },{timeout:phaseTimeout});
  await test.step("Opt in, finish and verify final privacy and state",async()=>{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const opted=page.getByRole('checkbox',{name:'Enable browser submission refresh'});await expect(opted).not.toBeChecked();await opted.check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'Skip',exact:true}).click();
  await page.getByRole('button',{name:'Finish setup'}).click();await page.waitForURL('**/upcoming');
  await expect(page.getByText('Fixture Homework').first()).toBeVisible();
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:true});
  expect(await (await context.request.get('/api/settings/onboarding/draft')).json()).toEqual({drafts:[]});
  expect(await (await context.request.get('/sources')).text()).not.toContain('private-synthetic-candidate');
  },{timeout:phaseTimeout});
});
test('deferred resume conflict preserves progress and exposes reload before resuming',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice','new');
  let {state}=await (await context.request.get('/api/settings/onboarding')).json();
  for(const command of [{type:'visit',step:'canvas'},{type:'defer'}]){
    const response=await context.request.patch('/api/settings/onboarding',{data:{command,expectedRevision:state.revision}});expect(response.ok()).toBe(true);({state}=await response.json());
  }
  await page.goto('/onboarding');await waitForAppHydration(page);
  expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'visit',step:'ed'},expectedRevision:state.revision}})).ok()).toBe(true);
  await page.getByRole('button',{name:'Resume setup'}).click();await expect(page.getByText(/progress changed/)).toBeVisible();
  await page.getByRole('button',{name:'Reload saved progress'}).click();await expect(page.getByRole('heading',{name:'Setup saved for later'})).toBeVisible();
  await page.getByRole('button',{name:'Resume setup'}).click();await expect(page.getByRole('heading',{name:'Ed',exact:true})).toBeVisible();
  expect((await (await context.request.get('/api/settings/onboarding')).json()).state.currentStep).toBe('ed');
});
