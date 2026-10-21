import {installProviderRuntime} from "../helpers/provider-runtime";
import {afterEach,describe,expect,it,vi} from "vitest";
import {connectEd,refreshEdCourses,replaceEnabledEdCourses} from "@/lib/ed/discovery-service";
import {completeGradescopeDiscovery,startGradescopeDiscovery,replaceEnabledGradescopeCourses} from "@/lib/gradescope/discovery-service";
import {connectCaldavCalendar,connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const runtime=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/platform/source-api-runtime",()=>({resolveSourceApiRuntime:async()=>({ok:true,runtime:runtime.get()})}));
const scope={userId:"recovery-user"};
const keyring={activeKeyId:"test",keys:{test:new Uint8Array(32).fill(31)}};
const brokenKeyring={activeKeyId:"broken",keys:{...keyring.keys,broken:new Uint8Array(1)}};
const oldAt="2026-10-01T00:00:00.000Z";
const now=new Date("2026-10-11T00:00:00.000Z");
const oldFeed="https://canvas.uw.edu/feeds/calendars/synthetic-old.ics";
const candidateFeed="https://canvas.uw.edu/feeds/calendars/synthetic-candidate.ics";
const calendarId="https://caldav.icloud.com/fixture/calendars/kairos/";
const databases:ReturnType<typeof openD1TestDatabase>[]=[];

function open(){
  const test=openD1TestDatabase();installProviderRuntime(test.db);databases.push(test);
  test.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(scope.userId);
  runtime.get.mockReturnValue({kind:"hosted",db:test.db,scope,keyring});
  return test;
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const db of databases.splice(0))db.close();});

function state(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  return Object.fromEntries([
    "source_connections","source_credentials","source_courses","assignments",
    "assignment_submission_status","calendar_connections","calendar_credentials","calendar_event_links",
  ].map(table=>[table,sqlite.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY rowid`).all(scope.userId)]));
}
function event(id:string,title:string){
  return `BEGIN:VEVENT\nUID:event-assignment-${id}\nDTSTART:20261015T065900Z\nSUMMARY:${title} [Synthetic course]\nEND:VEVENT`;
}
function feed(...events:string[]){return `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join("\n")}\nEND:VCALENDAR`;}
async function canvasPost(feedUrl=candidateFeed){
  const {POST}=await import("@/app/api/sources/canvas/connect/route");
  return POST(new Request("https://app.example.invalid/api/sources/canvas/connect",{
    method:"POST",body:JSON.stringify({feedUrl,label:"Replacement"}),
  }));
}
async function seedSource(db:ReturnType<typeof openD1TestDatabase>["db"],kind:"canvas"|"ed"|"gradescope"="canvas"){
  const repo=new D1SourceConnectionRepository(db,scope);
  const connection=await (kind==="canvas"?repo.upsertCanvas("Working"):kind==="ed"?repo.upsertEd("Working"):repo.upsertGradescope("Working"));
  if(kind==="canvas")await new D1SourceCredentialRepository(db,scope,keyring).setCanvasFeedUrl(connection.id,oldFeed);
  if(kind==="ed")await new D1SourceCredentialRepository(db,scope,keyring).setEdApiToken(connection.id,"synthetic-old-token");
  await repo.markSyncStarted(connection.id,oldAt);await repo.markSyncSuccess(connection.id,oldAt);
  await new D1AssignmentRepository(db,scope).upsertMany(connection.id,[{
    source:kind,externalId:"event-assignment-1",courseId:"1",courseName:"Synthetic course",title:"Working assignment",
    releaseAt:null,dueAt:oldAt,lateDueAt:null,status:"submitted",sourceStatusText:null,
    gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,
  }],oldAt);
  await new D1SourceCourseRepository(db,scope).upsertDiscovered(connection.id,[
    {externalCourseId:"1",shortName:"S1",fullName:"Course one",term:null,year:null},
    {externalCourseId:"2",shortName:"S2",fullName:"Course two",term:null,year:null},
  ],oldAt);
  await new D1SourceCourseRepository(db,scope).setEnabled(connection.id,["1"]);
  return connection;
}
async function seedCalendar(db:ReturnType<typeof openD1TestDatabase>["db"],provider:"caldav"|"google"|"microsoft"="caldav"){
  await seedSource(db);
  const repo=new D1CalendarConnectionRepository(db,scope);
  const connection=await repo.create({provider,label:"Working",accountLabel:"old@example.invalid"});
  await repo.updateRemoteCalendar(connection.id,provider==="caldav"?calendarId:"old-remote","Working calendar");
  await repo.markSyncStarted(connection.id,oldAt);
  await repo.markSyncResult(connection.id,{completedAt:oldAt,status:"success",errorCode:null});
  const credentials=new D1CalendarCredentialRepository(db,scope,keyring);
  if(provider==="caldav")await credentials.setCaldavCredentials(connection.id,"old@example.invalid","synthetic-old-secret");
  else await credentials.setOAuthRefreshToken(connection.id,"synthetic-old-refresh");
  const assignment=(await new D1AssignmentRepository(db,scope).list())[0]!;
  const links=new D1CalendarEventLinkRepository(db,scope);
  const link=await links.ensure(connection.id,assignment.id,"synthetic-sync-key");
  await links.markSynced(link.id,"working-event","working-etag","working-hash",oldAt);
  return connection;
}
function edFetch(name="Replacement",count=2):typeof fetch{
  return async()=>Response.json({user:{id:1},courses:Array.from({length:count},(_,i)=>({
    course:{id:i+1,code:`S${i+1}`,name,year:"2026",session:"Autumn"},role:{role:"student"},
  }))});
}
function caldavFetch(options:{missing?:boolean;writable?:boolean}={}):typeof fetch{
  const collection=`<d:response><d:href>${calendarId}</d:href><d:propstat><d:prop><d:displayname>Candidate calendar</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:${options.writable===false?"read":"write"}/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  return async(input,init)=>{
    if(init?.method!=="PROPFIND")throw new Error("Unexpected remote mutation");
    const url=String(input);
    if(url===calendarId&&options.missing)return new Response(null,{status:404});
    const body=url==="https://caldav.icloud.com/"
      ?"<d:response><d:propstat><d:prop><d:current-user-principal><d:href>/fixture/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>"
      :url.endsWith("/principal/")
        ?"<d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/fixture/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>"
        :url===calendarId||!options.missing?collection:"";
    return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`,{status:207});
  };
}

describe("failure-safe hosted Canvas replacement",()=>{
  it.each(["unauthorized feed","invalid feed","parser failure"])("retains all working state on %s",async failure=>{
    const {db,sqlite}=open();await seedSource(db);const before=state(sqlite);
    vi.stubGlobal("fetch",async()=>new Response(failure==="invalid feed"?"not a calendar":feed(event("1","Candidate")),{status:failure==="unauthorized feed"?401:200}));
    if(failure==="parser failure")vi.stubGlobal("fetch",async()=>new Response("BEGIN:VCALENDAR\nEND:VCALENDAR"));
    expect((await canvasPost()).status).toBeGreaterThanOrEqual(400);
    expect(state(sqlite)).toEqual(before);
    expect(await new D1SourceCredentialRepository(db,scope,keyring).getCanvasFeedUrl((await new D1SourceConnectionRepository(db,scope).getByKind("canvas"))!.id)).toBe(oldFeed);
  });
  it("rejects an invalid replacement URL before provider work",async()=>{
    const {db,sqlite}=open();await seedSource(db);const before=state(sqlite);
    const fetchImpl=vi.fn();vi.stubGlobal("fetch",fetchImpl);
    expect((await canvasPost("file:///synthetic.ics")).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();expect(state(sqlite)).toEqual(before);
  });
  it.each([
    "https://unsupported.example.invalid/feed.ics", "https://canvas.uw.edu:8443/feed.ics",
    "http://canvas.uw.edu/feed.ics", "https://user:secret@canvas.uw.edu/feed.ics",
  ])("retains working state and sends no request for unsupported initial destination %s",async candidate=>{
    const {db,sqlite}=open();await seedCalendar(db);const before=state(sqlite);
    const transport=vi.fn(async()=>new Response(feed(event("1","Forbidden candidate"))));
    vi.stubGlobal("fetch",transport);
    expect((await canvasPost(candidate)).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();expect(state(sqlite)).toEqual(before);
  });
  it.each([
    "https://unsupported.example.invalid/feed.ics", "http://127.0.0.1:3000/forbidden",
    "https://canvas.uw.edu:8443/feed.ics", "https://user:secret@canvas.uw.edu/feed.ics",
  ])("retains working state and makes zero forbidden requests on redirect escape %s",async location=>{
    const {db,sqlite}=open();await seedCalendar(db);const before=state(sqlite);
    let forbiddenRequests=0;
    const transport:typeof fetch=async(input,init)=>{
      if(String(input)===candidateFeed){
        if(init?.redirect==="manual")return new Response(null,{status:302,headers:{location}});
        // Model native automatic redirect behavior without using a real network.
        forbiddenRequests++;
      }else forbiddenRequests++;
      return new Response(feed(event("1","Forbidden candidate")));
    };
    vi.stubGlobal("fetch",transport);
    expect((await canvasPost()).status).toBe(400);
    expect(forbiddenRequests).toBe(0);expect(state(sqlite)).toEqual(before);
    expect(await new D1SourceCredentialRepository(db,scope,keyring).getCanvasFeedUrl((await new D1SourceConnectionRepository(db,scope).getByKind("canvas"))!.id)).toBe(oldFeed);
  });
  it("commits a valid UW snapshot after a same-origin redirect",async()=>{
    const {db}=open();const old=await seedSource(db);const requests:string[]=[];
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      requests.push(String(input));expect(init?.redirect).toBe("manual");
      return requests.length===1?new Response(null,{status:302,headers:{location:"./synthetic-accepted.ics"}}):new Response(feed(event("1","Accepted redirect")));
    });
    const response=await canvasPost();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({connection:{id:old.id,lastSyncStatus:"success"},sync:{inserted:0,updated:1}});
    expect(requests).toEqual([candidateFeed,"https://canvas.uw.edu/feeds/calendars/synthetic-accepted.ics"]);
    expect(await new D1SourceCredentialRepository(db,scope,keyring).getCanvasFeedUrl(old.id)).toBe(candidateFeed);
  });
  it("validates labels at the reusable service boundary before fetching",async()=>{
    const {db,sqlite}=open();await seedSource(db);const before=state(sqlite);
    const {connectCanvas}=await import("@/lib/sources/canvas-ical/connection-service");
    const fetchImpl=vi.fn(async()=>new Response(feed(event("1","Candidate"))));vi.stubGlobal("fetch",fetchImpl);
    await expect(connectCanvas({db,scope,keyring},{feedUrl:candidateFeed,label:"x".repeat(81)})).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();expect(state(sqlite)).toEqual(before);
  });
  it("commits the accepted snapshot without a vulnerable second fetch",async()=>{
    const {db,sqlite}=open();const old=await seedSource(db);
    const assignmentId=(await new D1AssignmentRepository(db,scope).list())[0]!.id;
    const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(feed(event("1","Accepted assignment")))).mockRejectedValue(new Error("Synthetic second-fetch failure"));
    vi.stubGlobal("fetch",fetchImpl);
    const response=await canvasPost();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({connection:{id:old.id,lastSyncStatus:"success"},sync:{inserted:0,updated:1,partial:false}});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await new D1AssignmentRepository(db,scope).list())[0]).toMatchObject({id:assignmentId,title:"Accepted assignment",firstSeenAt:oldAt});
    expect((state(sqlite).source_courses)).toHaveLength(2);
  });
  it("leaves no partially configured source after a first connection commit fails",async()=>{
    const {sqlite}=open();const before=state(sqlite);
    sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON source_credentials BEGIN SELECT RAISE(ABORT,'synthetic credential failure'); END");
    vi.stubGlobal("fetch",async()=>new Response(feed(event("1","Candidate"))));
    expect((await canvasPost()).status).toBe(502);expect(state(sqlite)).toEqual(before);
  });
  it("preserves the accepted credential and freshness on encryption failure",async()=>{
    const {db,sqlite}=open();await seedSource(db);const before=state(sqlite);
    runtime.get.mockReturnValue({kind:"hosted",db,scope,keyring:brokenKeyring});
    vi.stubGlobal("fetch",async()=>new Response(feed(event("1","Candidate"))));
    const unavailable=await canvasPost();expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe('SERVICE_UNAVAILABLE');expect(state(sqlite)).toEqual(before);
  });
  it("rolls back metadata, envelope and assignments after a data statement fails",async()=>{
    const {db,sqlite}=open();await seedSource(db);const before=state(sqlite);
    sqlite.exec("CREATE TRIGGER fail_assignment BEFORE UPDATE ON assignments BEGIN SELECT RAISE(ABORT,'synthetic assignment failure'); END");
    vi.stubGlobal("fetch",async()=>new Response(feed(event("1","Candidate"))));
    expect((await canvasPost()).status).toBe(502);expect(state(sqlite)).toEqual(before);
  });
  it("retains unseen assignments during partial parsing",async()=>{
    const {db}=open();await seedSource(db);
    vi.stubGlobal("fetch",async()=>new Response(feed(event("2","Accepted"),"BEGIN:VEVENT\nUID:event-assignment-bad\nEND:VEVENT")));
    const response=await canvasPost();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({sync:{inserted:1,updated:0,partial:true,skipped:1}});
    expect(await new D1AssignmentRepository(db,scope).list()).toHaveLength(2);
  });
});

describe("atomic hosted Ed and Gradescope discovery and selection",()=>{
  it.each([401,200])("retains Ed state on invalid candidate response %s",async status=>{
    const {db,sqlite}=open();await seedSource(db,"ed");const before=state(sqlite);
    await expect(connectEd(db,scope,keyring,"synthetic-candidate",async()=>new Response("{}",{status}),now)).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
  });
  it.each(["encryption","course write"])("retains Ed state on %s failure",async failure=>{
    const {db,sqlite}=open();await seedSource(db,"ed");const before=state(sqlite);
    if(failure==="course write")sqlite.exec("CREATE TRIGGER fail_course BEFORE UPDATE ON source_courses WHEN NEW.external_course_id='2' BEGIN SELECT RAISE(ABORT,'synthetic course failure'); END");
    await expect(connectEd(db,scope,failure==="encryption"?brokenKeyring:keyring,"synthetic-candidate",edFetch(),now)).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
  });
  it("retains the complete discovery snapshot after Ed rediscovery fails midway",async()=>{
    const {db,sqlite}=open();await seedSource(db,"ed");const before=state(sqlite);
    sqlite.exec("CREATE TRIGGER fail_course BEFORE UPDATE ON source_courses WHEN NEW.external_course_id='2' BEGIN SELECT RAISE(ABORT,'synthetic course failure'); END");
    await expect(refreshEdCourses(db,scope,keyring,edFetch(),now)).rejects.toThrow();expect(state(sqlite)).toEqual(before);
  });
  it("preserves Ed connection, assignment IDs and enabled courses on accepted replacement",async()=>{
    const {db}=open();const old=await seedSource(db,"ed");const assignments=await new D1AssignmentRepository(db,scope).list();
    const result=await connectEd(db,scope,keyring,"synthetic-candidate",edFetch(),now);
    expect(result.connection).toMatchObject({id:old.id,lastSyncCompletedAt:oldAt,lastSyncStatus:"success"});
    expect(result.courses.map(c=>[c.externalCourseId,c.enabled])).toEqual([["1",true],["2",false]]);
    expect(await new D1AssignmentRepository(db,scope).list()).toEqual(assignments);
  });
  it("rolls back Gradescope connection and all courses on rediscovery failure",async()=>{
    const {db,sqlite}=open();await seedSource(db,"gradescope");const before=state(sqlite);
    const started=await startGradescopeDiscovery(db,scope,now);
    sqlite.exec("CREATE TRIGGER fail_course BEFORE UPDATE ON source_courses WHEN NEW.external_course_id='2' BEGIN SELECT RAISE(ABORT,'synthetic course failure'); END");
    await expect(completeGradescopeDiscovery(db,scope,{...started,errorCode:null,courses:["1","2"].map(courseId=>({courseId,shortName:null,fullName:"Replacement",term:null,year:null}))},now)).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
  });
  it.each(["ed","gradescope"] as const)("keeps the prior %s selection after a selection write fails",async kind=>{
    const {db,sqlite}=open();await seedSource(db,kind);const before=state(sqlite);
    sqlite.exec("CREATE TRIGGER fail_selection BEFORE UPDATE ON source_courses WHEN NEW.external_course_id='2' AND NEW.enabled=1 BEGIN SELECT RAISE(ABORT,'synthetic selection failure'); END");
    await expect(kind==="ed"?replaceEnabledEdCourses(db,scope,keyring,["2"]):replaceEnabledGradescopeCourses(db,scope,["2"])).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
  });
});

describe("failure-safe hosted calendar replacement",()=>{
  it.each(['owner','writer','writerWithoutPrivateAccess'])('verifies %s event access on the exact saved Google calendar when CalendarList rejects the grant',async accessRole=>{
    const {db,sqlite}=open(),old=await seedCalendar(db,'google'),before=state(sqlite).calendar_event_links;
    const fetchImpl=vi.fn<typeof fetch>(async(input,init)=>{
      expect(init?.method).toBe('GET');const url=new URL(String(input));
      if(url.pathname.includes('/calendarList/'))return Response.json({error:{errors:[{reason:'insufficientPermissions'}]}},{status:403});
      expect(url.pathname).toBe('/calendar/v3/calendars/old-remote/events');
      expect(url.searchParams.get('maxResults')).toBe('1');expect(url.searchParams.get('fields')).toBe('accessRole');
      return Response.json({accessRole});
    });
    const result=await connectOAuthCalendar(db,scope,keyring,{provider:'google',connectionId:old.id,accessToken:'synthetic-access',refreshToken:'synthetic-new-refresh',fetchImpl});
    expect(result).toMatchObject({id:old.id,remoteCalendarId:'old-remote',enabled:true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);expect(state(sqlite).calendar_event_links).toEqual(before);
  });
  it.each(['reader','freeBusyReader','none',null])('preserves the accepted Google connection when fallback event access is %s',async accessRole=>{
    const {db,sqlite}=open(),old=await seedCalendar(db,'google'),before=state(sqlite);
    const fetchImpl:typeof fetch=async(input)=>String(input).includes('/calendarList/')?new Response(null,{status:403}):Response.json({accessRole});
    await expect(connectOAuthCalendar(db,scope,keyring,{provider:'google',connectionId:old.id,accessToken:'synthetic-access',refreshToken:'synthetic-new-refresh',fetchImpl})).rejects.toMatchObject({code:accessRole===null?'CALENDAR_UPSTREAM_ERROR':'CALENDAR_PERMISSION_DENIED'});
    expect(state(sqlite)).toEqual(before);
  });
  it('reports Google access rejection as permission denied and preserves the accepted connection',async()=>{
    const {db,sqlite}=open(),old=await seedCalendar(db,'google'),before=state(sqlite);
    const fetchImpl:typeof fetch=async()=>new Response(null,{status:403});
    await expect(connectOAuthCalendar(db,scope,keyring,{provider:'google',connectionId:old.id,accessToken:'synthetic-access',refreshToken:'synthetic-new-refresh',fetchImpl})).rejects.toMatchObject({code:'CALENDAR_PERMISSION_DENIED'});
    expect(state(sqlite)).toEqual(before);
  });
  it.each([
    ['accessNotConfigured','CALENDAR_CONFIG_MISSING'],['SERVICE_DISABLED','CALENDAR_CONFIG_MISSING'],
    ['rateLimitExceeded','CALENDAR_RATE_LIMITED'],['userRateLimitExceeded','CALENDAR_RATE_LIMITED'],
  ])('keeps a Google %s failure distinct from expired consent',async(reason,code)=>{
    const {db,sqlite}=open(),old=await seedCalendar(db,'google'),before=state(sqlite);
    const fetchImpl=vi.fn<typeof fetch>(async()=>Response.json({error:{errors:[{reason}]}},{status:403}));
    await expect(connectOAuthCalendar(db,scope,keyring,{provider:'google',connectionId:old.id,accessToken:'synthetic-access',refreshToken:'synthetic-new-refresh',fetchImpl})).rejects.toMatchObject({code});
    expect(fetchImpl).toHaveBeenCalledTimes(1);expect(state(sqlite)).toEqual(before);
  });
  it('re-enables a recovered Google destination only after fresh consent and preserves its mappings',async()=>{
    const {db,sqlite}=open(),old=await seedCalendar(db,'google');
    sqlite.prepare('DELETE FROM calendar_credentials WHERE user_id=? AND calendar_connection_id=?').run(scope.userId,old.id);
    sqlite.prepare('UPDATE calendar_connections SET enabled=0,last_error_code=? WHERE user_id=? AND id=?').run('CALENDAR_AUTH_REQUIRED',scope.userId,old.id);
    const links=state(sqlite).calendar_event_links;
    const fetchImpl=vi.fn<typeof fetch>(async(_url,init)=>{expect(init?.method).toBe('GET');return Response.json({id:'old-remote',summary:'Kairos',accessRole:'owner'});});
    const result=await connectOAuthCalendar(db,scope,keyring,{provider:'google',connectionId:old.id,accessToken:'synthetic-access',refreshToken:'synthetic-refresh',fetchImpl});
    expect(result).toMatchObject({id:old.id,remoteCalendarId:'old-remote',enabled:true});
    expect(await new D1CalendarConnectionRepository(db,scope).getById(old.id)).toMatchObject({enabled:true});
    expect(state(sqlite).calendar_event_links).toEqual(links);
  });
  it.each(["authorization","read-only","missing","encryption","D1"])("retains credentials, remote IDs, links and freshness on iCloud %s failure",async failure=>{
    const {db,sqlite}=open();const old=await seedCalendar(db);const before=state(sqlite);
    if(failure==="D1")sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON calendar_credentials BEGIN SELECT RAISE(ABORT,'synthetic credential failure'); END");
    const fetchImpl=failure==="authorization"?async()=>new Response(null,{status:401}):caldavFetch({missing:failure==="missing",writable:failure!=="read-only"});
    await expect(connectCaldavCalendar(db,scope,failure==="encryption"?brokenKeyring:keyring,{connectionId:old.id,username:"candidate@example.invalid",secret:"synthetic-candidate",fetchImpl})).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
    expect(await new D1CalendarCredentialRepository(db,scope,keyring).getCaldavCredentials(old.id)).toEqual({username:"old@example.invalid",secret:"synthetic-old-secret"});
  });
  it.each(["google","microsoft"] as const)("requires an explicit recovery decision for a missing %s calendar",async provider=>{
    const {db,sqlite}=open();const old=await seedCalendar(db,provider);const before=state(sqlite);
    const mutations:string[]=[];
    const fetchImpl:typeof fetch=async(_input,init)=>{
      if(init?.method==="POST"){mutations.push("create");return Response.json({id:"new-remote",name:"Kairos",summary:"Kairos"});}
      return provider==="microsoft"?Response.json({value:[]}):new Response(null,{status:404});
    };
    // Both providers must return 404 for the stored calendar; list discovery is separate.
    const missingFetch:typeof fetch=async(input,init)=>String(input).includes("old-remote")?new Response(null,{status:404}):fetchImpl(input,init);
    await expect(connectOAuthCalendar(db,scope,keyring,{provider,connectionId:old.id,accessToken:"synthetic-access",refreshToken:"synthetic-candidate",fetchImpl:missingFetch})).rejects.toMatchObject({code:"CALENDAR_REMOTE_CALENDAR_MISSING"});
    expect(mutations).toEqual([]);expect(state(sqlite)).toEqual(before);
  });
  it.each(["google","microsoft"] as const)("atomically retains %s metadata and token on credential write failure",async provider=>{
    const {db,sqlite}=open();const old=await seedCalendar(db,provider);const before=state(sqlite);
    sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON calendar_credentials BEGIN SELECT RAISE(ABORT,'synthetic credential failure'); END");
    await expect(connectOAuthCalendar(db,scope,keyring,{provider,connectionId:old.id,accessToken:"synthetic-access",refreshToken:"synthetic-candidate",fetchImpl:async()=>Response.json({id:"old-remote",summary:"Kairos",name:"Kairos",canEdit:true,accessRole:"owner"})})).rejects.toThrow();
    expect(state(sqlite)).toEqual(before);
  });
  it.each(["google","microsoft"] as const)("rejects a read-only %s candidate without replacing working state",async provider=>{
    const {db,sqlite}=open();const old=await seedCalendar(db,provider);const before=state(sqlite);
    await expect(connectOAuthCalendar(db,scope,keyring,{provider,connectionId:old.id,accessToken:"synthetic-access",refreshToken:"synthetic-candidate",fetchImpl:async()=>Response.json({id:"old-remote",summary:"Kairos",name:"Kairos",canEdit:false,accessRole:"reader"})})).rejects.toMatchObject({code:"CALENDAR_PERMISSION_DENIED"});
    expect(state(sqlite)).toEqual(before);
  });
  it("preserves IDs and event mappings on successful iCloud replacement",async()=>{
    const {db,sqlite}=open();const old=await seedCalendar(db);const links=state(sqlite).calendar_event_links;
    expect(await connectCaldavCalendar(db,scope,keyring,{connectionId:old.id,username:"candidate@example.invalid",secret:"synthetic-candidate",fetchImpl:caldavFetch()})).toMatchObject({id:old.id,remoteCalendarId:calendarId,lastSyncCompletedAt:oldAt,lastSyncStatus:"success"});
    expect(state(sqlite).calendar_event_links).toEqual(links);
    expect(await new D1CalendarCredentialRepository(db,scope,keyring).getCaldavCredentials(old.id)).toEqual({username:"candidate@example.invalid",secret:"synthetic-candidate"});
  });
  it.each(["google","microsoft"] as const)("does not delete a provisioned %s calendar after a local commit failure",async provider=>{
    const {db,sqlite}=open();const before=state(sqlite);const remoteMutations:string[]=[];
    sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON calendar_credentials BEGIN SELECT RAISE(ABORT,'synthetic credential failure'); END");
    const fetchImpl:typeof fetch=async(input,init)=>{
      const method=init?.method??"GET";
      if(method!=="GET")remoteMutations.push(method);
      if(method==="DELETE")throw new Error("Destructive compensation is forbidden");
      if(provider==="microsoft"&&method==="GET"&&String(input).endsWith("/me/calendars"))return Response.json({value:[]});
      return Response.json({id:"provisioned",name:"Kairos",summary:"Kairos",canEdit:true,accessRole:"owner"});
    };
    await expect(connectOAuthCalendar(db,scope,keyring,{provider,accessToken:"synthetic-access",refreshToken:"synthetic-refresh",fetchImpl})).rejects.toThrow();
    expect(remoteMutations).toEqual(["POST"]);expect(state(sqlite)).toEqual(before);
  });
  it.each(["google","microsoft"] as const)("preserves %s mappings and reuses an existing refresh token when none is returned",async provider=>{
    const {db,sqlite}=open();const old=await seedCalendar(db,provider);const links=state(sqlite).calendar_event_links;
    const result=await connectOAuthCalendar(db,scope,keyring,{provider,connectionId:old.id,accessToken:"synthetic-access",refreshToken:null,fetchImpl:async()=>Response.json({id:"old-remote",summary:"Kairos",name:"Kairos",canEdit:true,accessRole:"owner"})});
    expect(result).toMatchObject({id:old.id,remoteCalendarId:"old-remote",lastSyncCompletedAt:oldAt,lastSyncStatus:"success"});
    expect(state(sqlite).calendar_event_links).toEqual(links);
    expect(await new D1CalendarCredentialRepository(db,scope,keyring).getOAuthRefreshToken(old.id)).toBe("synthetic-old-refresh");
  });
});

describe("bounded D1 candidate commits",()=>{
  it("connects 150 Canvas assignments within statement, parameter and free-plan query limits",async()=>{
    const {db}=open();const prepare=db.prepare.bind(db);let queries=0;
    vi.spyOn(db,"prepare").mockImplementation(sql=>{
      queries++;expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(100_000);
      const statement=prepare(sql),bind=statement.bind.bind(statement);
      vi.spyOn(statement,"bind").mockImplementation((...values)=>{expect(values.length).toBeLessThanOrEqual(100);return bind(...values);});
      return statement;
    });
    vi.stubGlobal("fetch",async()=>new Response(feed(...Array.from({length:150},(_,i)=>event(String(i+1),`Assignment ${i+1}`)))));
    const response=await canvasPost();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({sync:{inserted:150,updated:0}});
    expect(queries).toBeLessThan(20);
    expect(await new D1AssignmentRepository(db,scope).list()).toHaveLength(150);
  });
  it("discovers and selects 150 Ed courses without splitting the credential commit",async()=>{
    const {db}=open();const prepare=db.prepare.bind(db);let queries=0;
    vi.spyOn(db,"prepare").mockImplementation(sql=>{
      queries++;expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(100_000);
      const statement=prepare(sql),bind=statement.bind.bind(statement);
      vi.spyOn(statement,"bind").mockImplementation((...values)=>{expect(values.length).toBeLessThanOrEqual(100);return bind(...values);});
      return statement;
    });
    const result=await connectEd(db,scope,keyring,"synthetic-token",edFetch("Candidate",150),now);
    expect(result.courses).toHaveLength(150);
    // These are separate API operations. Bound each request, including its real
    // admission/control SQL, while keeping the credential acceptance atomic.
    expect(queries).toBeLessThan(20);queries=0;
    const selected=await replaceEnabledEdCourses(db,scope,keyring,Array.from({length:150},(_,i)=>String(i+1)));
    expect(selected.courses.every(c=>c.enabled)).toBe(true);expect(queries).toBeLessThan(20);
  });
});
