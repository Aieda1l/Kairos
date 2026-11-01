import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import {prepareFixtureUser,signInFixtureUser,waitForAppHydration} from './helpers';
import {guestSnapshotFixture} from '../helpers/guest-fixtures';
import {serializeGuestBackup} from '../../src/lib/guest/backup';
import {localData,privateData} from './fixtures/guest-lifecycle';
import {resetGuestAdmission} from './fixtures/guest-session';

const origin='http://127.0.0.1:3000';
async function importGuest(page:Page){
  const snapshot=guestSnapshotFixture();snapshot.assignments[0].title='Guest private homework';snapshot.preferences.timeZone='Asia/Tokyo';
  await page.goto('/guest/settings');
  await page.getByLabel('Import guest backup').setInputFiles({name:'guest.json',mimeType:'application/json',buffer:Buffer.from(serializeGuestBackup(snapshot,'2026-10-24T12:00:00.000Z'))});
  await page.getByRole('button',{name:'Replace local data'}).click();await expect(page.getByText(/Backup imported/)).toBeVisible();
}
async function accountState(context:BrowserContext){
  const result:Record<string,unknown>={};
  for(const path of ['/api/settings/timezone','/api/settings/calendar']){
    const response=await context.request.get(path);expect(response.ok()).toBe(true);result[path]=await response.json();
  }
  return result;
}

test('guest/account switching in one browser never transfers data',async({page,context})=>{
  const phaseTimeout=30_000;test.setTimeout(180_000);page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(30_000);
  const {forbidden,accountBodies,guestBefore}=await test.step("Import guest backup and save the private credential",async()=>{
  const forbidden:string[]=[],accountBodies:string[]=[];
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){forbidden.push(request.url());return route.abort();}
    if(url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/guest/'))accountBodies.push(request.postData()??'');
    return route.continue();
  });
  await resetGuestAdmission(context);await importGuest(page);
  await page.route('**/api/guest/sources/canvas/feed',route=>route.fulfill({json:{ok:true,schemaVersion:1,requestId:route.request().postDataJSON().requestId,checkedAt:new Date().toISOString(),assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}}}));
  await page.getByRole('link',{name:'Sources',exact:true}).click();
  await page.getByLabel('Canvas calendar feed URL').fill('https://canvas.uw.edu/feeds/calendars/guest-private-isolation.ics');
  await page.getByLabel('Remember Canvas credential on this device').check();await page.getByRole('button',{name:'Update Canvas credential'}).click();await expect(page.getByText(/A credential is available/)).toBeVisible();
  expect((await privateData(page)).credentials).toHaveLength(1);
  const guestBefore=await localData(page);
  return {forbidden,accountBodies,guestBefore};
  },{timeout:phaseTimeout});
  const {alice,aliceBefore}=await test.step("Prepare Alice and verify her account isolation",async()=>{
  // Account preparation is intentionally limited to this same-context isolation test.
  await prepareFixtureUser(context,'alice');
  const aliceSeed=await context.request.post('/api/test-fixtures/tenant-state');expect(aliceSeed.ok()).toBe(true);const alice=await aliceSeed.json();
  expect((await context.request.put('/api/settings/timezone',{data:{timeZone:'Europe/London'}})).ok()).toBe(true);
  const aliceBefore=await accountState(context);
  await page.goto('/assignments');await waitForAppHydration(page);await expect(page.getByText(alice.assignmentTitle).first()).toBeVisible();await expect(page.getByText('Guest private homework')).toHaveCount(0);
  return {alice,aliceBefore};
  },{timeout:phaseTimeout});
  await test.step("Reject missing guest capability and verify Alice's return to guest",async()=>{
  const withoutCapability=await context.request.post('/api/guest/sources/ed/courses',{headers:{origin},data:{schemaVersion:1,requestId:crypto.randomUUID(),token:'fixture-guest-ed-token-never-echo'}});
  expect(withoutCapability.status()).toBe(401);expect((await withoutCapability.json()).code).toBe('GUEST_SESSION_REQUIRED');
  await page.goto('/guest/settings');await expect(page.getByLabel('Display timezone')).toHaveValue('Asia/Tokyo');expect(await localData(page)).toEqual(guestBefore);

  },{timeout:phaseTimeout});
  const {bob,bobBefore}=await test.step("Prepare Bob and verify his account isolation",async()=>{
  await prepareFixtureUser(context,'bob');
  const bobSeed=await context.request.post('/api/test-fixtures/tenant-state');expect(bobSeed.ok()).toBe(true);const bob=await bobSeed.json();
  expect((await context.request.put('/api/settings/timezone',{data:{timeZone:'America/New_York'}})).ok()).toBe(true);
  const bobBefore=await accountState(context);
  await page.goto('/assignments');await waitForAppHydration(page);await expect(page.getByText(bob.assignmentTitle).first()).toBeVisible();await expect(page.getByText(alice.assignmentTitle)).toHaveCount(0);await expect(page.getByText('Guest private homework')).toHaveCount(0);
  return {bob,bobBefore};
  },{timeout:phaseTimeout});
  const bobCookie=await test.step("Verify Bob's return to guest and capture his session",async()=>{
  await page.goto('/guest/settings');expect(await localData(page)).toEqual(guestBefore);
  const bobCookie=(await context.cookies()).find(c=>c.name==='authjs.session-token');expect(bobCookie).toBeDefined();
  return bobCookie;
  },{timeout:phaseTimeout});
  const guestBeforeAccountDeletion=await test.step("Clear and reimport guest data while preserving Bob",async()=>{
  await page.getByRole('button',{name:'Clear guest data',exact:true}).click();await page.getByRole('button',{name:'Confirm clear guest data'}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();
  expect((await localData(page)).assignments).toEqual([]);expect(await accountState(context)).toEqual(bobBefore);expect((await context.cookies()).find(c=>c.name==='authjs.session-token')).toEqual(bobCookie);
  await page.goto('/assignments');await waitForAppHydration(page);await expect(page.getByText(bob.assignmentTitle).first()).toBeVisible();

  await importGuest(page);return await privateData(page);
  },{timeout:phaseTimeout});
  await test.step("Delete Bob without deleting guest data and return to Alice",async()=>{
  const deleted=await context.request.delete('/api/account',{data:{confirmation:'DELETE'}});expect(deleted.status()).toBe(204);
  expect((await context.request.get('/api/settings/timezone')).status()).toBe(401);
  expect(await privateData(page)).toEqual(guestBeforeAccountDeletion);
  await signInFixtureUser(context,'alice');expect(await accountState(context)).toEqual(aliceBefore);
  await page.goto('/assignments');await waitForAppHydration(page);await expect(page.getByText(alice.assignmentTitle).first()).toBeVisible();await expect(page.getByText(bob.assignmentTitle)).toHaveCount(0);
  },{timeout:phaseTimeout});
  await test.step("Sign out to guest and verify every final leak sentinel",async()=>{
  expect((await context.request.delete('/api/test-fixtures/session')).ok()).toBe(true);
  const bootstrap=await context.request.post('/api/guest/session',{headers:{origin},data:{schemaVersion:1,requestId:crypto.randomUUID(),turnstileToken:`fixture-guest-${crypto.randomUUID()}`}});expect(bootstrap.status()).toBe(200);
  expect((await context.cookies()).some(c=>c.name==='kairos-guest-sync-dev')).toBe(true);
  expect((await context.request.get('/api/settings/timezone')).status()).toBe(401);
  expect((await context.request.delete('/api/account',{data:{confirmation:'DELETE'}})).status()).toBe(401);
  await page.goto('/guest/assignments');await expect(page.getByRole('button',{name:'View Guest private homework details'})).toBeVisible();expect(await privateData(page)).toEqual(guestBeforeAccountDeletion);
  expect(accountBodies.join('\n')).not.toContain('Guest private homework');expect(accountBodies.join('\n')).not.toContain('guest-private-isolation');expect(accountBodies.join('\n')).not.toContain('fixture-guest-ed-token-never-echo');expect(forbidden).toEqual([]);
  },{timeout:phaseTimeout});
});
