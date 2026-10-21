import {installProviderRuntime} from "../helpers/provider-runtime";
import {afterEach,describe,expect,it,vi} from "vitest";
import {startGradescopeDiscovery,completeGradescopeDiscovery} from "@/lib/gradescope/discovery-service";
import {connectEd} from "@/lib/ed/discovery-service";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {acquireOperation,releaseOperation,markOperationUncertain,withOwnedOperation,runWithOperationOwnership,ownedFetch} from "@/lib/abuse/operation-lock";
import type {AbuseRuntime} from "@/lib/abuse/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import {reconcileCalendarConnection,reconcileAllCalendars} from "@/lib/calendar/reconcile";
import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {registerFencedCalendarAdapter} from "@/lib/calendar/adapter";
import {GoogleCalendarClient} from "@/lib/calendar/google/client";
import {GoogleCalendarAdapter} from "@/lib/calendar/google/adapter";
import {MicrosoftCalendarClient} from "@/lib/calendar/microsoft/client";
import {MicrosoftCalendarAdapter} from "@/lib/calendar/microsoft/adapter";
import {CalDavClient} from "@/lib/calendar/caldav/client";
import {CalDavCalendarAdapter} from "@/lib/calendar/caldav/adapter";
import type {CalendarDestinationAdapter} from "@/lib/calendar/adapter";
import {registerOAuthRequest} from "@/lib/calendar/oauth-registry";
import {prepareOwned} from "@/lib/db/d1/owned-mutation";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1SubmissionStatusRepository} from "@/lib/db/d1/repositories/submission-status";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {AbuseStorageUnavailableError} from "@/lib/abuse/types";

const opened:ReturnType<typeof openD1TestDatabase>[]=[];
const scope={userId:"synthetic-owner"};
const keyring={activeKeyId:"test",keys:{test:new Uint8Array(32).fill(9)}};
function open(){const test=openD1TestDatabase();installProviderRuntime(test.db);opened.push(test);test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-owner'),('synthetic-other')");return test;}
async function seedCalendar(test:ReturnType<typeof open>,count=6,provider:"google"|"microsoft"|"caldav"="google"){
  const source=await new D1SourceConnectionRepository(test.db,scope).upsertCanvas("Synthetic");
  await new D1AssignmentRepository(test.db,scope).upsertMany(source.id,Array.from({length:count},(_,i)=>({source:"canvas" as const,externalId:`synthetic-${i}`,courseId:null,courseName:"Synthetic",title:"Synthetic",releaseAt:null,dueAt:"2026-11-01T00:00:00.000Z",lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null})),new Date().toISOString());
  const connections=new D1CalendarConnectionRepository(test.db,scope);
  const connection=await connections.create({provider,label:"Synthetic"});
  return connections.updateRemoteCalendar(connection.id,provider==='caldav'?'https://p12-caldav.icloud.com/synthetic/calendars/kairos/':"synthetic-calendar","Synthetic");
}
function adapter(overrides:Partial<CalendarDestinationAdapter>={}):CalendarDestinationAdapter{return {provider:"google",testConnection:async()=>{},ensureCalendar:async()=>({remoteCalendarId:"synthetic-calendar",name:"Synthetic"}),getEvent:async()=>null,createEvent:async()=>({remoteEventId:"synthetic-event",etag:null}),updateEvent:async()=>({remoteEventId:"synthetic-event",etag:null}),deleteEvent:async()=>{},...overrides};}
async function hostedCallback(test:ReturnType<typeof open>,provider:"google"|"microsoft",db=test.db,runtimeKeyring=keyring){
  vi.spyOn(await import("@/lib/platform/calendar-api-runtime"),"resolveCalendarApiRuntime").mockResolvedValue({ok:true,runtime:{kind:"hosted",db,scope,keyring:runtimeKeyring}});
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","synthetic-client");
  vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","11111111-1111-4111-8111-111111111111");
  vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_SECRET","synthetic-secret");
  vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});
  return provider==="google"?await import("@/app/api/calendars/google/callback/route"):await import("@/app/api/calendars/microsoft/callback/route");
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();for(const test of opened.splice(0))test.close();});

describe("durable service ownership",()=>{
  it("migration retains pre-upgrade active bridge work as uncertain",async()=>{
    const test=openD1TestDatabase({beforeMigration:(name,sqlite)=>{
      if(name!=="0006_bridge_ownership.sql")return;
      sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-upgrade'); INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at) VALUES ('synthetic-upgrade','synthetic-request','gradescope_discovery','{}','2026-10-01T00:00:00.000Z','2026-10-01T00:10:00.000Z')");
    }});opened.push(test);installProviderRuntime(test.db);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});
    await expect(startGradescopeDiscovery(test.db,{userId:"synthetic-upgrade"})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
  });
  it("holds discovery ownership across requests and rejects duplicate starts",async()=>{
    const {db}=open();
    await startGradescopeDiscovery(db,scope);
    await expect(startGradescopeDiscovery(db,scope)).rejects.toMatchObject({code:"SYNC_IN_PROGRESS"});
  });
  it("rejects duplicate bridge starts inside the same server-issued ownership context",async()=>{
    const test=open();await withOwnedOperation(test.db,scope,"source:gradescope",async()=>{
      await startGradescopeDiscovery(test.db,scope);
      await expect(startGradescopeDiscovery(test.db,scope)).rejects.toMatchObject({code:"SYNC_IN_PROGRESS"});
    });
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM sync_requests").get()).toEqual({n:1});
  });
  it("retains abandoned bridge ownership and rejects expired completion",async()=>{
    const {db,sqlite}=open();
    const started=await startGradescopeDiscovery(db,scope,new Date(Date.now()-700_000));
    await expect(completeGradescopeDiscovery(db,scope,{requestId:started.requestId,protocolVersion:1,courses:[],errorCode:null})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});
  });
  it("excludes a second credential connection while remote read remains unresolved",async()=>{
    const {db,sqlite}=open();let settle!:(r:Response)=>void;
    const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{settle=resolve;}));
    const pending=connectEd(db,scope,keyring,"synthetic-token",transport);
    await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    sqlite.prepare("UPDATE operation_locks SET stale_at_ms=started_at_ms").run();
    const competing=vi.fn<typeof fetch>();
    await expect(connectEd(db,scope,keyring,"synthetic-token",competing)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(competing).not.toHaveBeenCalled();
    settle(Response.json({user:{id:1},courses:[]}));
    await pending;
  });
});

describe("ownership SQL and settled work",()=>{
  it.each(['google','microsoft'] as const)('returns an admitted %s onboarding callback to its target when prior work requires recovery',async provider=>{
    const test=open();const connection=await seedCalendar(test,1,provider);
    const credentials=new D1CalendarCredentialRepository(test.db,scope,keyring);await credentials.setOAuthRefreshToken(connection.id,'synthetic-accepted-refresh');
    const before=test.sqlite.prepare('SELECT * FROM calendar_connections').all();
    const registered=await registerOAuthRequest(test.db,scope,keyring,{provider,connectionId:connection.id,returnTo:'/onboarding',redirectUri:`https://synthetic.invalid/api/calendars/${provider}/callback`});
    const lock=await acquireOperation({db:test.db} as AbuseRuntime,scope,`calendar:${provider}`);await markOperationUncertain(lock);
    const transport=vi.fn(()=>{throw new Error('No provider calls while recovery is required');});vi.stubGlobal('fetch',transport);
    const response=await (await hostedCallback(test,provider)).GET(new Request(`https://synthetic.invalid/api/calendars/${provider}/callback?state=${registered.state}&code=synthetic-private-code`));
    expect(response.status).toBe(303);const target=new URL(response.headers.get('location')!);expect(target.pathname).toBe('/onboarding');expect(target.searchParams.get('calendarError')).toBe('SYNC_RECOVERY_REQUIRED');
    expect(target.href).not.toContain('synthetic-private-code');expect(transport).not.toHaveBeenCalled();expect(test.sqlite.prepare('SELECT * FROM calendar_connections').all()).toEqual(before);
    expect(await credentials.getOAuthRefreshToken(connection.id)).toBe('synthetic-accepted-refresh');expect(test.sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'uncertain'});
    expect(test.sqlite.prepare('SELECT consumed_at FROM oauth_requests').get()).toMatchObject({consumed_at:expect.any(String)});
  });
  it.each([
    {provider:"google" as const,failure:"batch"},{provider:"microsoft" as const,failure:"batch"},
    {provider:"google" as const,failure:"preparation"},{provider:"microsoft" as const,failure:"preparation"},
  ])("retains uncertainty and accepted state after $provider token issuance and replacement $failure failure",async({provider,failure})=>{
    const test=open();const connection=await seedCalendar(test,1,provider);
    const credentials=new D1CalendarCredentialRepository(test.db,scope,keyring);
    await credentials.setOAuthRefreshToken(connection.id,"synthetic-old");
    const assignment=(await new D1AssignmentRepository(test.db,scope).list())[0]!;
    const links=new D1CalendarEventLinkRepository(test.db,scope);
    const link=await links.ensure(connection.id,assignment.id,"synthetic-key");
    await links.markSynced(link.id,"synthetic-old-event","synthetic-etag","synthetic-hash",new Date().toISOString());
    const snapshot=()=>Object.fromEntries(["calendar_connections","calendar_credentials","calendar_event_links","assignments"].map(table=>[table,test.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
    const before=snapshot();
    const db:D1DatabaseLike={prepare:test.db.prepare.bind(test.db),exec:test.db.exec.bind(test.db),batch:statements=>test.db.batch([...statements,
      test.db.prepare("INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(scope.userId,"synthetic-fault","invalid","Synthetic",new Date().toISOString(),new Date().toISOString()),
    ])};
    const runtimeKeyring=failure==="preparation"?{activeKeyId:"broken",keys:{...keyring.keys,broken:new Uint8Array(1)}}:keyring;
    const registered=await registerOAuthRequest(test.db,scope,keyring,{provider,connectionId:connection.id,redirectUri:`https://synthetic.invalid/api/calendars/${provider}/callback`});
    let tokenCalls=0,calendarCalls=0;
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(String(input).includes("token")){tokenCalls++;return Response.json({access_token:"synthetic-access",refresh_token:"synthetic-new",expires_in:3600});}
      expect(init?.method).toBe("GET");calendarCalls++;
      return Response.json(provider==="google"?{id:"synthetic-calendar",accessRole:"owner"}:{id:"synthetic-calendar",canEdit:true});
    });
    const response=await (await hostedCallback(test,provider,db,runtimeKeyring)).GET(new Request(`https://synthetic.invalid/api/calendars/${provider}/callback?state=${registered.state}&code=synthetic-code`));
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(tokenCalls).toBe(1);expect(calendarCalls).toBe(failure==="batch"?1:0);
    expect(snapshot()).toEqual(before);expect(await credentials.getOAuthRefreshToken(connection.id)).toBe("synthetic-old");
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});
  });
  it.each(["google","microsoft"] as const)("rejects consumed version N after pause/reopen during %s callback acquisition before token transport",async provider=>{
    const test=open();let transitioned=false;
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      if(!transitioned&&sql.startsWith("INSERT INTO operation_locks")){
        expect(test.sqlite.prepare("SELECT consumed_at FROM oauth_requests").get()).toMatchObject({consumed_at:expect.any(String)});
        test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run(`provider:${provider}`);
        test.sqlite.prepare("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key=?").run(`provider:${provider}`);
        transitioned=true;
      }
      return test.db.prepare(sql);
    }};
    const registered=await registerOAuthRequest(test.db,scope,keyring,{provider,redirectUri:`https://synthetic.invalid/api/calendars/${provider}/callback`});
    let tokenCalls=0,calendarCalls=0;
    vi.stubGlobal("fetch",async(input:RequestInfo|URL)=>{
      if(String(input).includes("token")){tokenCalls++;return Response.json({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600});}
      calendarCalls++;throw new Error("Unexpected calendar transport");
    });
    const route=await hostedCallback(test,provider,db);
    const response=await route.GET(new Request(`https://synthetic.invalid/api/calendars/${provider}/callback?state=${registered.state}&code=synthetic-code`));
    const code=new URL(response.headers.get("location")!).searchParams.get("calendarError");
    expect(transitioned).toBe(true);expect(code).toBe("CALENDAR_AUTH_REQUIRED");
    expect(tokenCalls).toBe(0);expect(calendarCalls).toBe(0);
  });
  it.each(["google","microsoft"] as const)("rejects version change after %s ownership acquisition before token transport",async provider=>{
    const test=open();let transitioned=false;
    const wrap=(statement:ReturnType<D1DatabaseLike["prepare"]>):ReturnType<D1DatabaseLike["prepare"]>=>({
      bind:(...values)=>wrap(statement.bind(...values)),first:()=>statement.first(),all:()=>statement.all(),run:async<T>()=>{
        const result=await statement.run<T>();
        if(!transitioned){test.sqlite.prepare("UPDATE abuse_controls SET version=version+2 WHERE control_key=?").run(`provider:${provider}`);transitioned=true;}
        return result;
      },
    });
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>sql.startsWith("INSERT INTO operation_locks")?wrap(test.db.prepare(sql)):test.db.prepare(sql)};
    const registered=await registerOAuthRequest(test.db,scope,keyring,{provider,redirectUri:`https://synthetic.invalid/api/calendars/${provider}/callback`});
    let calls=0;vi.stubGlobal("fetch",async()=>{calls++;return Response.json({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600});});
    const response=await (await hostedCallback(test,provider,db)).GET(new Request(`https://synthetic.invalid/api/calendars/${provider}/callback?state=${registered.state}&code=synthetic-code`));
    const code=new URL(response.headers.get("location")!).searchParams.get("calendarError");
    expect(code).toBe("CALENDAR_AUTH_REQUIRED");expect(calls).toBe(0);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it("reserves an issued handle before awaiting validation and rejects concurrent reuse while transport is held",async()=>{
    const test=open();let releaseSecond!:()=>void;let gating=false;
    const secondRead=new Promise<void>(resolve=>{releaseSecond=resolve;});
    const wrap=(statement:ReturnType<D1DatabaseLike["prepare"]>):ReturnType<D1DatabaseLike["prepare"]>=>({
      bind:(...values)=>wrap(statement.bind(...values)),run:()=>statement.run(),all:()=>statement.all(),
      first:async<T>()=>{const delay=gating;const snapshot=await statement.first<T>();if(delay)await secondRead;return snapshot;},
    });
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      const statement=test.db.prepare(sql);return sql.startsWith("SELECT (SELECT enabled")?wrap(statement):statement;
    }};
    const lock=await acquireOperation({db} as AbuseRuntime,scope,"source:ed");
    let settle!:(response:Response)=>void;
    const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{settle=resolve;}));
    const first=runWithOperationOwnership(lock,()=>ownedFetch(transport)("https://synthetic.invalid"));
    const firstOutcome=first.then(()=>null,error=>error);
    gating=true;const second=runWithOperationOwnership(lock,async()=>{}).then(()=>null,error=>error);gating=false;
    await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    releaseSecond();const duplicate=await second;
    const state=test.sqlite.prepare("SELECT state FROM operation_locks").get();
    const explicitRelease=await releaseOperation(lock);
    const competing=vi.fn<typeof fetch>();
    const third=await withOwnedOperation(db,scope,"source:ed",()=>ownedFetch(competing)("https://synthetic.invalid")).then(()=>null,error=>error);
    settle(Response.json({ok:true}));await firstOutcome;
    expect(duplicate).toMatchObject({code:"SYNC_IN_PROGRESS"});
    expect(state).toEqual({state:"running"});expect(explicitRelease).toBe(false);
    expect(third).toMatchObject({code:"SYNC_IN_PROGRESS"});expect(competing).not.toHaveBeenCalled();
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it("preserves legitimate nesting under the exact issued execution",async()=>{
    const test=open();const lock=await acquireOperation({db:test.db} as AbuseRuntime,scope,"source:ed");
    await runWithOperationOwnership(lock,()=>runWithOperationOwnership(lock,()=>withOwnedOperation(test.db,scope,"source:ed",async()=>{})));
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it("rejects invalidated callback resources before issuing a nonce or exchanging credentials",async()=>{
    const test=open();const connections=new D1CalendarConnectionRepository(test.db,scope);
    const connection=await connections.create({provider:"google",label:"Synthetic"});
    const registered=await registerOAuthRequest(test.db,scope,keyring,{provider:"google",connectionId:connection.id,redirectUri:"https://synthetic.invalid/api/calendars/google/callback"});
    const startOwner=test.sqlite.prepare("SELECT * FROM operation_locks").all();
    await connections.delete(connection.id);
    vi.spyOn(await import("@/lib/platform/calendar-api-runtime"),"resolveCalendarApiRuntime").mockResolvedValue({ok:true,runtime:{kind:"hosted",db:test.db,scope,keyring}});
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","synthetic-client");
    const transport=vi.fn<typeof fetch>(async()=>Response.json({error:"invalid_grant"},{status:401}));vi.stubGlobal("fetch",transport);
    vi.spyOn(console,"warn").mockImplementation(()=>{});
    const {GET}=await import("@/app/api/calendars/google/callback/route");
    const response=await GET(new Request(`https://synthetic.invalid/api/calendars/google/callback?state=${registered.state}&code=synthetic-code`));
    expect(response.status).toBe(400);expect(transport).not.toHaveBeenCalled();
    expect(test.sqlite.prepare("SELECT * FROM operation_locks").all()).toEqual(startOwner);
  });
  it("refuses owner release while its provider promise is unresolved",async()=>{
    const test=open();const lock=await acquireOperation({db:test.db} as AbuseRuntime,scope,"source:ed");
    let settle!:(response:Response)=>void;
    const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{settle=resolve;}));
    const pending=runWithOperationOwnership(lock,async()=>{await ownedFetch(transport)("https://synthetic.invalid");});
    await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    const released=await releaseOperation(lock);
    settle(Response.json({ok:true}));await pending.catch(()=>undefined);
    expect(released).toBe(false);
  });
  it("isolates actors/resources and refuses old-owner releases and mutations",async()=>{
    const test=open();const runtime={db:test.db} as AbuseRuntime;
    const first=await acquireOperation(runtime,scope,"source:canvas");
    await acquireOperation(runtime,{userId:"synthetic-other"},"source:canvas");
    await acquireOperation(runtime,scope,"source:ed");
    expect(await releaseOperation(first)).toBe(true);
    const second=await acquireOperation(runtime,scope,"source:canvas");
    expect(await releaseOperation(first)).toBe(false);
    await markOperationUncertain(first);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='source:canvas'").get(scope.userId)).toEqual({state:"running"});
    expect(await releaseOperation(second)).toBe(true);
    let delayed!:ReturnType<D1SourceConnectionRepository["prepareUpsert"]>;
    await withOwnedOperation(test.db,scope,"source:canvas",async()=>{delayed=new D1SourceConnectionRepository(test.db,scope).prepareUpsert("synthetic-local","canvas","Stale",new Date().toISOString());});
    await acquireOperation(runtime,scope,"source:canvas");
    await delayed.run();
    expect(await new D1SourceConnectionRepository(test.db,scope).getByKind("canvas")).toBeNull();
  });
  it("cannot mutate another actor through a matching local context",async()=>{
    const test=open();await expect(withOwnedOperation(test.db,scope,"source:ed",()=>new D1SourceConnectionRepository(test.db,{userId:"synthetic-other"}).upsertEd("Synthetic"))).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM source_connections").get()).toEqual({n:0});
  });
  it.each(["running","uncertain","disabled"] as const)("rejects same-user wrong calendar resource writes while the target is %s",async state=>{
    const test=open();const connection=await seedCalendar(test,1);
    const credentials=new D1CalendarCredentialRepository(test.db,scope,keyring);
    await credentials.setOAuthRefreshToken(connection.id,"synthetic-old");
    const assignments=new D1AssignmentRepository(test.db,scope),assignment=(await assignments.list())[0]!;
    const links=new D1CalendarEventLinkRepository(test.db,scope);
    const link=await links.ensure(connection.id,assignment.id,"synthetic-key");
    const target=await acquireOperation({db:test.db} as AbuseRuntime,scope,"calendar:google");
    if(state==="uncertain")await markOperationUncertain(target);
    if(state==="disabled")test.sqlite.prepare("UPDATE abuse_controls SET enabled=0 WHERE control_key='provider:google'").run();
    const before=test.sqlite.prepare("SELECT * FROM calendar_connections").all();
    for(const key of ["source:ed","calendar:microsoft"] as const){
      for(const mutate of [
        ()=>new D1CalendarConnectionRepository(test.db,scope).updateRemoteCalendar(connection.id,"changed","Changed"),
        ()=>credentials.setOAuthRefreshToken(connection.id,"synthetic-new"),
        ()=>links.markSynced(link.id,"changed",null,"changed",new Date().toISOString()),
        ()=>links.delete(link.id),
      ])await expect(withOwnedOperation<unknown>(test.db,scope,key,mutate)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    }
    expect(test.sqlite.prepare("SELECT * FROM calendar_connections").all()).toEqual(before);
    expect(await credentials.getOAuthRefreshToken(connection.id)).toBe("synthetic-old");
    expect((await links.get(connection.id,assignment.id))?.remoteEventId).toBeNull();
    expect(test.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:google'").get()).toEqual({state:state==="uncertain"?"uncertain":"running"});
  });
  it.each(["running","uncertain","disabled"] as const)("rejects same-user wrong source mutations while the target is %s",async state=>{
    const test=open();const source=await new D1SourceConnectionRepository(test.db,scope).upsertCanvas("Accepted");
    const credentials=new D1SourceCredentialRepository(test.db,scope,keyring);
    await credentials.setCanvasFeedUrl(source.id,"https://canvas.uw.edu/feeds/calendars/synthetic.ics");
    const courses=new D1SourceCourseRepository(test.db,scope);
    await courses.upsertDiscovered(source.id,[{externalCourseId:"1",shortName:null,fullName:"Accepted",term:null,year:null}],new Date().toISOString());
    const assignment={source:"canvas" as const,externalId:"synthetic-existing",courseId:null,courseName:"Synthetic",title:"Accepted",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null};
    const assignments=new D1AssignmentRepository(test.db,scope);
    await assignments.upsertMany(source.id,[assignment],new Date().toISOString());
    const local=(await assignments.list())[0]!;
    const target=await acquireOperation({db:test.db} as AbuseRuntime,scope,"source:canvas");
    if(state==="uncertain")await markOperationUncertain(target);
    if(state==="disabled")test.sqlite.prepare("UPDATE abuse_controls SET enabled=0 WHERE control_key='provider:canvas'").run();
    const before=test.sqlite.prepare("SELECT * FROM assignments").all();
    for(const mutate of [
      ()=>new D1SourceConnectionRepository(test.db,scope).markSyncSuccess(source.id,new Date().toISOString()),
      ()=>credentials.setCanvasFeedUrl(source.id,"https://canvas.uw.edu/feeds/calendars/synthetic-new.ics"),
      ()=>assignments.upsertMany(source.id,[{...assignment,source:"ed",title:"Changed"}],new Date().toISOString()),
      ()=>courses.setEnabled(source.id,["1"]),
      ()=>new D1SubmissionStatusRepository(test.db,scope).markAttempt(source.id,new Date().toISOString()),
      ()=>new D1SubmissionStatusRepository(test.db,scope).applyCompletion(source.id,[{assignmentLocalId:local.id,state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:new Date().toISOString(),extractorVersion:"synthetic"}],0,null,new Date().toISOString()),
    ])await expect(withOwnedOperation<unknown>(test.db,scope,"source:ed",mutate)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(test.sqlite.prepare("SELECT * FROM assignments").all()).toEqual(before);
    expect((await courses.list(source.id))[0]?.enabled).toBe(false);
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM assignment_submission_status").get()).toEqual({n:0});
  });
  it("fails closed for an unsupported owned SQL shape",async()=>{
    const test=open();await withOwnedOperation(test.db,scope,"source:ed",async()=>{
      expect(()=>prepareOwned(test.db,scope,"WITH candidate AS (SELECT 1) UPDATE source_connections SET enabled=0 WHERE user_id=?")).toThrow("Unsupported owned mutation");
    });
  });
  it.each(["UPDATE","DELETE"] as const)("fences the entire OR predicate for stale-owner %s",async verb=>{
    const test=open();const connections=new D1SourceConnectionRepository(test.db,scope);
    const source=await connections.upsertEd("Accepted");
    let delayed!:ReturnType<D1DatabaseLike["prepare"]>;
    await withOwnedOperation(test.db,scope,"source:ed",async()=>{
      delayed=verb==="UPDATE"
        ?prepareOwned(test.db,scope,"UPDATE source_connections SET label=? WHERE user_id=? OR id=?",{kind:"source",id:source.id}).bind("Changed",scope.userId,source.id)
        :prepareOwned(test.db,scope,"DELETE FROM source_connections WHERE user_id=? OR id=?",{kind:"source",id:source.id}).bind(scope.userId,source.id);
      test.sqlite.prepare("UPDATE operation_locks SET owner_nonce='synthetic-replacement' WHERE operation_key='source:ed'").run();
    }).catch(()=>undefined);
    await delayed.run();
    expect((await connections.getById(source.id))?.label).toBe("Accepted");
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"running"});
  });
  it("rejects supported-table SQL that would change the resource's authority metadata",async()=>{
    const test=open();const connection=await seedCalendar(test,1);
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      expect(()=>prepareOwned(test.db,scope,"UPDATE calendar_connections SET provider='microsoft' WHERE user_id=? AND id=?",{kind:"calendar",id:connection.id})).toThrow("Unsupported owned mutation");
    });
    expect((await new D1CalendarConnectionRepository(test.db,scope).getById(connection.id))?.provider).toBe("google");
  });
  it.each([
    {form:"quoted-WHERE",arm:"UPDATE",set:"label='WHERE', provider='microsoft'"},
    {form:"nested-WHERE",arm:"UPDATE",set:"label=(SELECT 'Synthetic' WHERE 1), provider='microsoft'"},
    {form:"escaped quoted-WHERE",arm:"UPDATE",set:"label='Synthetic '' WHERE', provider='microsoft'"},
    {form:"quoted-WHERE",arm:"conflict",set:"label='WHERE', provider='microsoft'"},
    {form:"nested-WHERE",arm:"conflict",set:"label=(SELECT 'Synthetic' WHERE 1), provider='microsoft'"},
    {form:"tuple",arm:"UPDATE",set:"(label,provider)=('WHERE','microsoft')"},
    {form:"quoted identifier",arm:"UPDATE",set:'label=\'WHERE\', "provider"=\'microsoft\''},
    {form:"tuple",arm:"conflict",set:"(label,provider)=('WHERE','microsoft')"},
    {form:"quoted identifier",arm:"conflict",set:'label=\'WHERE\', "provider"=\'microsoft\''},
  ])("N1 rejects $form $arm authority reassignment and retains the full row",async({arm,set})=>{
    const test=open();const connection=await seedCalendar(test,1);
    const before=test.sqlite.prepare("SELECT * FROM calendar_connections").all();let rejected=false;
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      const sql=arm==="UPDATE"?`UPDATE calendar_connections SET ${set} WHERE user_id=? AND id=?`
        :`INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES (?,?,'google','Synthetic','2026-10-12','2026-10-12') ON CONFLICT(user_id,id) DO UPDATE SET ${set} WHERE 1`;
      try{await prepareOwned(test.db,scope,sql,{kind:"calendar",id:connection.id}).bind(scope.userId,connection.id).run();}catch(error){
        expect(error).toMatchObject({message:"Unsupported owned mutation"});rejected=true;
      }
    });
    const unchanged=JSON.stringify(test.sqlite.prepare("SELECT * FROM calendar_connections").all())===JSON.stringify(before);
    expect(unchanged).toBe(true);expect(rejected).toBe(true);
  });
  it.each([
    {form:"quoted literal",arm:"UPDATE",set:"label='WHERE'",label:"WHERE",where:" WHERE user_id=? AND id=?"},
    {form:"escaped literal with comma",arm:"UPDATE",set:"label='Synthetic '' WHERE, provider=literal'",label:"Synthetic ' WHERE, provider=literal",where:" WHERE user_id=? AND id=?"},
    {form:"nested subquery",arm:"UPDATE",set:"label=(SELECT 'Synthetic' WHERE 1)",label:"Synthetic",where:" WHERE user_id=? AND id=?"},
    {form:"quoted literal",arm:"conflict",set:"label='WHERE'",label:"WHERE",where:""},
    {form:"nested subquery",arm:"conflict",set:"label=(SELECT 'Synthetic' WHERE 1)",label:"Synthetic",where:" WHERE 1"},
  ])("N1 supports allowed mutable $form in $arm without losing the resource guard",async({arm,set,label,where})=>{
    const test=open();const connection=await seedCalendar(test,1);
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      const sql=arm==="UPDATE"?`UPDATE calendar_connections SET ${set}${where}`
        :`INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES (?,?,'google','Synthetic','2026-10-12','2026-10-12') ON CONFLICT(user_id,id) DO UPDATE SET ${set}${where}`;
      await prepareOwned(test.db,scope,sql,{kind:"calendar",id:connection.id}).bind(scope.userId,connection.id).run();
    });
    expect((await new D1CalendarConnectionRepository(test.db,scope).getById(connection.id))?.label).toBe(label);
    expect((await new D1CalendarConnectionRepository(test.db,scope).getById(connection.id))?.provider).toBe("google");
  });
  it.each([
    "(label)=('Synthetic')",'"label"=\'Synthetic\'',"`label`='Synthetic'","[label]='Synthetic'","unknown_column='Synthetic'",
  ])("N1 fails closed for unsupported mutable setter shape %s",async set=>{
    const test=open();const connection=await seedCalendar(test,1);
    const before=await new D1CalendarConnectionRepository(test.db,scope).getById(connection.id);
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      expect(()=>prepareOwned(test.db,scope,`UPDATE calendar_connections SET ${set} WHERE user_id=? AND id=?`,{kind:"calendar",id:connection.id})).toThrow("Unsupported owned mutation");
    });
    expect(await new D1CalendarConnectionRepository(test.db,scope).getById(connection.id)).toEqual(before);
  });
  it("fences credential and event-link writes retained by an old owner",async()=>{
    const test=open();const connection=await seedCalendar(test,1);
    const assignment=(await new D1AssignmentRepository(test.db,scope).list())[0]!;
    const links=new D1CalendarEventLinkRepository(test.db,scope);
    const link=await links.ensure(connection.id,assignment.id,"synthetic-key");
    const credentials=new D1CalendarCredentialRepository(test.db,scope,keyring);
    await credentials.setOAuthRefreshToken(connection.id,"synthetic-old");
    let credential!:Awaited<ReturnType<typeof credentials.prepareOAuthRefreshToken>>;
    await expect(withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      credential=await credentials.prepareOAuthRefreshToken(connection.id,"google","synthetic-new");
      test.sqlite.prepare("UPDATE operation_locks SET owner_nonce='replacement' WHERE operation_key='calendar:google'").run();
      await links.markSynced(link.id,"synthetic-new-event",null,"synthetic-hash",new Date().toISOString());
    })).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    await credential.run();
    expect(await credentials.getOAuthRefreshToken(connection.id)).toBe("synthetic-old");
    expect((await links.get(connection.id,assignment.id))?.remoteEventId).toBeNull();
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"running"});
  });
  it("holds four workers until every outstanding promise settles and excludes automatic/manual/connect work",async()=>{
    const test=open();const connection=await seedCalendar(test);
    const settle:Array<()=>void>=[];let calls=0;
    const remote=adapter({createEvent:async()=>{calls++;await new Promise<void>(resolve=>settle.push(resolve));return {remoteEventId:"synthetic-event",etag:null};}});
    const pending=reconcileCalendarConnection(test.db,scope,connection.id,{adapterFactory:async()=>remote});
    await vi.waitFor(()=>expect(calls).toBe(4));
    const competing=vi.fn(async()=>adapter());
    await expect(reconcileAllCalendars(test.db,scope,{adapterFactory:competing})).rejects.toMatchObject({code:"SYNC_IN_PROGRESS"});
    await reconcileCalendarsAfterSourceWrite(test.db,scope,keyring,{defer:false,changed:true,adapterFactory:competing});
    await expect(connectOAuthCalendar(test.db,scope,keyring,{provider:"google",accessToken:"synthetic-token",refreshToken:"synthetic-token",connectionId:connection.id,fetchImpl:vi.fn()})).rejects.toMatchObject({code:"SYNC_IN_PROGRESS"});
    expect(competing).not.toHaveBeenCalled();
    while(settle.length){settle.shift()!();await new Promise(resolve=>setTimeout(resolve,0));}
    await pending;
    expect(calls).toBe(6);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it.each((['google','microsoft','caldav'] as const).flatMap(provider=>(['blocked-before-transport','issued-write-fails'] as const).map(mode=>({provider,mode}))))('preserves the distinction between $provider rate cancellation and ambiguous transport: $mode',async({provider,mode})=>{
    const test=open(),connection=await seedCalendar(test,3,provider);
    const barrier=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
    const thirdReady=barrier(),resume=barrier();let gating=false,issuingWrite=false,checks=0,writes=0,rateReached=false;
    const wrap=(statement:ReturnType<D1DatabaseLike['prepare']>):ReturnType<D1DatabaseLike['prepare']>=>({
      bind:(...values)=>wrap(statement.bind(...values)),run:()=>statement.run(),all:()=>statement.all(),first:async<T>()=>{
        const writeCheck=gating&&issuingWrite,result=await statement.first<T>();
        if(writeCheck&&++checks===3&&mode==='blocked-before-transport'){thirdReady.resolve();await resume.promise;}
        return result;
      },
    });
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      const statement=test.db.prepare(sql);return sql.startsWith('SELECT (SELECT enabled')?wrap(statement):statement;
    }};
    installProviderRuntime(db);
    const transport=vi.fn<typeof fetch>(async(_url,init)=>{
      if(['GET','PROPFIND'].includes(init?.method??'GET')){
        gating=true;
        if(provider==='microsoft'&&new URL(String(_url)).pathname.endsWith('/events'))return Response.json({value:[]});
        return provider==='caldav'?new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/synthetic/calendars/kairos/</d:href><d:propstat><d:prop><d:displayname>Kairos</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207}):Response.json({id:'synthetic-calendar',name:'Kairos',summary:'Kairos',canEdit:true});
      }
      writes++;
      if(writes===1)return Response.json({id:'synthetic-first-event'},{headers:{etag:'synthetic-etag'}});
      if(writes===2){
        await thirdReady.promise;
        const response=new Response(null,{status:429,headers:{'Retry-After':'5'}}),get=response.headers.get.bind(response.headers);
        vi.spyOn(response.headers,'get').mockImplementation(name=>{if(name.toLowerCase()==='retry-after')rateReached=true;return get(name);});
        return response;
      }
      thirdReady.resolve();await resume.promise;throw new Error('synthetic ambiguous network failure');
    });
    const guarded=ownedFetch(transport),fetchImpl:typeof fetch=(input,init)=>{
      issuingWrite=!['GET','HEAD','PROPFIND','REPORT','OPTIONS'].includes(init?.method??'GET');
      try{return guarded(input,init);}finally{issuingWrite=false;}
    };
    const factory=async()=>registerFencedCalendarAdapter(provider==='google'
      ?new GoogleCalendarAdapter(connection,new GoogleCalendarClient('synthetic-access',fetchImpl))
      :provider==='microsoft'?new MicrosoftCalendarAdapter(connection,new MicrosoftCalendarClient('synthetic-access',fetchImpl))
        :new CalDavCalendarAdapter(connection,new CalDavClient('synthetic@example.invalid','synthetic-password',fetchImpl)));
    const pending=reconcileCalendarConnection(db,scope,connection.id,{adapterFactory:factory,concurrency:2}).then(result=>({result}),error=>({error}));
    try{await vi.waitFor(()=>expect(rateReached).toBe(true));}finally{resume.resolve();}
    const outcome=await pending;
    if(mode==='blocked-before-transport'){
      expect(outcome).toMatchObject({result:{status:'partial',createdCount:1,failedCount:2}});expect(writes).toBe(2);
      expect(test.sqlite.prepare('SELECT DISTINCT last_error_code FROM calendar_event_links WHERE last_error_code IS NOT NULL').all()).toEqual([{last_error_code:'CALENDAR_RATE_LIMITED'}]);
    }else{expect(outcome).toMatchObject({error:{code:'SYNC_RECOVERY_REQUIRED'}});expect(writes).toBe(3);}
    const owner=test.sqlite.prepare("SELECT state,not_before_ms-CAST(strftime('%s','now') AS INTEGER)*1000 AS remaining FROM operation_locks").get() as {state:string;remaining:number};
    expect(owner.state).toBe(mode==='blocked-before-transport'?'idle':'uncertain');expect(owner.remaining).toBeGreaterThan(0);expect(owner.remaining).toBeLessThanOrEqual(5000);
    expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM calendar_event_links WHERE remote_event_id IS NOT NULL').get()).toEqual({n:1});
  });

  it("stops additional remote calls after throttling, honors a short Retry-After, and waits for other workers",async()=>{
    const test=open();const connection=await seedCalendar(test);
    let release!:()=>void;let calls=0;
    const transport=ownedFetch(async()=>new Response(null,{status:429,headers:{"Retry-After":"5"}}));
    const remote=adapter({createEvent:async()=>{
      calls++;if(calls===1){await transport("https://synthetic.invalid",{method:"POST"});throw new CalendarSyncError("CALENDAR_RATE_LIMITED","Synthetic throttle");}
      await new Promise<void>(resolve=>{release=resolve;});return {remoteEventId:"synthetic-event",etag:null};
    }});
    const pending=reconcileCalendarConnection(test.db,scope,connection.id,{adapterFactory:async()=>remote,concurrency:2});
    await vi.waitFor(()=>expect(calls).toBe(2));
    await expect(reconcileCalendarConnection(test.db,scope,connection.id,{adapterFactory:async()=>remote})).rejects.toMatchObject({code:"SYNC_IN_PROGRESS"});
    release();await pending;
    const row=test.sqlite.prepare("SELECT state,not_before_ms-CAST(strftime('%s','now') AS INTEGER)*1000 AS remaining FROM operation_locks").get() as {state:string;remaining:number};
    expect(row.state).toBe("idle");expect(row.remaining).toBeGreaterThan(0);expect(row.remaining).toBeLessThanOrEqual(5000);
    expect(calls).toBe(2);
    await expect(reconcileCalendarConnection(test.db,scope,connection.id,{adapterFactory:async()=>remote})).rejects.toMatchObject({code:"RATE_LIMITED"});
  });
  it("retains ambiguous calendar writes until recovery and releases a settled known read rejection",async()=>{
    const test=open();const connection=await seedCalendar(test,1);
    await expect(reconcileCalendarConnection(test.db,scope,connection.id,{adapterFactory:async()=>adapter({createEvent:async()=>{throw new CalendarSyncError("CALENDAR_NETWORK_ERROR","Synthetic transport ambiguity");}})})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});
    const second=open();const other=await seedCalendar(second,1);
    await reconcileCalendarConnection(second.db,scope,other.id,{adapterFactory:async()=>{throw new CalendarSyncError("CALENDAR_PERMISSION_DENIED","Known rejection");}});
    expect(second.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it("releases a known guard-storage rejection before token transport",async()=>{
    const test=open();const connection=await seedCalendar(test,1);
    await new D1CalendarCredentialRepository(test.db,scope,keyring).setOAuthRefreshToken(connection.id,"synthetic-old");
    let reject=true;
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      if(reject&&sql.startsWith("SELECT (SELECT enabled")){reject=false;throw new AbuseStorageUnavailableError();}
      return test.db.prepare(sql);
    }};
    const transport=vi.fn<typeof fetch>();
    await expect(reconcileCalendarConnection(db,scope,connection.id,{adapterFactory:createCalendarAdapterFactory(db,scope,keyring,{env:{GOOGLE_CALENDAR_CLIENT_ID:"synthetic-client"},fetchImpl:transport})})).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(transport).not.toHaveBeenCalled();
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"idle"});
  });
  it("retains coded credential-storage failure after actual remote token rotation",async()=>{
    const test=open();const connection=await seedCalendar(test,1);
    const credentials=new D1CalendarCredentialRepository(test.db,scope,keyring);
    await credentials.setOAuthRefreshToken(connection.id,"synthetic-old");
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      if(sql.includes("INSERT INTO calendar_credentials"))throw Object.assign(new Error("Synthetic storage rejection"),{code:"SYNTHETIC_SQL_FAILURE"});
      return test.db.prepare(sql);
    }};
    const transport=vi.fn<typeof fetch>(async()=>Response.json({access_token:"synthetic-access",refresh_token:"synthetic-new",expires_in:3600}));
    await expect(reconcileCalendarConnection(db,scope,connection.id,{adapterFactory:createCalendarAdapterFactory(db,scope,keyring,{env:{GOOGLE_CALENDAR_CLIENT_ID:"synthetic-client"},fetchImpl:transport})})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await credentials.getOAuthRefreshToken(connection.id)).toBe("synthetic-old");
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});
  });
  it("rejects foreign and duplicate bridge completes without writing or releasing",async()=>{
    const test=open();const started=await startGradescopeDiscovery(test.db,scope);
    const result={requestId:started.requestId,protocolVersion:1 as const,courses:[],errorCode:null};
    await expect(completeGradescopeDiscovery(test.db,{userId:"synthetic-other"},result)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"running"});
    await completeGradescopeDiscovery(test.db,scope,result);
    const next=await startGradescopeDiscovery(test.db,scope);
    await expect(completeGradescopeDiscovery(test.db,scope,result)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(test.sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"running"});
    expect(next.requestId).not.toBe(started.requestId);
  });
  it("retains extension timeout uncertainty rather than allowing a new remote bridge start",async()=>{
    const test=open();const started=await startGradescopeDiscovery(test.db,scope);
    await expect(completeGradescopeDiscovery(test.db,scope,{requestId:started.requestId,protocolVersion:1,courses:[],errorCode:"EXTENSION_TIMEOUT"})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    await expect(startGradescopeDiscovery(test.db,scope)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
  });
  it.each([[null,60],["invalid",60],["999999",3600],["0",1]] as const)("bounds provider cooldown for header %s",async(header,seconds)=>{
    const test=open();
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{await ownedFetch(async()=>new Response(null,{status:429,headers:header===null?{}:{"Retry-After":header}}))("https://synthetic.invalid");});
    const row=test.sqlite.prepare("SELECT not_before_ms-CAST(strftime('%s','now') AS INTEGER)*1000 AS remaining FROM operation_locks").get() as {remaining:number};
    expect(row.remaining).toBeGreaterThan(0);expect(row.remaining).toBeLessThanOrEqual(seconds*1000);
  });
  it("keeps accepted batch state atomically and uses fixed bounded binds for 150 assignments",async()=>{
    const test=open();const source=await new D1SourceConnectionRepository(test.db,scope).upsertCanvas("Accepted");
    const rows=Array.from({length:150},(_,i)=>({source:"canvas" as const,externalId:`synthetic-${i}`,courseId:null,courseName:"Synthetic",title:"Synthetic",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}));
    const prepare=test.db.prepare.bind(test.db);let maxBinds=0;const lengths:number[]=[];
    vi.spyOn(test.db,"prepare").mockImplementation(sql=>{lengths.push(sql.length);const statement=prepare(sql);const bind=statement.bind.bind(statement);statement.bind=(...values)=>{maxBinds=Math.max(maxBinds,values.length);return bind(...values);};return statement;});
    await withOwnedOperation(test.db,scope,"source:canvas",async()=>{
      const repo=new D1AssignmentRepository(test.db,scope);
      await test.db.batch([repo.prepareUpsertMany(source.id,rows,"2026-10-01T00:00:00.000Z")]);
      const update=new D1SourceConnectionRepository(test.db,scope).prepareSyncSuccess(source.id,"2026-10-02T00:00:00.000Z");
      const invalid=prepare("INSERT INTO assignments(user_id,id) VALUES ('missing','bad')");
      await expect(test.db.batch([update,invalid])).rejects.toThrow();
    });
    expect((await new D1AssignmentRepository(test.db,scope).list())).toHaveLength(150);
    expect((await new D1SourceConnectionRepository(test.db,scope).getByKind("canvas"))?.lastSyncStatus).toBe("never");
    expect(maxBinds).toBeLessThanOrEqual(11);expect(Math.max(...lengths)).toBeLessThan(4000);
  });
  it("blocks accepted mutations when a provider is paused after the remote read",async()=>{
    const test=open();const connections=new D1SourceConnectionRepository(test.db,scope);
    const source=await connections.upsertEd("Accepted");
    const transport:typeof fetch=async()=>{
      test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:ed'").run();
      return Response.json({user:{id:1},courses:[]});
    };
    await expect(connectEd(test.db,scope,keyring,"synthetic-new",transport)).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect((await connections.getById(source.id))?.label).toBe("Accepted");
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM source_credentials").get()).toEqual({n:0});
  });
});
