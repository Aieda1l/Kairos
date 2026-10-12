import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {enforceBudget} from "@/lib/abuse/guard";
import type {AbuseRuntime,RateSubject} from "@/lib/abuse/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {connectEd,testEdConnection,refreshEdCourses} from "@/lib/ed/discovery-service";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import {withProviderWork,currentProviderWork,withProviderContinuation} from "@/lib/abuse/provider-operation";
import {withOwnedOperation} from "@/lib/abuse/operation-lock";
import {connectCanvas,testCanvasConnection} from "@/lib/sources/canvas-ical/connection-service";
import {syncCanvasConnection} from "@/lib/sync/sync-source";
import {syncEdConnection} from "@/lib/ed/sync-service";
import {startGradescopeDiscovery} from "@/lib/gradescope/discovery-service";
import {startGradescopeSync} from "@/lib/gradescope/sync-service";
import {startCanvasSubmissionStatusSync} from "@/lib/submission-status/sync-service";
import {connectCaldavCalendar,connectOAuthCalendar,testCaldavCredentials,removeManagedCalendarEvents} from "@/lib/calendar/connection-service";
import {reconcileAllCalendars,reconcileCalendarConnection} from "@/lib/calendar/reconcile";
import {registerOAuthRequest} from "@/lib/calendar/oauth-registry";
import {abuseErrorResponse} from "@/lib/abuse/guard";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {ProviderWorkContext} from "@/lib/abuse/provider-operation";
import {deleteCurrentAccount} from "@/lib/account/delete-account";

const bindings=vi.hoisted(()=>({source:vi.fn(),calendar:vi.fn(),abuse:vi.fn()}));
vi.mock("@/lib/platform/source-runtime",async original=>({...await original<object>(),getSourceRuntimeContext:bindings.source}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:bindings.calendar}));
vi.mock("@/lib/platform/abuse-runtime",async original=>({...await original<object>(),getAbuseRuntime:bindings.abuse}));
let test:ReturnType<typeof openD1TestDatabase>,runtime:AbuseRuntime;
const scope={userId:"synthetic-owner"},other={userId:"synthetic-other"};
const keyring={activeKeyId:"synthetic",keys:{synthetic:new Uint8Array(32).fill(9)}};
let sourceIds:Record<string,string>,calendarIds:Record<string,string>,upstream:number;
const request=(path:string,body:unknown={},method="POST")=>new Request(`http://127.0.0.1:3000/api/${path}`,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const routes=import.meta.glob<{POST:(request:Request,options?:unknown)=>Promise<Response>;GET:(request:Request)=>Promise<Response>}>("../../src/app/api/**/route.ts");
async function loadRoute(path:string){return routes[`../../src/app/api/${path}/route.ts`]!();}
async function call(path:string,body:unknown={}){
  const route=await loadRoute(path);
  return route.POST(request(path,body)) as Promise<Response>;
}
async function destination(provider:string,action:string,id=calendarIds[provider]!){
  const route=await loadRoute(`calendars/[id]/${action}`);
  return route.POST(request(`calendars/${id}/${action}`),{params:Promise.resolve({id})}) as Promise<Response>;
}
async function exhaust(subject:RateSubject,limit:number){for(let i=0;i<limit;i++)await enforceBudget(runtime,subject);}
const rateRows=()=>test.sqlite.prepare("SELECT count(*) AS n FROM abuse_rate_events").get() as {n:number};
beforeEach(async()=>{
  test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-owner'),('synthetic-other')");
  upstream=0;
  vi.stubGlobal("fetch",async()=>{upstream++;return Response.json({user:{id:1},courses:[]});});
  runtime={db:test.db,hmacKey:new Uint8Array(32).fill(7),appOrigin:"https://synthetic.invalid",hostname:"synthetic.invalid",turnstileSecret:"synthetic-secret",fetchImpl:fetch};
  bindings.abuse.mockResolvedValue(runtime);
  bindings.source.mockResolvedValue({db:test.db,scope,keyring});
  bindings.calendar.mockResolvedValue({kind:"hosted",db:test.db,scope,keyring});
  vi.stubEnv("KAIROS_APP_URL","");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","synthetic-client");
  vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","11111111-1111-4111-8111-111111111111");
  vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_SECRET","synthetic-secret");
  vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});
  sourceIds={};calendarIds={};
  const sources=new D1SourceConnectionRepository(test.db,scope);
  const credentials=new D1SourceCredentialRepository(test.db,scope,keyring);
  for(const provider of ["canvas","ed","gradescope"] as const){
    const connection=provider==="canvas"?await sources.upsertCanvas("Synthetic"):provider==="ed"?await sources.upsertEd("Synthetic"):await sources.upsertGradescope("Synthetic");
    sourceIds[provider]=connection.id;
    if(provider==="canvas")await credentials.setCanvasFeedUrl(connection.id,"https://canvas.uw.edu/feeds/calendars/synthetic.ics");
    if(provider==="ed")await credentials.setEdApiToken(connection.id,"synthetic-token");
    if(provider!=="canvas"){
      const courses=new D1SourceCourseRepository(test.db,scope);
      await courses.upsertDiscovered(connection.id,[{externalCourseId:"1",shortName:"Synthetic",fullName:"Synthetic",term:null,year:null}],new Date().toISOString());
      await courses.setEnabled(connection.id,["1"]);
    }
  }
  for(const provider of ["google","microsoft","caldav"] as const){
    const repo=new D1CalendarConnectionRepository(test.db,scope);
    const connection=await repo.create({provider,label:"Synthetic"});
    calendarIds[provider]=connection.id;
    await repo.updateRemoteCalendar(connection.id,"synthetic-calendar","Synthetic");
    const secrets=new D1CalendarCredentialRepository(test.db,scope,keyring);
    if(provider==="caldav")await secrets.setCaldavCredentials(connection.id,"synthetic@example.invalid","synthetic-secret");
    else await secrets.setOAuthRefreshToken(connection.id,"synthetic-refresh");
  }
});
afterEach(()=>{test.close();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});

const credentialRoutes=[
  {provider:"canvas",path:"sources/canvas/test",body:{feedUrl:"https://canvas.uw.edu/feeds/calendars/synthetic.ics"}},
  {provider:"canvas",path:"sources/canvas/connect",body:{feedUrl:"https://canvas.uw.edu/feeds/calendars/synthetic.ics"}},
  {provider:"ed",path:"sources/ed/test",body:{token:"synthetic-token"}},
  {provider:"ed",path:"sources/ed/connect",body:{token:"synthetic-token"}},
  {provider:"ed",path:"sources/ed/refresh",body:{}},
  {provider:"gradescope",path:"sources/gradescope/discover/start",body:{}},
  {provider:"caldav",path:"calendars/caldav/test",body:{username:"synthetic@example.invalid",secret:"synthetic-secret"}},
  {provider:"caldav",path:"calendars/caldav/connect",body:{username:"synthetic@example.invalid",secret:"synthetic-secret"}},
  {provider:"google",path:"calendars/google/start",body:{}},
  {provider:"microsoft",path:"calendars/microsoft/start",body:{}},
] as const;
const sourceSyncRoutes=[
  {provider:"canvas",path:"sources/canvas/sync"},
  {provider:"canvas",path:"sources/canvas/submission-status/start"},
  {provider:"ed",path:"sources/ed/sync"},
  {provider:"gradescope",path:"sources/gradescope/sync/start"},
] as const;
const bridges=[
  {provider:"canvas",start:"sources/canvas/submission-status/start",complete:"sources/canvas/submission-status/complete",kind:"canvas_submission",payload:(id:string)=>({requestId:id,results:[]})},
  {provider:"gradescope",start:"sources/gradescope/discover/start",complete:"sources/gradescope/discover/complete",kind:"gradescope_discovery",payload:(id:string)=>({requestId:id,protocolVersion:1,courses:[],errorCode:null})},
  {provider:"gradescope",start:"sources/gradescope/sync/start",complete:"sources/gradescope/sync/complete",kind:"gradescope_sync",payload:(id:string)=>({requestId:id,batches:[],batchErrorCode:"EXTENSION_UNAVAILABLE"})},
] as const;
describe("actual upstream route admission",()=>{
  it.each(credentialRoutes)("rejects exhausted shared $provider credential bucket at $path before work",async({provider,path,body})=>{
    await exhaust({class:"credential",userId:scope.userId,provider},10);
    const response=await call(path,body);
    expect(response.status).toBe(429);expect(await response.json()).toMatchObject({code:"RATE_LIMITED",retryAfterSeconds:expect.any(Number)});
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstream).toBe(0);
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM sync_requests").get()).toEqual({n:0});
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM oauth_requests").get()).toEqual({n:0});
  });
  it.each(sourceSyncRoutes)("rejects exhausted source budget at $path",async({provider,path})=>{
    await exhaust({class:"source-sync",userId:scope.userId,provider,resourceId:sourceIds[provider]!},12);
    const response=await call(path);expect(response.status).toBe(429);expect(upstream).toBe(0);
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM sync_requests").get()).toEqual({n:0});
  });
  it.each(["google","microsoft","caldav"])("guards %s destination sync and removal with the same resource budget",async provider=>{
    await exhaust({class:"calendar-sync",userId:scope.userId,provider:provider as "google"|"microsoft"|"caldav",resourceId:calendarIds[provider]!},12);
    for(const action of ["sync","remove-events"]){expect((await destination(provider,action)).status).toBe(429);}
    expect(upstream).toBe(0);
  });
  it("guards sync-all before child scheduling",async()=>{
    await exhaust({class:"sync-all",userId:scope.userId},6);
    expect((await call("calendars/sync-all")).status).toBe(429);expect(upstream).toBe(0);
  });
  it.each([...credentialRoutes,...sourceSyncRoutes])("authenticates $path before any admission",async({path,...input})=>{
    bindings.source.mockRejectedValue(new AuthenticationRequiredError());bindings.calendar.mockRejectedValue(new AuthenticationRequiredError());
    const response=await call(path,"body" in input?input.body:{});expect(response.status).toBe(401);expect(upstream).toBe(0);
    expect(rateRows()).toEqual({n:0});
  });
  it.each(["google","microsoft","caldav"])("does not charge a foreign %s destination",async provider=>{
    const foreign=await new D1CalendarConnectionRepository(test.db,other).create({provider:provider as "google"|"microsoft"|"caldav",label:"Synthetic"});
    expect((await destination(provider,"sync",foreign.id)).status).toBe(404);
    expect((await destination(provider,"remove-events",foreign.id)).status).toBe(404);
    const response=await call(`calendars/${provider}/${provider==="caldav"?"connect":"start"}`,provider==="caldav"?{connectionId:foreign.id,username:"synthetic@example.invalid",secret:"synthetic-secret"}:{connectionId:foreign.id});
    expect(response.status).toBe(provider==="caldav"?404:400);expect(rateRows()).toEqual({n:0});expect(upstream).toBe(0);
  });
});

describe("continuations and private entry points",()=>{
  it("reuses a source-write admission through the actual sync service",async()=>{
    await withProviderWork(runtime,scope,{provider:"canvas",operation:"source-write",resourceId:sourceIds.canvas},async()=>{
      await syncCanvasConnection(sourceIds.canvas!,{db:test.db,scope,keyring,sourceFactory:()=>({sync:async()=>[],getLastParseReport:()=>({skipped:0,errors:[]})})});
    });
    expect(rateRows()).toEqual({n:1});expect(upstream).toBe(0);
  });
  it("does not lend a manual admission to another same-provider destination",async()=>{
    const repo=new D1CalendarConnectionRepository(test.db,scope);const second=await repo.create({provider:"google",label:"Synthetic"});
    await repo.updateRemoteCalendar(second.id,"synthetic-second","Synthetic");
    await exhaust({class:"calendar-sync",userId:scope.userId,provider:"google",resourceId:second.id},12);
    await withProviderWork(runtime,scope,{provider:"google",operation:"manual-sync",resourceId:calendarIds.google},async()=>{
      await expect(removeManagedCalendarEvents(test.db,scope,keyring,second.id)).rejects.toMatchObject({code:"RATE_LIMITED"});
    });
    expect(upstream).toBe(0);
  });
  it("rejects unsuccessful bridge storage acknowledgment before accepting the result",async()=>{
    const {requestId}=await (await call("sources/gradescope/discover/start")).json();
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      const statement=test.db.prepare(sql);
      if(!sql.includes("UPDATE sync_requests"))return statement;
      const wrap=(value:ReturnType<D1DatabaseLike["prepare"]>):ReturnType<D1DatabaseLike["prepare"]>=>({
        bind:(...values)=>wrap(value.bind(...values)),first:()=>value.first(),all:()=>value.all(),run:async<T>()=>({...await value.run<T>(),success:false}),
      });
      return wrap(statement);
    }};
    bindings.source.mockResolvedValue({db,scope,keyring});
    const response=await call("sources/gradescope/discover/complete",{requestId,protocolVersion:1,courses:[],errorCode:null});
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(upstream).toBe(0);
  });
  it.each(["google","microsoft"] as const)("returns stable storage failure for %s claimed-state read before transport",async provider=>{
    const {authorizationUrl}=await (await call(`calendars/${provider}/start`)).json();const state=new URL(authorizationUrl).searchParams.get("state")!;
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      if(sql.includes("SELECT provider,code_verifier_envelope"))throw new Error("synthetic-private-storage-error");
      return test.db.prepare(sql);
    }};
    bindings.calendar.mockResolvedValue({kind:"hosted",db,scope,keyring});
    const callback=await loadRoute(`calendars/${provider}/callback`);
    const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&code=synthetic-private-code`));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});expect(upstream).toBe(0);
  });
  it("fails admission storage closed before direct service transport",async()=>{
    const db:D1DatabaseLike={batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db),prepare:sql=>{
      if(sql.includes("INSERT INTO abuse_rate_events"))throw new Error("synthetic-private-storage-error");
      return test.db.prepare(sql);
    }};
    const failure=await testEdConnection(db,scope,"synthetic-token",fetch).then(()=>null,error=>error);
    const response=abuseErrorResponse(failure)!;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});expect(upstream).toBe(0);
  });
  it("binds guarded transport to the issuing owner and invalidates it after return",async()=>{
    let issued!:ProviderWorkContext;
    const transport=async()=>{upstream++;return new Response(null,{status:204});};
    await withProviderWork({...runtime,fetchImpl:transport},scope,{provider:"ed",operation:"credential"},async context=>{
      issued=context;expect((await context.fetch("https://synthetic.invalid")).status).toBe(204);
      await withProviderWork(runtime,scope,{provider:"google",operation:"credential"},async()=>{
        await expect(context.check()).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
        expect(()=>context.fetch("https://synthetic.invalid")).toThrow();
      });
    });
    await expect(issued.check()).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});expect(()=>issued.fetch("https://synthetic.invalid")).toThrow();expect(upstream).toBe(1);
  });
  it.each(bridges)("rejects missing, foreign, removed, and replayed $kind admission without charging completion",async bridge=>{
    expect((await call(bridge.complete,bridge.payload(crypto.randomUUID()))).status).toBe(409);
    const started=await call(bridge.start);expect(started.status).toBe(200);
    const {requestId}=await started.json();const payload=bridge.payload(requestId);
    bindings.source.mockResolvedValueOnce({db:test.db,scope:other,keyring});
    expect((await call(bridge.complete,payload)).status).toBe(409);
    bindings.source.mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await call(bridge.complete,payload)).status).toBe(401);
    test.sqlite.prepare("UPDATE sync_requests SET admitted_at_ms=NULL WHERE request_id=?").run(requestId);
    expect((await call(bridge.complete,payload)).status).toBe(409);
    expect(test.sqlite.prepare("SELECT consumed_at FROM sync_requests WHERE request_id=?").get(requestId)).toEqual({consumed_at:null});
    expect(rateRows()).toEqual({n:1});expect(upstream).toBe(0);
  });
  it.each(bridges)("charges $kind start once and leaves completion usable after bucket exhaustion",async bridge=>{
    const started=await call(bridge.start);expect(started.status).toBe(200);
    const {requestId}=await started.json();
    await exhaust(bridge.kind==="gradescope_discovery"?{class:"credential",userId:scope.userId,provider:"gradescope"}
      :{class:"source-sync",userId:scope.userId,provider:bridge.provider,resourceId:sourceIds[bridge.provider]!},bridge.kind==="gradescope_discovery"?9:11);
    const completed=await call(bridge.complete,bridge.payload(requestId));
    expect(completed.status).toBe(200);expect(rateRows()).toEqual({n:bridge.kind==="gradescope_discovery"?10:12});
    expect((await call(bridge.complete,bridge.payload(requestId))).status).toBe(409);
  });
  it.each(bridges)("rejects $kind after pause/reopen with a stable service code",async bridge=>{
    const {requestId}=await (await call(bridge.start)).json();
    test.sqlite.prepare("UPDATE abuse_controls SET version=version+2 WHERE control_key=?").run(`provider:${bridge.provider}`);
    const completed=await call(bridge.complete,bridge.payload(requestId));
    expect(completed.status).toBe(409);expect(await completed.json()).toMatchObject({code:"PROVIDER_AUTHORIZATION_CHANGED"});
    expect(test.sqlite.prepare("SELECT consumed_at FROM sync_requests WHERE request_id=?").get(requestId)).toEqual({consumed_at:null});
  });
  it.each(["google","microsoft"] as const)("requires server-held %s admission before token exchange",async provider=>{
    const {authorizationUrl}=await (await call(`calendars/${provider}/start`)).json();const state=new URL(authorizationUrl).searchParams.get("state")!;
    const callback=await loadRoute(`calendars/${provider}/callback`);
    const req=new Request(`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&code=synthetic-private-code`);
    bindings.calendar.mockRejectedValueOnce(new AuthenticationRequiredError());expect((await callback.GET(req)).status).toBe(401);
    bindings.calendar.mockResolvedValueOnce({kind:"hosted",db:test.db,scope:other,keyring});expect((await callback.GET(req)).status).toBe(400);
    test.sqlite.prepare("UPDATE oauth_requests SET admitted_at_ms=NULL").run();
    expect((await callback.GET(req)).status).toBe(400);expect(upstream).toBe(0);expect(rateRows()).toEqual({n:1});
  });
  it("reuses exact nested admission and still charges a bare B4 owner",async()=>{
    await withProviderWork(runtime,scope,{provider:"ed",operation:"credential"},async context=>{
      expect(currentProviderWork(test.db,scope,"ed")).toBe(context);
      await withProviderWork(runtime,scope,{provider:"ed",operation:"credential"},async nested=>{expect(nested).toBe(context);await testEdConnection(test.db,scope,"synthetic-token",fetch);});
    });
    expect(currentProviderWork(test.db,scope,"ed")).toBeNull();expect(rateRows()).toEqual({n:1});
    await withOwnedOperation(test.db,scope,"source:ed",()=>testEdConnection(test.db,scope,"synthetic-token",fetch));
    expect(rateRows()).toEqual({n:2});
  });
  it("rejects caller run IDs and copied OAuth objects as exemptions",async()=>{
    await expect(withProviderWork(runtime,scope,{provider:"ed",operation:"credential",runId:"synthetic"},async()=>{upstream++;})).rejects.toMatchObject({code:"ABUSE_SUBJECT_INVALID"});
    await withOwnedOperation(test.db,scope,"calendar:google",async()=>{
      await expect(withProviderContinuation(test.db,scope,{provider:"google",controlVersion:0,codeVerifier:"synthetic",redirectUri:"http://127.0.0.1:3000",returnTo:"/sources",connectionId:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()},async()=>{upstream++;})).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    });
    expect(upstream).toBe(0);expect(rateRows()).toEqual({n:0});
  });
  it.each([...credentialRoutes,...sourceSyncRoutes])("checks controls at $path before upstream work or budget",async({path,provider,...input})=>{
    test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run(`provider:${provider}`);
    expect((await call(path,"body" in input?input.body:{})).status).toBe(503);expect(upstream).toBe(0);expect(rateRows()).toEqual({n:0});
  });
  it("rechecks controls before each scheduled adapter call and retains accepted state",async()=>{
    let scheduled=0;
    const adapterFactory=async()=>({provider:"google" as const,testConnection:async()=>{scheduled++;test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:google'").run();},ensureCalendar:async()=>{scheduled++;return {remoteCalendarId:"synthetic",name:"Synthetic"};},getEvent:async()=>{scheduled++;return null;},createEvent:async()=>{scheduled++;return {remoteEventId:"synthetic",etag:null};},updateEvent:async()=>{scheduled++;return {remoteEventId:"synthetic",etag:null};},deleteEvent:async()=>{scheduled++;}});
    await expect(reconcileCalendarConnection(test.db,scope,calendarIds.google!,{adapterFactory})).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(scheduled).toBe(1);expect((await new D1CalendarConnectionRepository(test.db,scope).getById(calendarIds.google!))?.remoteCalendarId).toBe("synthetic-calendar");
  });
  it("guards every common upstream service independently of route wrappers",async()=>{
    for(const provider of ["canvas","ed","gradescope","google","microsoft","caldav"] as const){
      await exhaust({class:"credential",userId:scope.userId,provider},10);
      await exhaust(provider==="canvas"||provider==="ed"||provider==="gradescope"
        ?{class:"source-sync",userId:scope.userId,provider,resourceId:sourceIds[provider]!}
        :{class:"calendar-sync",userId:scope.userId,provider,resourceId:calendarIds[provider]!},12);
    }
    await exhaust({class:"sync-all",userId:scope.userId},6);
    const hosted={db:test.db,scope,keyring};const factory=async()=>{upstream++;throw new Error("Synthetic upstream must not run");};
    const entries=[
      ()=>testCanvasConnection(hosted,"https://canvas.uw.edu/feeds/calendars/synthetic.ics"),
      ()=>connectCanvas(hosted,{feedUrl:"https://canvas.uw.edu/feeds/calendars/synthetic.ics"}),
      ()=>syncCanvasConnection(sourceIds.canvas!,hosted),()=>startCanvasSubmissionStatusSync(test.db,scope),
      ()=>testEdConnection(test.db,scope,"synthetic-token",fetch),()=>connectEd(test.db,scope,keyring,"synthetic-token",fetch),()=>refreshEdCourses(test.db,scope,keyring,fetch),()=>syncEdConnection(test.db,scope,keyring),
      ()=>startGradescopeDiscovery(test.db,scope),()=>startGradescopeSync(test.db,scope),
      ()=>testCaldavCredentials(test.db,scope,"synthetic@example.invalid","synthetic",fetch),()=>connectCaldavCalendar(test.db,scope,keyring,{username:"synthetic@example.invalid",secret:"synthetic"}),
      ...(["google","microsoft"] as const).flatMap(provider=>[
        ()=>registerOAuthRequest(test.db,scope,keyring,{provider,redirectUri:`http://127.0.0.1:3000/api/calendars/${provider}/callback`}),
        ()=>connectOAuthCalendar(test.db,scope,keyring,{provider,accessToken:"synthetic",refreshToken:"synthetic"}),
      ]),
      ...(["google","microsoft","caldav"] as const).flatMap(provider=>[
        ()=>reconcileCalendarConnection(test.db,scope,calendarIds[provider]!,{adapterFactory:factory}),
        ()=>removeManagedCalendarEvents(test.db,scope,keyring,calendarIds[provider]!,{adapterFactory:factory}),
      ]),()=>reconcileAllCalendars(test.db,scope,{adapterFactory:factory}),
    ];
    for(const entry of entries)await expect(entry()).rejects.toMatchObject({code:"RATE_LIMITED"});
    expect(upstream).toBe(0);
  });
  it.each(["google","microsoft","caldav"])("authenticates %s destination mutations and keeps local disconnect available under shutdown",async provider=>{
    bindings.calendar.mockRejectedValueOnce(new AuthenticationRequiredError());expect((await destination(provider,"sync")).status).toBe(401);
    bindings.calendar.mockRejectedValueOnce(new AuthenticationRequiredError());expect((await destination(provider,"remove-events")).status).toBe(401);
    test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run(`provider:${provider}`);
    const repo=new D1CalendarConnectionRepository(test.db,scope);expect(await repo.getById(calendarIds[provider]!)).not.toBeNull();
    const route=await loadRoute("calendars/[id]/disconnect");
    expect((await route.POST(request("calendars/disconnect"),{params:Promise.resolve({id:calendarIds[provider]})})).status).toBe(200);
    expect(rateRows()).toEqual({n:0});expect(upstream).toBe(0);
  });
  it("authenticates sync-all and preserves local account deletion under provider shutdown",async()=>{
    bindings.calendar.mockRejectedValueOnce(new AuthenticationRequiredError());expect((await call("calendars/sync-all")).status).toBe(401);
    test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key LIKE 'provider:%'").run();
    const route=await import("@/app/api/account/route");expect((await route.DELETE(request("account",{confirmation:"DELETE"},"DELETE"))).status).toBe(204);expect(upstream).toBe(0);
  });
});

describe("common services and durable continuations",()=>{
  it("shares ten credential attempts across regular routes, retained candidate services and refresh",async()=>{
    // A draft consumer must call these same services; no route-only limiter can pass this.
    for(let i=0;i<3;i++){
      expect((await call("sources/ed/test",{token:"synthetic-token"})).status).toBe(200);
      await connectEd(test.db,scope,keyring,"synthetic-token",fetch);
      await refreshEdCourses(test.db,scope,keyring,fetch);
    }
    await testEdConnection(test.db,scope,"synthetic-token",fetch);
    expect(upstream).toBe(10);
    await expect(connectEd(test.db,scope,keyring,"synthetic-token",fetch)).rejects.toMatchObject({code:"RATE_LIMITED"});
    expect((await call("sources/ed/refresh")).status).toBe(429);expect(upstream).toBe(10);
  });
  it.each(["google","microsoft"] as const)("charges %s start once and requires a durable admitted state at callback",async provider=>{
    const started=await call(`calendars/${provider}/start`,{connectionId:calendarIds[provider]});
    expect(started.status).toBe(200);expect(rateRows()).toEqual({n:1});
    const state=new URL((await started.json()).authorizationUrl).searchParams.get("state")!;
    await exhaust({class:"credential",userId:scope.userId,provider},9);
    vi.stubGlobal("fetch",async(input:RequestInfo|URL)=>{
      upstream++;
      if(String(input).includes("token"))return Response.json({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600});
      if(String(input).includes("calendarList/"))return Response.json({id:"synthetic-calendar",accessRole:"owner"});
      if(String(input).includes("/me/calendars/"))return Response.json({id:"synthetic-calendar",canEdit:true});
      return Response.json({items:[{id:"synthetic-calendar",summary:"Kairos",accessRole:"owner"}],value:[{id:"synthetic-calendar",name:"Kairos",canEdit:true}]});
    });
    const route=await loadRoute(`calendars/${provider}/callback`);
    const url=`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&code=synthetic-code`;
    expect((await route.GET(new Request(url))).status).toBe(307);expect(rateRows()).toEqual({n:10});
    const previous=upstream;
    expect((await route.GET(new Request(url))).status).toBe(400);expect(upstream).toBe(previous);
  });
  it("charges discovery start once and refuses a stored bridge request with removed admission",async()=>{
    const started=await call("sources/gradescope/discover/start");const body=await started.json();
    expect(started.status).toBe(200);expect(rateRows()).toEqual({n:1});
    await exhaust({class:"credential",userId:scope.userId,provider:"gradescope"},9);
    const completed=await call("sources/gradescope/discover/complete",{requestId:body.requestId,protocolVersion:1,courses:[],errorCode:null});
    expect(completed.status).toBe(200);expect(rateRows()).toEqual({n:10});
    expect((await call("sources/gradescope/discover/complete",{requestId:body.requestId,protocolVersion:1,courses:[],errorCode:null})).status).toBe(409);
  });
});

describe("account confirmation admission",()=>{
  async function remove(body:unknown){return (await import("@/app/api/account/route")).DELETE(request("account",body,"DELETE"));}
  it("authenticates before malformed confirmation and charges invalid confirmation attempts",async()=>{
    bindings.source.mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await remove({confirmation:"wrong"})).status).toBe(401);expect(rateRows()).toEqual({n:0});
    for(let i=0;i<5;i++)expect((await remove({confirmation:"wrong"})).status).toBe(400);
    expect((await remove({confirmation:"DELETE"})).status).toBe(429);
    expect(test.sqlite.prepare("SELECT id FROM users WHERE id=?").get(scope.userId)).toBeTruthy();
  });
  it("enforces the confirmation budget at the common deletion service",async()=>{
    await exhaust({class:"deletion",userId:scope.userId},5);
    await expect(deleteCurrentAccount(test.db,scope)).rejects.toMatchObject({code:"RATE_LIMITED"});
    expect(test.sqlite.prepare("SELECT id FROM users WHERE id=?").get(scope.userId)).toBeTruthy();
  });
  it("charges a valid fifth confirmation only once through route and service",async()=>{
    for(let i=0;i<4;i++)expect((await remove({confirmation:"wrong"})).status).toBe(400);
    expect((await remove({confirmation:"DELETE"})).status).toBe(204);
  });
});
