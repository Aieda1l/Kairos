import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {enableFixtureSubmissionStatus,prepareFixtureUser,waitForAppHydration} from './helpers';

async function postFixture(request:APIRequestContext,path:string,data?:unknown){
  const response=await request.post(path,data===undefined?{}:{data});
  expect(response.ok(),`${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

async function installFixtureBridge(page:Page){
  await page.addInitScript(()=>{
    window.addEventListener('message',event=>{
      if(event.source!==window||event.origin!==window.location.origin)return;
      const data=event.data;
      if(data?.source!=='kairos-page')return;
      const reply=(type:string,payload:unknown)=>window.postMessage({
        source:'kairos-extension',type,protocolVersion:1,requestId:data.requestId,payload,
      },window.location.origin);
      if(data.type==='PING'){
        window.postMessage({source:'kairos-extension',type:'PONG',protocolVersion:1,
          requestId:data.requestId,extensionVersion:'0.3.0-e2e',canvasTabDetected:true,
          gradescopeTabDetected:true},window.location.origin);
      }else if(data.type==='SYNC_SUBMISSION_STATUS'){
        reply('SYNC_SUBMISSION_STATUS_RESULT',{
          protocolVersion:1,requestId:data.payload.requestId,errorCode:null,
          results:data.payload.assignments.map((item:{assignmentId:string})=>({
            ...item,state:'not_submitted',isLate:false,isMissing:false,submittedAt:null,
            checkedAt:new Date().toISOString(),extractorVersion:'sync-all-e2e-v1',
            // The other fixture assignment succeeds, so the real completion API
            // classifies this as PARTIAL_SYNC and retains the inaccessible item.
            ...(item.assignmentId==='4242'?{
              errorCode:'CANVAS_NETWORK_ERROR',diagnosticCode:'HTTP_OTHER',httpStatus:401,
            }:{}),
          })),
        });
      }else if(data.type==='GRADESCOPE_SYNC_ASSIGNMENTS'){
        const checkedAt=new Date().toISOString();
        reply('GRADESCOPE_SYNC_ASSIGNMENTS_RESULT',{
          protocolVersion:1,requestId:data.payload.requestId,errorCode:null,
          courses:data.payload.courseIds.map((courseId:string)=>({
            courseId,checkedAt,errorCode:null,parseDiagnosticCounts:[],assignments:[{
              courseId,assignmentId:'458',title:'Gradescope Recovery Homework',
              releaseAt:'2026-10-02T17:00:00.000Z',dueAt:'2026-10-09T06:59:00.000Z',
              lateDueAt:null,sourceStatusText:'No Submission',state:'not_submitted',
              isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,
              gradeDisplay:null,checkedAt,extractorVersion:'sync-all-e2e-v1',
            }],
          })),
        });
      }
    });
  });
}

test('Sync All continues after Canvas partial results and retries an Ed recovery response without reloading',async({page,context})=>{
  test.setTimeout(120_000);
  await prepareFixtureUser(context);
  const request=context.request;
  // Reuse the isolation fixture for a second eligible Canvas assignment.
  const tenant=await postFixture(request,'/api/test-fixtures/tenant-state');
  await postFixture(request,`/api/calendars/${tenant.calendarId}/disconnect`);
  await postFixture(request,'/api/sources/canvas/connect',{
    feedUrl:'https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics?token=fixture-secret-never-echo',
  });
  await postFixture(request,'/api/sources/ed/connect',{token:'fixture-ed-token-never-echo'});
  const edSelection=await request.put('/api/sources/ed/courses',{data:{enabledCourseIds:['123']}});
  expect(edSelection.ok()).toBe(true);
  // Establish previous successful Ed data, then verify the next failed attempt
  // cannot borrow that success for the root Sync All status.
  await postFixture(request,'/api/sources/ed/sync');
  const discovery=await postFixture(request,'/api/sources/gradescope/discover/start');
  await postFixture(request,'/api/sources/gradescope/discover/complete',{
    protocolVersion:1,requestId:discovery.requestId,errorCode:null,
    courses:[{courseId:'123',shortName:'CSE 331',fullName:'Software Design',term:'Autumn',year:'2026'}],
  });
  const gradescopeSelection=await request.put('/api/sources/gradescope/courses',{data:{enabledCourseIds:['123']}});
  expect(gradescopeSelection.ok()).toBe(true);
  await enableFixtureSubmissionStatus(context);
  const calendar=await postFixture(request,'/api/calendars/caldav/connect',{
    username:'student@example.com',secret:'fixture-app-password-never-echo',
  });
  await installFixtureBridge(page);
  await page.goto('/upcoming');
  await waitForAppHydration(page);
  const syncAll=page.getByRole('button',{name:'Sync All',exact:true});
  await expect(syncAll).toBeEnabled();
  // Let existing mount-time source/calendar reconciliation finish before the
  // manual runs whose ownership and ordering this test observes.
  await page.waitForLoadState('networkidle');

  const documentId=await page.evaluate(()=>{
    document.documentElement.dataset.syncAllDocument=crypto.randomUUID();
    return document.documentElement.dataset.syncAllDocument;
  });
  const calls:Array<{path:string;root:string|undefined;calendarRun:string|undefined;defer:string|undefined}>=[];
  page.on('request',outgoing=>{
    if(outgoing.method()!=='POST')return;
    const headers=outgoing.headers();
    calls.push({path:new URL(outgoing.url()).pathname,root:headers['x-kairos-sync-all-run'],
      calendarRun:headers['x-kairos-calendar-run'],defer:headers['x-kairos-calendar-sync']});
  });

  let recoveryResponses=0;
  await page.route('**/api/sources/ed/sync',async route=>{
    if(recoveryResponses++===0){
      // Only the client latch is synthetic. The fixture backend stays idle;
      // the next attempt must reach the real guarded Ed endpoint.
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'SYNC_RECOVERY_REQUIRED'})});
    }else await route.continue();
  });

  const run=async(expectedEdStatus:number)=>{
    const start=calls.length;
    const admitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sync-all/start'&&response.request().method()==='POST');
    const ed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sources/ed/sync'&&response.request().method()==='POST');
    const partial=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sources/canvas/submission-status/complete');
    const planResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/calendars/sync-all'&&Boolean(response.request().headers()['x-kairos-sync-all-run']));
    const calendarResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/calendars/${calendar.connection.id}/sync`&&Boolean(response.request().headers()['x-kairos-calendar-run']));
    await syncAll.click();
    const admission=await (await admitted).json();
    expect(admission.steps).toEqual(['canvas-deadlines','canvas-submissions','gradescope','ed','calendars']);
    expect((await ed).status()).toBe(expectedEdStatus);
    expect(await (await partial).json()).toMatchObject({lastErrorCode:'PARTIAL_SYNC',updatedCount:1,failedCount:1,
      failureHttpStatuses:[{status:401,count:1}]});
    const plan=await (await planResponse).json();
    expect(plan.invocations).toEqual([{connectionId:calendar.connection.id,runId:expect.any(String)}]);
    const calendarResult=await calendarResponse;
    expect(calendarResult.ok()).toBe(true);
    expect(await calendarResult.json()).toMatchObject({connectionId:calendar.connection.id,status:'success'});
    await expect(syncAll).toBeEnabled();
    // Bridge completion carries its registered requestId rather than claiming
    // the root step again; its defer header still keeps calendars until last.
    const manual=calls.slice(start).filter(call=>call.root===admission.runId
      ||call.calendarRun===plan.invocations[0].runId
      ||call.defer==='defer'&&['/api/sources/canvas/submission-status/complete','/api/sources/gradescope/sync/complete'].includes(call.path));
    expect(manual.map(call=>call.path)).toEqual([
      '/api/sources/canvas/sync','/api/sources/canvas/submission-status/start',
      '/api/sources/canvas/submission-status/complete','/api/sources/gradescope/sync/start',
      '/api/sources/gradescope/sync/complete','/api/sources/ed/sync',
      '/api/calendars/sync-all',`/api/calendars/${calendar.connection.id}/sync`,
    ]);
    for(const path of ['/api/sources/canvas/sync','/api/sources/canvas/submission-status/complete',
      '/api/sources/gradescope/sync/complete','/api/sources/ed/sync']){
      expect(manual.find(call=>call.path===path)?.defer).toBe('defer');
    }
    await expect(page.getByText('Fixture Homework').first()).toBeVisible();
    await expect(page.getByRole('status').filter({hasText:/Canvas submissions: 1 of 2 submission statuses updated\. Canvas access could not be verified\./})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.dataset.syncAllDocument)).toBe(documentId);
    return admission.runId as string;
  };

  const firstRun=await run(409);
  await expect(page.getByRole('status').filter({hasText:/Ed:.*settle/i})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Ed sync complete.'})).toHaveCount(0);
  const secondRun=await run(200);
  expect(secondRun).not.toBe(firstRun);
  expect(recoveryResponses).toBe(2);
  await expect(page.getByRole('status').filter({hasText:'Ed sync complete.'})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:/Ed:/})).toHaveCount(0);
  const assignments=await request.get('/assignments');
  expect(await assignments.text()).toContain('Gradescope Recovery Homework');
  expect(await assignments.text()).toContain('Ed Dated Lesson');
});
