import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {openD1TestDatabase} from "../helpers/d1-test-db";
const worker=vi.hoisted(()=>({env:{} as Record<string,unknown>}));
vi.mock("cloudflare:workers",()=>worker);
import {POST} from "@/app/api/test-fixtures/guest-admission/reset/route";
const local={E2E_FIXTURES:"1",KAIROS_APP_URL:"http://127.0.0.1:3000",KAIROS_LOCAL_AUTH:"loopback",KAIROS_ABUSE_TRUSTED_INGRESS:"loopback"};
let database:ReturnType<typeof openD1TestDatabase>;
let access:ReturnType<typeof vi.fn<()=>ReturnType<typeof openD1TestDatabase>["db"]>>;
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Unexpected network");}));vi.stubEnv("E2E_FIXTURES","");
  database=openD1TestDatabase();access=vi.fn(()=>database.db);
  worker.env={...local};Object.defineProperty(worker.env,"DB",{get:access,configurable:true});
});
afterEach(()=>{database.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const request=(url=local.KAIROS_APP_URL,headers:Record<string,string>={},method="POST",body="{}")=>new Request(url+"/api/test-fixtures/guest-admission/reset",{method,headers:{origin:local.KAIROS_APP_URL,"content-type":"application/json",...headers},...(method==="GET"?{}:{body})});
it.each([
  {E2E_FIXTURES:undefined},{KAIROS_LOCAL_AUTH:undefined},{KAIROS_ABUSE_TRUSTED_INGRESS:"cloudflare"},
  {KAIROS_APP_URL:"https://mykairos.me"},{KAIROS_APP_URL:"https://127.0.0.1:3000"},
])("denies retained or missing flags/config before any D1 access: %j",async patch=>{
  Object.assign(worker.env,patch);expect((await POST(request())).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it.each(["https://mykairos.me","http://mykairos.me","https://127.0.0.1:3000","http://127.0.0.1:4000"])("denies actual nonlocal URL despite forged local hints: %s",async url=>{
  expect((await POST(request(url,{host:"127.0.0.1:3000"}))).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it.each<Record<string,string>>([{origin:""},{origin:"https://evil.invalid"},{host:"evil.invalid"},{"x-forwarded-host":"evil.invalid"},{"x-forwarded-proto":"https"},{origin:"http://localhost:3000"}])("requires exact Origin and nonconflicting host hints: %j",async headers=>{
  expect((await POST(request(undefined,headers))).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it("denies a missing Origin and oversized JSON before D1",async()=>{
  const absent=request();absent.headers.delete("origin");expect((await POST(absent)).status).toBe(404);
  expect((await POST(request(undefined,{},"POST"," ".repeat(65)+"{}"))).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it.each([["GET","{}"],["PUT","{}"],["POST",'{"extra":true}'],["POST","[]"],["POST","null"],["POST","{"],["POST",""]])("denies invalid method/body %s %s before D1",async(method,body)=>{
  expect((await POST(request(undefined,{},method,body))).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it("requires JSON content type before D1",async()=>{
  expect((await POST(request(undefined,{"content-type":"text/plain"}))).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
it("deletes only anonymous admission rows, including synthetic auth history, preserving all user and session state",async()=>{
  database.sqlite.exec("INSERT INTO users (id,name,email) VALUES ('protected','Protected','p@example.test')");
  database.sqlite.exec("INSERT INTO sessions (id,sessionToken,userId,expires) VALUES ('session','protected-session','protected','2099-01-01')");
  database.sqlite.exec("INSERT INTO accounts (id,userId,type,provider,providerAccountId) VALUES ('account','protected','oauth','google','protected-provider')");
  database.sqlite.exec("INSERT INTO source_connections (user_id,id,kind,label,created_at,updated_at) VALUES ('protected','source','canvas','Protected source','now','now')");
  database.sqlite.exec("INSERT INTO source_credentials VALUES ('protected','source','protected-envelope',NULL,'now')");
  database.sqlite.exec("INSERT INTO source_courses VALUES ('protected','course','source','123',NULL,'Protected course',NULL,NULL,1,'now','now','now')");
  database.sqlite.exec("INSERT INTO assignments (user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES ('protected','assignment','source','canvas','1','Protected course','Protected homework','pending','now','now','now','now')");
  database.sqlite.exec("INSERT INTO operation_locks VALUES ('protected','source:canvas','protected-owner','uncertain',0,0,0)");
  database.sqlite.exec("INSERT INTO sync_all_runs VALUES ('protected','protected-run',9999999999999,'[]')");
  database.sqlite.exec("INSERT INTO abuse_rate_events (event_id,key_hash,user_id,admitted_at_ms,purge_after_ms) VALUES ('guest','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',NULL,1,600001),('auth','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',NULL,2,600002),('account','CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','protected',3,600003)");
  const before=database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
  const protectedTables=before.map(t=>t.name).filter(t=>t!=="abuse_rate_events");
  const rows=()=>protectedTables.map(t=>database.sqlite.prepare('SELECT * FROM "'+t+'"').all());const state=rows();
  const result=await POST(request());expect(result.status).toBe(200);expect(await result.json()).toEqual({ok:true,deletedCount:2});
  expect(database.sqlite.prepare("SELECT event_id,user_id FROM abuse_rate_events").all()).toEqual([{event_id:"account",user_id:"protected"}]);expect(rows()).toEqual(state);expect(result.headers.get("set-cookie")).toBeNull();
});
it("allows a missing Host hint with an exact actual URL and Origin, but never enables a missing fixture flag",async()=>{
  expect((await POST(request())).status).toBe(200);delete worker.env.E2E_FIXTURES;access.mockClear();expect((await POST(request())).status).toBe(404);expect(access).not.toHaveBeenCalled();
});
