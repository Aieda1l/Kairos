import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {D1SourceCredentialRepository} from '@/lib/db/d1/repositories/source-credentials';
import {D1SettingsRepository} from '@/lib/db/d1/repositories/settings';
import {D1SourceCourseRepository} from '@/lib/db/d1/repositories/source-courses';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1AbuseControlRepository} from '@/lib/db/d1/repositories/abuse-controls';
import {enforceBudget} from '@/lib/abuse/guard';
import {reconcileCalendarsAfterSourceWrite} from '@/lib/calendar/post-source-sync';
import {startSyncAll,claimSyncAllStep,withSyncAllStep,isCalendarFanoutPrepaid,withAutomaticCalendarReconciliation} from '@/lib/abuse/sync-all';
import {D1SyncAllRunRepository} from '@/lib/db/d1/repositories/sync-all-runs';
import {reconcileAllCalendars} from '@/lib/calendar/reconcile';
import {AbuseSubjectError,RateLimitedError,type AbuseRuntime} from '@/lib/abuse/types';
import {withProviderWork} from '@/lib/abuse/provider-operation';
import {AuthenticationRequiredError} from '@/lib/auth/user-scope';

let test:ReturnType<typeof openD1TestDatabase>,runtime:AbuseRuntime,sourceId:string;
let signedOut=false;
const keyring={activeKeyId:'synthetic',keys:{synthetic:new Uint8Array(32).fill(9)}};
vi.mock('@/lib/platform/abuse-runtime',()=>({getAbuseRuntime:async()=>runtime}));
vi.mock('@/lib/platform/source-runtime',async original=>({...await original<object>(),getSourceRuntimeContext:async()=>{
  if(signedOut)throw new AuthenticationRequiredError();
  return {db:test.db,scope,keyring};
}}));
vi.mock('@/lib/platform/calendar-runtime',()=>({getCalendarRouteRuntime:async()=>({kind:'hosted',db:test.db,scope,keyring})}));
const routes=import.meta.glob<{POST:(request:Request)=>Promise<Response>}>('../../src/app/api/**/route.ts');
const scope={userId:'synthetic-alice'},other={userId:'synthetic-bob'};
const rows=(table:string)=>(test.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n;
const feed='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Kairos//Synthetic//EN\r\nBEGIN:VEVENT\r\nUID:event-assignment-4242\r\nDTSTAMP:20261003T200000Z\r\nDTSTART:20991009T065900Z\r\nSUMMARY:Synthetic Assignment [SYN]\r\nURL:https://canvas.uw.edu/calendar?include_contexts=course_1#assignment_4242\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
async function post(path:string,runId?:string,body?:unknown){
  const route=await routes[`../../src/app/api/${path}/route.ts`]!();
  const headers:Record<string,string>={'x-kairos-calendar-sync':'defer'};
  if(runId!==undefined)headers['x-kairos-sync-all-run']=runId;
  if(body!==undefined)headers['content-type']='application/json';
  return route.POST(new Request(`https://synthetic.invalid/api/${path}`,{method:'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
}
async function issuedRun(){
  const response=await post('sync-all/start');expect(response.status).toBe(200);
  return await response.json() as {runId:string};
}
function upstreamFixture(){
  const mock=vi.fn<typeof fetch>(async input=>String(input).includes('/feeds/calendars/')
    ?new Response(feed,{headers:{'content-type':'text/calendar'}})
    :Response.json({modules:[],lessons:[]}));
  runtime.fetchImpl=mock;vi.stubGlobal('fetch',mock);return mock;
}
beforeEach(async()=>{
  signedOut=false;
  test=openD1TestDatabase();
  test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-alice'),('synthetic-bob')");
  runtime={db:test.db,hmacKey:new Uint8Array(32).fill(7),turnstileSecret:'synthetic',appOrigin:'https://synthetic.invalid',hostname:'synthetic.invalid',fetchImpl:vi.fn<typeof fetch>()};
  sourceId=(await new D1SourceConnectionRepository(test.db,scope).upsertCanvas('Synthetic')).id;
});
afterEach(()=>{test.close();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('server-issued Sync All admission against real SQL',()=>{
  it('authenticates the root before any budget or run mutation',async()=>{
    signedOut=true;
    const route=await routes['../../src/app/api/sync-all/start/route.ts']!();
    expect((await route.POST(new Request('https://synthetic.invalid/api/sync-all/start',{method:'POST'}))).status).toBe(401);
    expect(rows('abuse_rate_events')).toBe(0);expect(rows('sync_all_runs')).toBe(0);
  });
  it.each(['sources/canvas/sync','sources/ed/sync','sources/gradescope/sync/start','sources/canvas/submission-status/start','calendars/sync-all'])('rejects forged run and defer headers before %s child work',async path=>{
    const route=await routes[`../../src/app/api/${path}/route.ts`]!();
    const response=await route.POST(new Request(`https://synthetic.invalid/api/${path}`,{method:'POST',headers:{'x-kairos-sync-all-run':crypto.randomUUID(),'x-kairos-calendar-sync':'defer'}}));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('ABUSE_SUBJECT_INVALID');
    expect(rows('abuse_rate_events')).toBe(0);expect(rows('sync_all_steps')).toBe(0);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['sources/canvas/sync','sources/canvas/submission-status/start','sources/gradescope/sync/start','sources/ed/sync'])('valid admission executes %s once and rejects replay before child work',async path=>{
    const secrets=new D1SourceCredentialRepository(test.db,scope,keyring);
    await secrets.setCanvasFeedUrl(sourceId,'https://canvas.uw.edu/feeds/calendars/synthetic.ics');
    const sources=new D1SourceConnectionRepository(test.db,scope);
    if(path.includes('/ed/')||path.includes('/gradescope/')){
      const provider=path.includes('/ed/')?'ed':'gradescope';
      const connection=provider==='ed'?await sources.upsertEd('Synthetic'):await sources.upsertGradescope('Synthetic');
      if(provider==='ed')await secrets.setEdApiToken(connection.id,'synthetic-token');
      const courses=new D1SourceCourseRepository(test.db,scope);
      await courses.upsertDiscovered(connection.id,[{externalCourseId:'1',shortName:null,fullName:'Synthetic',term:null,year:null}],new Date().toISOString());
      await courses.setEnabled(connection.id,['1']);
    }
    const requests=upstreamFixture();const run=await issuedRun();
    const response=await post(path,run.runId);
    expect(response.status).toBe(200);
    expect(rows('sync_all_steps')).toBe(1);expect(rows('abuse_rate_events')).toBe(2);
    const requested=requests.mock.calls.length;
    expect((await post(path,run.runId)).status).toBe(400);
    expect(rows('abuse_rate_events')).toBe(2);expect(requests).toHaveBeenCalledTimes(requested);
  });
  it('actual Canvas deadline and submission endpoints share one combined twelve-operation bucket',async()=>{
    await new D1SourceCredentialRepository(test.db,scope,keyring).setCanvasFeedUrl(sourceId,'https://canvas.uw.edu/feeds/calendars/synthetic.ics');
    const requests=upstreamFixture();
    for(let i=0;i<6;i++){
      const run=await issuedRun();
      expect((await post('sources/canvas/sync',run.runId)).status).toBe(200);
      const started=await post('sources/canvas/submission-status/start',run.runId);
      expect(started.status).toBe(200);
      const payload=await started.json() as {requestId:string};
      expect((await post('sources/canvas/submission-status/complete',undefined,{requestId:payload.requestId,results:[],batchErrorCode:null})).status).toBe(200);
    }
    expect(rows('sync_all_steps')).toBe(12);expect(rows('abuse_rate_events')).toBe(18);
    const count=requests.mock.calls.length;
    expect((await post('sources/canvas/sync')).status).toBe(429);
    expect((await post('sources/canvas/submission-status/start')).status).toBe(429);
    expect(requests).toHaveBeenCalledTimes(count);expect(rows('abuse_rate_events')).toBe(18);
  });
  it('selects only the authenticated actor enabled steps and accepted submission preference',async()=>{
    await new D1SettingsRepository(test.db,scope).setCanvasSubmissionStatusEnabled(false);
    await expect(startSyncAll(runtime,scope)).resolves.toMatchObject({steps:['canvas-deadlines']});
    await expect(startSyncAll(runtime,other)).resolves.toMatchObject({steps:[]});
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it('requires enabled courses for Ed and Gradescope and skips disabled source connections',async()=>{
    const sources=new D1SourceConnectionRepository(test.db,scope);
    const courses=new D1SourceCourseRepository(test.db,scope);
    const ed=await sources.upsertEd('Synthetic');
    const gs=await sources.upsertGradescope('Synthetic');
    for(const connection of [ed,gs])await courses.upsertDiscovered(connection.id,[{externalCourseId:'course-1',fullName:'Synthetic',shortName:null,term:null,year:null}],new Date().toISOString());
    expect((await startSyncAll(runtime,scope)).steps).not.toContain('ed');
    await courses.setEnabled(ed.id,['course-1']);
    await courses.setEnabled(gs.id,['course-1']);
    test.sqlite.prepare('UPDATE source_connections SET enabled=0 WHERE user_id=? AND id=?').run(scope.userId,gs.id);
    expect((await startSyncAll(runtime,scope)).steps).toEqual(['canvas-deadlines','canvas-submissions','ed']);
  });
  it('charges the global bucket once per run, rejecting the seventh before child work',async()=>{
    for(let i=0;i<6;i++)await startSyncAll(runtime,scope);
    await expect(startSyncAll(runtime,scope)).rejects.toBeInstanceOf(RateLimitedError);
    expect(rows('sync_all_runs')).toBe(6);
    expect(rows('abuse_rate_events')).toBe(6);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it('an exhausted actor does no eligibility queries before the admission rejection',async()=>{
    for(let i=0;i<6;i++)await startSyncAll(runtime,scope);
    const reads=[
      vi.spyOn(D1SourceConnectionRepository.prototype,'getByKind'),
      vi.spyOn(D1SourceCourseRepository.prototype,'listEnabled'),
      vi.spyOn(D1SettingsRepository.prototype,'getCanvasSubmissionStatusEnabled'),
      vi.spyOn(D1CalendarConnectionRepository.prototype,'list'),
    ];
    await expect(startSyncAll(runtime,scope)).rejects.toBeInstanceOf(RateLimitedError);
    for(const read of reads)expect(read).not.toHaveBeenCalled();
    expect(rows('sync_all_runs')).toBe(6);
  });
  it('claims an eligible step once without a second global debit',async()=>{
    const run=await startSyncAll(runtime,scope);
    await expect(claimSyncAllStep(runtime,scope,run.runId,'canvas-deadlines')).resolves.toBeUndefined();
    await expect(claimSyncAllStep(runtime,scope,run.runId,'canvas-deadlines')).rejects.toBeInstanceOf(AbuseSubjectError);
    expect(rows('sync_all_steps')).toBe(1);expect(rows('abuse_rate_events')).toBe(1);
  });
  it('rejects foreign, forged, expired, and ineligible claims without work',async()=>{
    const run=await startSyncAll(runtime,scope);
    await expect(claimSyncAllStep(runtime,other,run.runId,'canvas-deadlines')).rejects.toBeInstanceOf(AbuseSubjectError);
    await expect(claimSyncAllStep(runtime,scope,crypto.randomUUID(),'canvas-deadlines')).rejects.toBeInstanceOf(AbuseSubjectError);
    await expect(claimSyncAllStep(runtime,scope,run.runId,'ed')).rejects.toBeInstanceOf(AbuseSubjectError);
    test.sqlite.prepare('UPDATE sync_all_runs SET expires_at_ms=0').run();
    await expect(claimSyncAllStep(runtime,scope,run.runId,'canvas-deadlines')).rejects.toBeInstanceOf(AbuseSubjectError);
    expect(rows('sync_all_steps')).toBe(0);expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it('allows exactly one concurrent claimant',async()=>{
    const run=await startSyncAll(runtime,scope);
    const results=await Promise.allSettled([1,2].map(()=>claimSyncAllStep(runtime,scope,run.runId,'canvas-deadlines')));
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(rows('sync_all_steps')).toBe(1);
  });
  it('a claimed root step never exempts the ordinary child resource budget',async()=>{
    const child={provider:'canvas' as const,operation:'manual-sync' as const,resourceId:sourceId};
    for(let i=0;i<12;i++)await withProviderWork(runtime,scope,child,async()=>{});
    const run=await startSyncAll(runtime,scope);
    await claimSyncAllStep(runtime,scope,run.runId,'canvas-deadlines');
    await expect(withProviderWork(runtime,scope,child,async()=>runtime.fetchImpl('https://synthetic.invalid'))).rejects.toBeInstanceOf(RateLimitedError);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it('prepaid calendar context is scoped to the claimed actor, step and active callback',async()=>{
    const runId=crypto.randomUUID();
    await new D1SyncAllRunRepository(test.db,scope).create(runId,['calendars']);
    await withSyncAllStep(runtime,scope,runId,'calendars',async()=>{
      expect(isCalendarFanoutPrepaid(test.db,scope)).toBe(true);
      expect(isCalendarFanoutPrepaid(test.db,other)).toBe(false);
      expect(isCalendarFanoutPrepaid({...test.db},scope)).toBe(false);
    });
    expect(isCalendarFanoutPrepaid(test.db,scope)).toBe(false);
    const run=await startSyncAll(runtime,scope);
    await withSyncAllStep(runtime,scope,run.runId,'canvas-deadlines',async()=>expect(isCalendarFanoutPrepaid(test.db,scope)).toBe(false));
  });
  it('automatic calendar reconciliation adds no new manual global debit',async()=>{
    const options={adapterFactory:()=>{throw new Error('No destinations are configured.');}};
    await withAutomaticCalendarReconciliation(test.db,scope,()=>reconcileAllCalendars(test.db,scope,options));
    expect(rows('abuse_rate_events')).toBe(0);
    await reconcileAllCalendars(test.db,scope,options);
    expect(rows('abuse_rate_events')).toBe(1);
    expect(isCalendarFanoutPrepaid(test.db,scope)).toBe(false);
  });
  it('a prepaid calendar API claim retains the ordinary destination budget and one-use guard',async()=>{
    const calendar=await new D1CalendarConnectionRepository(test.db,scope).create({provider:'google',label:'Synthetic'});
    for(let i=0;i<12;i++)await withProviderWork(runtime,scope,{provider:'google',operation:'manual-sync',resourceId:calendar.id},async()=>{});
    const run=await startSyncAll(runtime,scope);
    const route=await routes['../../src/app/api/calendars/sync-all/route.ts']!();
    const request=()=>new Request('https://synthetic.invalid/api/calendars/sync-all',{method:'POST',headers:{'x-kairos-sync-all-run':run.runId}});
    expect((await route.POST(request())).status).toBe(429);
    expect(rows('abuse_rate_events')).toBe(13);
    expect((await route.POST(request())).status).toBe(400);
    expect(rows('abuse_rate_events')).toBe(13);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it('actual post-source reconciliation skips a new global debit while keeping child controls',async()=>{
    await new D1CalendarConnectionRepository(test.db,scope).create({provider:'google',label:'Synthetic'});
    for(let i=0;i<6;i++)await enforceBudget(runtime,{class:'sync-all',userId:scope.userId});
    await reconcileCalendarsAfterSourceWrite(test.db,scope,keyring,{defer:false,changed:true});
    expect(rows('abuse_rate_events')).toBe(7);
    await new D1AbuseControlRepository(test.db).setEnabled('provider:google',false);
    await reconcileCalendarsAfterSourceWrite(test.db,scope,keyring,{defer:false,changed:true});
    expect(rows('abuse_rate_events')).toBe(7);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
});
