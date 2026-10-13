import {test,expect} from '@playwright/test';
import {prepareFixtureUser,waitForAppHydration} from './helpers';
test('authenticated route guard overwrites spoofed path; optional setup defers, resumes and finishes without integrations',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice');
  for(const path of ['/upcoming','/assignments','/calendar','/sources','/settings']){
    const response=await context.request.get(path,{headers:{'x-kairos-pathname':'/onboarding'}});
    expect(response.status()).toBe(200);expect(new URL(response.url()).pathname).toBe('/onboarding');
  }
  const own=await context.request.get('/onboarding');expect(own.status()).toBe(200);expect(new URL(own.url()).pathname).toBe('/onboarding');
  expect((await context.request.get('/api/settings/submission-status')).ok()).toBe(true);
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:false});
  await page.goto('/onboarding');await waitForAppHydration(page);
  await page.getByLabel('Display timezone').fill('Asia/Kathmandu');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Firefox',exact:true})).toBeVisible();await expect(page.getByText(/awaiting review/)).toBeVisible();
  await page.getByRole('button',{name:'Check extension'}).click();await expect(page.getByText(/not detected.*continue/)).toBeVisible();
  await page.getByRole('button',{name:'Skip',exact:true}).click();
  const secret='https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=browser-memory-only';
  await page.getByLabel('Canvas calendar feed URL').fill(secret);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Canvas calendar feed URL')).toHaveValue(secret);expect(await page.content()).not.toContain('browser-memory-only');
  await page.getByLabel('Canvas calendar feed URL').fill('');
  await page.getByRole('button',{name:'Save for later'}).click();await page.waitForURL('**/upcoming');
  await page.goto('/onboarding');await waitForAppHydration(page);await page.getByRole('button',{name:'Resume setup'}).click();
  await expect(page.getByRole('heading',{name:'Canvas',exact:true})).toBeVisible();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Skip',exact:true}).click();
  await page.getByRole('button',{name:'Finish setup'}).click();await page.waitForURL('**/upcoming');
  const state=await (await context.request.get('/api/settings/onboarding')).json();expect(state.state.status).toBe('completed');
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:false});
  for(const path of ['/sources','/assignments','/settings']){
    const response=await context.request.get(path,{headers:{'x-kairos-pathname':'/onboarding'}});expect(response.status()).toBe(200);expect(new URL(response.url()).pathname).toBe(path);
  }
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('browser-memory-only');
  await page.setViewportSize({width:320,height:800});await page.goto('/onboarding');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('saved private Canvas candidate connects through admitted services and finishes with one source',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice');
  const read=await context.request.get('/api/settings/onboarding');const {state}=await read.json();
  expect((await context.request.patch('/api/settings/onboarding',{data:{command:{type:'visit',step:'canvas'},expectedRevision:state.revision}})).ok()).toBe(true);
  await page.goto('/onboarding');await waitForAppHydration(page);
  const input='https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics?token=private-synthetic-candidate';
  await page.getByLabel('Canvas calendar feed URL').fill(input);await page.getByRole('button',{name:'Save privately',exact:true}).click();
  await expect(page.getByText('Saved privately',{exact:true})).toBeVisible();
  await page.reload();await waitForAppHydration(page);await expect(page.getByLabel('Canvas calendar feed URL')).toHaveValue('');
  expect(await page.content()).not.toContain('private-synthetic-candidate');
  const metadata=await context.request.get('/api/settings/onboarding/draft');expect(await metadata.json()).toEqual({drafts:[{kind:'canvas',saved:true}]});
  await page.getByRole('button',{name:'Test connection',exact:true}).click();await expect(page.getByText(/1 assignments found/)).toBeVisible();
  await page.getByRole('button',{name:'Connect Canvas',exact:true}).click();await expect(page.getByText(/Canvas connected. You can continue/)).toBeVisible();
  await expect(page.getByText('Connected',{exact:true})).toBeVisible();
  expect(await (await context.request.get('/api/settings/onboarding/draft')).json()).toEqual({drafts:[]});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const opted=page.getByRole('checkbox',{name:'Enable browser submission refresh'});await expect(opted).not.toBeChecked();await opted.check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'Skip',exact:true}).click();
  await page.getByRole('button',{name:'Finish setup'}).click();await page.waitForURL('**/upcoming');
  await expect(page.getByText('Fixture Homework').first()).toBeVisible();
  expect(await (await context.request.get('/api/settings/submission-status')).json()).toEqual({enabled:true});
  expect(await (await context.request.get('/api/settings/onboarding/draft')).json()).toEqual({drafts:[]});
  expect(await (await context.request.get('/sources')).text()).not.toContain('private-synthetic-candidate');
});
test('deferred resume conflict preserves progress and exposes reload before resuming',async({page,context,browserName})=>{
  await prepareFixtureUser(context,browserName==='firefox'?'bob':'alice');
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
