import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import {D1OnboardingRepository} from "@/lib/db/d1/repositories/onboarding";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import {decryptCredential} from "@/lib/security/credential-cipher";
import * as cipher from "@/lib/security/credential-cipher";
import {deleteCurrentAccount} from "@/lib/account/delete-account";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const bindings=vi.hoisted(()=>({source:vi.fn(),calendar:vi.fn(),abuse:vi.fn()}));
vi.mock("@/lib/platform/source-runtime",async original=>({...await original<object>(),getSourceRuntimeContext:bindings.source}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:bindings.calendar}));
vi.mock("@/lib/platform/abuse-runtime",async original=>({...await original<object>(),getAbuseRuntime:bindings.abuse}));
const scope={userId:"synthetic-owner"},other={userId:"synthetic-other"};
const keyring={activeKeyId:"synthetic",keys:{synthetic:new Uint8Array(32).fill(9)}};
const candidates={
  canvas:{kind:"canvas",feedUrl:"https://canvas.uw.edu/feeds/calendars/candidate-private-feed.ics"},
  ed:{kind:"ed",token:"candidate-private-token"},
  caldav:{kind:"caldav",username:"candidate-private-account@example.invalid",secret:"candidate-private-password"},
} as const;
type Kind=keyof typeof candidates;
type Handler=(request:Request)=>Promise<Response>;
const routes=import.meta.glob<Record<string,Handler>>("../../src/app/api/**/route.ts");
const draftPath="settings/onboarding/draft";
const request=(path:string,method:string,body?:unknown,headers?:HeadersInit)=>new Request(`https://synthetic.invalid/api/${path}`,{
  method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
});
async function call(path:string,method:string,body?:unknown,headers?:HeadersInit){
  const loader=routes[`../../src/app/api/${path}/route.ts`];
  // A missing new handler is an observable RED, rather than an import error.
  if(!loader)return Response.json({code:"HANDLER_MISSING"},{status:501});
  return (await loader())[method]!(request(path,method,body,headers));
}
const save=(kind:Kind)=>call(draftPath,"PUT",candidates[kind]);
const use=(kind:Kind,action:"test"|"connect",extra:Record<string,unknown>={})=>call(draftPath,"POST",{kind,action,...extra});
const metadata=async()=>{const response=await call(draftPath,"GET");expect(response.status).toBe(200);return response.json();};
let test:ReturnType<typeof openD1TestDatabase>,upstream:number;
function bind(userScope=scope){
  bindings.source.mockResolvedValue({db:test.db,scope:userScope,keyring});
  bindings.calendar.mockResolvedValue({kind:"hosted",db:test.db,scope:userScope,keyring});
}
const event="BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-assignment-1\nDTSTART:20261015T065900Z\nSUMMARY:Accepted [Synthetic]\nEND:VEVENT\nEND:VCALENDAR";
const remote="https://caldav.icloud.com/fixture/calendars/kairos/";
function caldavBody(input:RequestInfo|URL){
  const url=String(input);
  const body=url==="https://caldav.icloud.com/"
    ?"<d:response><d:propstat><d:prop><d:current-user-principal><d:href>/fixture/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>"
    :url.endsWith("/principal/")
      ?"<d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/fixture/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>"
      :`<d:response><d:href>${remote}</d:href><d:propstat><d:prop><d:displayname>Kairos</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  return `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
}
beforeEach(()=>{
  test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-owner'),('synthetic-other')");
  upstream=0;
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    upstream++;
    if(init?.method==="PROPFIND")return new Response(caldavBody(input),{status:207});
    if(String(input).startsWith("https://canvas.uw.edu/"))return new Response(event);
    return Response.json({user:{id:1},courses:[{course:{id:1,code:"S1",name:"Synthetic",year:"2026",session:"Autumn"},role:{role:"student"}}]});
  });
  bindings.abuse.mockResolvedValue({db:test.db,hmacKey:new Uint8Array(32).fill(7),appOrigin:"https://synthetic.invalid",hostname:"synthetic.invalid",turnstileSecret:"synthetic",fetchImpl:fetch});
  bind();
  vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});
});
afterEach(()=>{test.close();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
const draftRows=(user=scope.userId)=>test.sqlite.prepare("SELECT key,value FROM app_settings WHERE user_id=? AND key LIKE 'onboarding_draft:%' ORDER BY key").all(user) as {key:string;value:string}[];
const acceptedState=()=>Object.fromEntries([
  "source_connections","source_credentials","source_courses","assignments","assignment_submission_status",
  "calendar_connections","calendar_credentials","calendar_event_links",
].map(table=>[table,test.sqlite.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY rowid`).all(scope.userId)]));
async function seedWorking(kind:Kind){
  const sources=new D1SourceConnectionRepository(test.db,scope);
  const connection=kind==="ed"?await sources.upsertEd("Working"):await sources.upsertCanvas("Working");
  const credentials=new D1SourceCredentialRepository(test.db,scope,keyring);
  if(kind==="ed")await credentials.setEdApiToken(connection.id,"synthetic-working-token");
  else await credentials.setCanvasFeedUrl(connection.id,"https://canvas.uw.edu/feeds/calendars/synthetic-working.ics");
  await new D1SourceCourseRepository(test.db,scope).upsertDiscovered(connection.id,[{externalCourseId:"1",shortName:"S1",fullName:"Working",term:null,year:null}],"2026-10-01T00:00:00.000Z");
  await new D1SourceCourseRepository(test.db,scope).setEnabled(connection.id,["1"]);
  await new D1AssignmentRepository(test.db,scope).upsertMany(connection.id,[{
    source:kind==="ed"?"ed":"canvas",externalId:"event-assignment-1",courseId:"1",courseName:"Working",title:"Working",
    releaseAt:null,dueAt:null,lateDueAt:null,status:"submitted",sourceStatusText:null,gradeScore:null,gradeMax:null,
    gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,
  }],"2026-10-01T00:00:00.000Z");
  const calendars=new D1CalendarConnectionRepository(test.db,scope);
  const calendar=await calendars.create({provider:"caldav",label:"Working"});
  await calendars.updateRemoteCalendar(calendar.id,remote,"Working");
  await new D1CalendarCredentialRepository(test.db,scope,keyring).setCaldavCredentials(calendar.id,"working@example.invalid","synthetic-working-secret");
  const assignment=(await new D1AssignmentRepository(test.db,scope).list())[0]!;
  const links=new D1CalendarEventLinkRepository(test.db,scope);
  const link=await links.ensure(calendar.id,assignment.id,"synthetic-sync-key");
  await links.markSynced(link.id,"working-event","working-etag","working-hash","2026-10-01T00:00:00.000Z");
  return {connection,calendar};
}

describe("privately saved onboarding candidates",()=>{
  it.each(["canvas","ed","caldav"] as const)("back_and_reload_can_reuse_saved_candidate: %s",async kind=>{
    expect((await save(kind)).status).toBe(200);
    await call("settings/onboarding","PATCH",{command:{type:"visit",step:"timezone"},expectedRevision:0});
    bind(); // Re-resolve a fresh request/session, keeping only D1 state.
    expect(await metadata()).toEqual({drafts:[{kind,saved:true}]});
    const before=acceptedState();
    const response=await use(kind,"test");expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok:true});
    expect(upstream).toBeGreaterThan(0);expect(acceptedState()).toEqual(before);
    expect(await metadata()).toEqual({drafts:[{kind,saved:true}]});
  });

  it.each(["canvas","ed","caldav"] as const)("encrypts the entire %s candidate with approved user/purpose/context AAD",async kind=>{
    expect((await save(kind)).status).toBe(200);
    const [row]=draftRows();expect(row!.key).toBe(`onboarding_draft:${kind}`);
    expect(row!.value).toMatch(/^v1\.synthetic\./);
    const plaintext=await decryptCredential({envelope:row!.value,userId:scope.userId,purpose:"onboarding_draft",contextId:`onboarding:${kind}`},keyring);
    expect(JSON.parse(plaintext)).toEqual(candidates[kind]);
    for(const binding of [{userId:other.userId,purpose:"onboarding_draft",contextId:`onboarding:${kind}`},
      {userId:scope.userId,purpose:"ed_api_token",contextId:`onboarding:${kind}`},
      {userId:scope.userId,purpose:"onboarding_draft",contextId:"onboarding:wrong"}]){
      await expect(decryptCredential({envelope:row!.value,...binding,purpose:binding.purpose as never},keyring)).rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
    }
  });

  it.each(["canvas","ed","caldav"] as const)("failed_candidate_keeps_working_credential: %s",async kind=>{
    const {calendar}=await seedWorking(kind);expect((await save(kind)).status).toBe(200);
    const before=acceptedState(),rows=draftRows();
    vi.stubGlobal("fetch",async()=>new Response("candidate-private-provider-error",{status:401}));
    for(const action of ["test","connect"] as const){
      const response=await use(kind,action,kind==="caldav"&&action==="connect"?{connectionId:calendar.id}:{});
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("candidate-private");
      expect(acceptedState()).toEqual(before);expect(draftRows()).toEqual(rows);
    }
  });

  it("cross_user_draft_access_rejected",async()=>{
    expect((await save("ed")).status).toBe(200);const before=draftRows();bind(other);
    expect(await metadata()).toEqual({drafts:[]});
    expect((await use("ed","connect")).status).toBe(404);expect(upstream).toBe(0);
    expect((await call(draftPath,"DELETE",{kind:"ed"})).status).toBe(200);expect(draftRows()).toEqual(before);
    expect((await call(draftPath,"PUT",{...candidates.ed,userId:scope.userId})).status).toBe(400);
    test.sqlite.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,? ,?,?)").run(other.userId,before[0]!.key,before[0]!.value,"synthetic");
    const response=await use("ed","test");expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(before[0]!.value);expect(upstream).toBe(0);
  });

  it.each(["GET","PUT","POST","DELETE"])("%s requires actual runtime authentication before draft access",async method=>{
    bindings.source.mockRejectedValue(new AuthenticationRequiredError());bindings.calendar.mockRejectedValue(new AuthenticationRequiredError());
    const response=await call(draftPath,method,method==="GET"?undefined:method==="PUT"?candidates.ed:{kind:"ed",...(method==="POST"?{action:"test"}:{})});
    expect(response.status).toBe(401);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(draftRows()).toEqual([]);expect(upstream).toBe(0);
  });

  it("replacement and explicit discard affect only the current user's selected kind",async()=>{
    await save("ed");await save("canvas");const canvas=draftRows().find(row=>row.key.endsWith(":canvas"));
    expect((await call(draftPath,"PUT",{kind:"ed",token:"candidate-private-replacement"})).status).toBe(200);
    expect(draftRows().find(row=>row.key.endsWith(":canvas"))).toEqual(canvas);
    expect((await call(draftPath,"DELETE",{kind:"ed"})).status).toBe(200);
    expect(await metadata()).toEqual({drafts:[{kind:"canvas",saved:true}]});expect(upstream).toBe(0);
  });

  it.each(["canvas","ed","caldav"] as const)("successful draft %s connect clears only its candidate and preserves existing IDs",async kind=>{
    const {connection,calendar}=await seedWorking(kind);await save(kind);
    const response=await use(kind,"connect",kind==="caldav"?{connectionId:calendar.id}:{});
    expect(response.status).toBe(200);expect(draftRows()).toEqual([]);
    expect(await response.json()).toMatchObject({connection:{id:kind==="caldav"?calendar.id:connection.id}});
    expect(await new D1CalendarEventLinkRepository(test.db,scope).listByConnection(calendar.id)).toHaveLength(1);
  });

  it.each(["canvas","ed","caldav"] as const)("regular %s connect also clears the saved candidate",async kind=>{
    expect((await save(kind)).status).toBe(200);const {kind:_,...body}=candidates[kind];void _;
    const response=await call(kind==="caldav"?"calendars/caldav/connect":`sources/${kind}/connect`,"POST",body);
    expect(response.status).toBe(200);expect(draftRows()).toEqual([]);
  });

  it("finishing_clears_candidates only on accepted revision, atomically",async()=>{
    for(const kind of ["canvas","ed","caldav"] as const)expect((await save(kind)).status).toBe(200);
    const before=draftRows();
    expect((await call("settings/onboarding","PATCH",{command:{type:"finish"},expectedRevision:1})).status).toBe(409);
    expect(draftRows()).toEqual(before);
    expect((await call("settings/onboarding","PATCH",{command:{type:"finish"},expectedRevision:0})).status).toBe(200);
    expect(draftRows()).toEqual([]);
    expect((await save("ed")).status).toBe(409);expect(draftRows()).toEqual([]);
  });

  it("finish cleanup failure rolls back completion and retains every candidate",async()=>{
    expect((await save("ed")).status).toBe(200);const before=draftRows();
    test.sqlite.exec("CREATE TRIGGER reject_cleanup BEFORE DELETE ON app_settings WHEN OLD.key LIKE 'onboarding_draft:%' BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END");
    const response=await call("settings/onboarding","PATCH",{command:{type:"finish"},expectedRevision:0});
    expect(response.status).toBe(503);expect(draftRows()).toEqual(before);
    expect(await new D1OnboardingRepository(test.db,scope).get()).toMatchObject({status:"active",revision:0});
  });

  it("account deletion cascades candidates and leaves the other user's saved input",async()=>{
    expect((await save("ed")).status).toBe(200);bind(other);expect((await save("ed")).status).toBe(200);const before=draftRows(other.userId);
    await deleteCurrentAccount(test.db,scope);
    expect(draftRows()).toEqual([]);expect(draftRows(other.userId)).toEqual(before);
  });

  it.each([
    {name:"empty token",body:{kind:"ed",token:" "}},
    {name:"overlong token",body:{kind:"ed",token:"x".repeat(4097)}},
    {name:"unsupported feed",body:{kind:"canvas",feedUrl:"https://unsupported.invalid/feed"}},
    {name:"overlong feed",body:{kind:"canvas",feedUrl:"https://canvas.uw.edu/"+"x".repeat(4096)}},
    {name:"overlong username",body:{kind:"caldav",username:"x".repeat(321),secret:"synthetic"}},
    {name:"overlong secret",body:{kind:"caldav",username:"synthetic",secret:"x".repeat(4097)}},
    {name:"unapproved kind",body:{kind:"google",token:"candidate-private-token"}},
  ])("bounded PUT rejects $name without replacing a candidate or doing provider work",async({body})=>{
    await save("ed");const before=draftRows();
    const response=await call(draftPath,"PUT",body);expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("candidate-private");expect(draftRows()).toEqual(before);expect(upstream).toBe(0);
  });

  it("bounds streaming PUT without trusting content-length and rejects malformed UTF8/JSON",async()=>{
    const loader=routes[`../../src/app/api/${draftPath}/route.ts`];
    expect(loader).toBeDefined();if(!loader)return;
    const {PUT}=await loader();
    const response=await PUT!(new Request("https://synthetic.invalid",{method:"PUT",headers:{"content-length":"1"},body:" ".repeat(16_385)}));
    expect(response.status).toBe(413);expect(draftRows()).toEqual([]);
    for(const body of ["{",new Uint8Array([0xff])]){
      expect((await PUT!(new Request("https://synthetic.invalid",{method:"PUT",body}))).status).toBe(400);
    }
  });

  it("rejects forged ownership or draft fields and foreign CalDAV IDs before provider work",async()=>{
    await save("caldav");const {calendar}=await seedWorking("caldav");bind(other);await save("caldav");
    expect((await use("caldav","connect",{connectionId:calendar.id})).status).toBe(404);expect(upstream).toBe(0);
    bind();await save("ed");
    for(const extra of [{userId:other.userId},{token:"candidate-private-forged"},{admitted:true},{runId:"synthetic"},{context:{issued:true}}]){
      expect((await use("ed","test",extra)).status).toBe(400);
    }
    const response=await call(draftPath,"POST",{kind:"ed",action:"test"},{"x-provider-work":"synthetic-forgery"});
    expect(response.status).toBe(200);expect(test.sqlite.prepare("SELECT count(*) AS n FROM abuse_rate_events").get()).toEqual({n:1});
  });

  it.each(["canvas","ed","caldav"] as const)("actual regular/draft %s handlers share the 10/600 bucket in both directions without double charging",async kind=>{
    await save(kind);const {kind:_,...body}=candidates[kind];void _;
    const regular=kind==="caldav"?"calendars/caldav/test":`sources/${kind}/test`;
    for(let i=0;i<10;i++){
      const response=i%2===0?await call(regular,"POST",body):await use(kind,"test");
      expect(response.status).toBe(200);
    }
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM abuse_rate_events").get()).toEqual({n:10});
    const before=upstream;
    for(const response of [await call(regular,"POST",body),await call(regular.replace("/test","/connect"),"POST",body),await use(kind,"test"),await use(kind,"connect")]){
      expect(response.status).toBe(429);expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await response.json()).toMatchObject({code:"RATE_LIMITED"});
    }
    expect(upstream).toBe(before);expect(draftRows()).toHaveLength(1);
    test.sqlite.exec("UPDATE abuse_rate_events SET admitted_at_ms=admitted_at_ms-601000");
    expect((await use(kind,"test")).status).toBe(200);
  });

  it.each(["canvas","ed","caldav"] as const)("draft %s test/connect honors provider switches before upstream work",async kind=>{
    await save(kind);test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run(`provider:${kind}`);
    for(const action of ["test","connect"] as const)expect((await use(kind,action)).status).toBe(503);
    expect(upstream).toBe(0);expect(draftRows()).toHaveLength(1);
  });

  it.each(["canvas","ed","caldav"] as const)("successful %s POST returns connection metadata without candidate plaintext or provider response",async kind=>{
    expect((await save(kind)).status).toBe(200);const rows=draftRows();
    const response=await use(kind,"connect");expect(response.status).toBe(200);
    expect(await response.json()).toEqual({kind,connected:true,connection:{id:expect.any(String)}});
    expect(draftRows()).toEqual([]);
    const output=JSON.stringify(vi.mocked(console.info).mock.calls)+JSON.stringify(vi.mocked(console.warn).mock.calls);
    for(const row of rows)expect(output).not.toContain(row.value);
    expect(test.sqlite.prepare("SELECT count(*) AS n FROM abuse_rate_events").get()).toEqual({n:1});
  });

  it.each(["canvas","ed","caldav"] as const)("%s cleanup failure rolls back accepted connection write and retains candidate",async kind=>{
    const {calendar}=await seedWorking(kind);expect((await save(kind)).status).toBe(200);
    const before=acceptedState(),rows=draftRows();
    test.sqlite.exec("CREATE TRIGGER reject_cleanup BEFORE DELETE ON app_settings WHEN OLD.key LIKE 'onboarding_draft:%' BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END");
    expect((await use(kind,"connect",kind==="caldav"?{connectionId:calendar.id}:{})).status).toBe(502);
    expect(acceptedState()).toEqual(before);expect(draftRows()).toEqual(rows);
  });

  it("direct save bounds serialized UTF8 and leaves working state and candidates intact",async()=>{
    const {saveOnboardingDraft}=await import("@/lib/onboarding/draft-service");
    await seedWorking("ed");expect((await save("ed")).status).toBe(200);const before=acceptedState(),rows=draftRows();
    await expect(saveOnboardingDraft({db:test.db,scope,keyring},{kind:"caldav",username:"u".repeat(320),secret:"\u0000".repeat(4096)})).rejects.toMatchObject({code:"INVALID_ONBOARDING_DRAFT"});
    expect(acceptedState()).toEqual(before);expect(draftRows()).toEqual(rows);expect(upstream).toBe(0);
  });

  it.each(["canvas","ed","caldav"] as const)("a newer saved %s candidate survives an in-flight accepted connection",async kind=>{
    expect((await save(kind)).status).toBe(200);
    const original=fetch;let replacing=true;
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(replacing){
        replacing=false;
        const replacement=kind==="ed"?{kind,token:"candidate-private-newer"}:kind==="canvas"?{kind,feedUrl:"https://canvas.uw.edu/feeds/calendars/candidate-private-newer.ics"}:{kind,username:"newer@example.invalid",secret:"candidate-private-newer"};
        expect((await call(draftPath,"PUT",replacement)).status).toBe(200);
      }
      return original(input,init);
    });
    const response=await use(kind,"connect");expect(response.status).toBe(200);expect(draftRows()).toHaveLength(1);
    expect(await metadata()).toEqual({drafts:[{kind,saved:true}]});
  });

  it.each(["canvas","ed","caldav"] as const)("%s owner/control revocation cannot clear the candidate when accepted writes are denied",async kind=>{
    expect((await save(kind)).status).toBe(200);const rows=draftRows(),before=acceptedState();
    const original=fetch;let revoke=true;
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(revoke){revoke=false;test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run(`provider:${kind}`);}
      return original(input,init);
    });
    const response=await use(kind,"connect");expect(response.status).toBeGreaterThanOrEqual(400);
    expect(draftRows()).toEqual(rows);expect(acceptedState()).toEqual(before);
  });

  it.each(["canvas","ed","caldav"] as const)("a replacement saved during %s decryption is retained after the original candidate connects",async kind=>{
    expect((await save(kind)).status).toBe(200);
    const original=cipher.decryptCredential;let replacing=true;
    vi.spyOn(cipher,"decryptCredential").mockImplementation(async(...args)=>{
      const plaintext=await original(...args);
      if(replacing&&args[0].purpose==="onboarding_draft"){
        replacing=false;
        const replacement=kind==="ed"?{kind,token:"candidate-private-newer"}:kind==="canvas"?{kind,feedUrl:"https://canvas.uw.edu/feeds/calendars/candidate-private-newer.ics"}:{kind,username:"newer@example.invalid",secret:"candidate-private-newer"};
        expect((await call(draftPath,"PUT",replacement)).status).toBe(200);
      }
      return plaintext;
    });
    expect((await use(kind,"connect")).status).toBe(200);
    expect(draftRows()).toHaveLength(1);expect(await metadata()).toEqual({drafts:[{kind,saved:true}]});
  });
});
