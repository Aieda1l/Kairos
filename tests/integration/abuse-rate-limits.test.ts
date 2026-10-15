import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {D1DatabaseLike,D1PreparedStatementLike} from "@/lib/db/d1/types";
import type {RateSubject} from "@/lib/abuse/types";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const databases:ReturnType<typeof openD1TestDatabase>[]=[];
function open(options?:Parameters<typeof openD1TestDatabase>[0]){
  const database=openD1TestDatabase(options);databases.push(database);
  return database;
}
function clock(database:ReturnType<typeof open>,initial=1_800_000_000_000){
  let now=initial;
  database.sqlite.function("strftime",(format:string,when:string)=>{
    if(when!=="now")throw new Error("Clock fixture accepts DB now only");
    if(format==="%s")return String(Math.floor(now/1000));
    if(format==="%f")return `00.${String(now%1000).padStart(3,"0")}`;
    throw new Error("Unexpected DB clock format");
  });
  return {advance:(ms:number)=>{now+=ms;},get now(){return now;}};
}
function seed(database:ReturnType<typeof open>){
  database.sqlite.exec("INSERT INTO users(id) VALUES ('alice'),('bob')");
}
function runtime(db:D1DatabaseLike){
  return {db,hmacKey:new Uint8Array(32).fill(7),turnstileSecret:"dummy-secret",appOrigin:"https://mykairos.me",hostname:"mykairos.me",fetchImpl:vi.fn<typeof fetch>()};
}
function count(database:ReturnType<typeof open>){
  return (database.sqlite.prepare("SELECT COUNT(*) AS count FROM abuse_rate_events").get() as {count:number}).count;
}
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const cases:ReadonlyArray<readonly [RateSubject,number,number]>=[
  [{class:"auth-initiation",provider:"google",network:"ipv4:203.0.113.8"},20,600],
  [{class:"credential",userId:"alice",provider:"ed"},10,600],
  [{class:"source-sync",userId:"alice",provider:"canvas",resourceId:"source-a"},12,600],
  [{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"calendar-a"},12,600],
  [{class:"sync-all",userId:"alice"},6,600],
  [{class:"deletion",userId:"alice"},5,3600],
];

describe("durable rolling admission against real SQL",()=>{
  it.each(cases)("admits exact N and rejects N+1 for %j",async(subject,limit,seconds)=>{
    const database=open();seed(database);const time=clock(database);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    for(let index=0;index<limit;index++)await enforceBudget(runtime(database.db),subject);
    await expect(enforceBudget(runtime(database.db),subject)).rejects.toMatchObject({code:"RATE_LIMITED",retryAfterSeconds:seconds});
    expect(count(database)).toBe(limit);
    time.advance(seconds*1000-1);
    await expect(enforceBudget(runtime(database.db),subject)).rejects.toMatchObject({code:"RATE_LIMITED",retryAfterSeconds:1});
    expect(count(database)).toBe(limit);
    time.advance(1);
    await enforceBudget(runtime(database.db),subject);
    expect(count(database)).toBe(limit+1);
  });

  it("uses staggered rolling expiry rather than fixed-window reset or denied-attempt extension",async()=>{
    const database=open();seed(database);const time=clock(database);
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const repo=new D1RateLimitRepository(database.db),input={keyHash:"a".repeat(43),userId:"alice",limit:2,windowSeconds:600};
    expect(await repo.consume(input)).toEqual({allowed:true});
    time.advance(100_000);expect(await repo.consume(input)).toEqual({allowed:true});
    time.advance(499_999);expect(await repo.consume(input)).toEqual({allowed:false,retryAfterSeconds:1});
    expect(count(database)).toBe(2);
    time.advance(1);expect(await repo.consume(input)).toEqual({allowed:true});
    expect(await repo.consume(input)).toEqual({allowed:false,retryAfterSeconds:100});
    time.advance(99_999);expect(await repo.consume(input)).toEqual({allowed:false,retryAfterSeconds:1});
    time.advance(1);expect(await repo.consume(input)).toEqual({allowed:true});
    expect(count(database)).toBe(4);
  });

  it.each(cases)("bounds independent SQLite clients sharing one database for %j",async(subject,limit)=>{
    const directory=path.join(process.cwd(),"artifacts/task7b-1/sqlite");fs.mkdirSync(directory,{recursive:true});
    const filename=path.join(directory,`${crypto.randomUUID()}.sqlite`);
    const first=open({filename});seed(first);clock(first);
    const second=open({filename,migrate:false});clock(second);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    const decisions=await Promise.allSettled(Array.from({length:limit+8},(_,index)=>enforceBudget(runtime(index%2?first.db:second.db),subject)));
    expect(decisions.filter(result=>result.status==="fulfilled")).toHaveLength(limit);
    for(const decision of decisions.filter(result=>result.status==="rejected"))expect(decision).toMatchObject({reason:{code:"RATE_LIMITED"}});
    expect(count(first)).toBe(limit);
  });

  it("reads the clock inside each conditional INSERT after another client admits",async()=>{
    const database=open();seed(database);const time=clock(database);
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const input={keyHash:"a".repeat(43),userId:"alice",limit:1,windowSeconds:600};
    let release!:()=>void,prepared!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const ready=new Promise<void>(resolve=>{prepared=resolve;});
    const delayed:D1DatabaseLike={...database.db,batch:database.db.batch.bind(database.db),exec:database.db.exec.bind(database.db),
      prepare(sql){
        const statement=database.db.prepare(sql);
        const wrap=(bound:D1PreparedStatementLike):D1PreparedStatementLike=>({
          bind:(...values)=>wrap(bound.bind(...values)),first:()=>bound.first(),all:()=>bound.all(),
          run:async()=>{prepared();await gate;return bound.run();},
        });
        return wrap(statement);
      },
    };
    const pending=new D1RateLimitRepository(delayed).consume(input);
    await ready;time.advance(1);
    expect(await new D1RateLimitRepository(database.db).consume(input)).toEqual({allowed:true});
    release();expect(await pending).toEqual({allowed:false,retryAfterSeconds:600});
    expect(count(database)).toBe(1);
  });

  it("isolates users, providers, resources, classes, and public IPv6 networks",async()=>{
    const database=open();seed(database);clock(database);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    const rt=runtime(database.db);
    for(let index=0;index<10;index++)await enforceBudget(rt,{class:"credential",userId:"alice",provider:"ed"});
    await expect(enforceBudget(rt,{class:"credential",userId:"alice",provider:"ed"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    await enforceBudget(rt,{class:"credential",userId:"bob",provider:"ed"});
    await enforceBudget(rt,{class:"credential",userId:"alice",provider:"canvas"});
    for(let index=0;index<12;index++)await enforceBudget(rt,{class:"source-sync",userId:"alice",provider:"canvas",resourceId:"same-id"});
    await expect(enforceBudget(rt,{class:"source-sync",userId:"alice",provider:"canvas",resourceId:"same-id"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    await enforceBudget(rt,{class:"source-sync",userId:"alice",provider:"canvas",resourceId:"other-id"});
    await enforceBudget(rt,{class:"source-sync",userId:"bob",provider:"canvas",resourceId:"same-id"});
    await enforceBudget(rt,{class:"source-sync",userId:"alice",provider:"ed",resourceId:"same-id"});
    await enforceBudget(rt,{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"same-id"});
    for(let index=0;index<20;index++)await enforceBudget(rt,{class:"auth-initiation",provider:"google",network:"ipv6:2001:db8:1:2::/64"});
    await expect(enforceBudget(rt,{class:"auth-initiation",provider:"google",network:"ipv6:2001:db8:1:2::/64"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    await enforceBudget(rt,{class:"auth-initiation",provider:"microsoft-entra-id",network:"ipv6:2001:db8:1:2::/64"});
    await enforceBudget(rt,{class:"auth-initiation",provider:"google",network:"ipv6:2001:db8:1:3::/64"});
    const rows=database.sqlite.prepare("SELECT * FROM abuse_rate_events").all();
    expect(JSON.stringify(rows)).not.toMatch(/2001:db8|203\.0\.113|google|canvas|same-id/);
  });

  it("counts admitted attempts even if later challenge or credential work fails",async()=>{
    const database=open();seed(database);clock(database);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    for(let index=0;index<10;index++){
      await enforceBudget(runtime(database.db),{class:"credential",userId:"alice",provider:"ed"});
      // A failed downstream attempt has no refund path.
      await Promise.reject(new Error("dummy credential rejection")).catch(()=>undefined);
    }
    await expect(enforceBudget(runtime(database.db),{class:"credential",userId:"alice",provider:"ed"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    expect(count(database)).toBe(10);
  });

  it("separates Sync All from deletion and all calendar destination key dimensions",async()=>{
    const database=open();seed(database);clock(database);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    const rt=runtime(database.db);
    for(let index=0;index<6;index++)await enforceBudget(rt,{class:"sync-all",userId:"alice"});
    await expect(enforceBudget(rt,{class:"sync-all",userId:"alice"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    await enforceBudget(rt,{class:"deletion",userId:"alice"});
    for(let index=0;index<12;index++)await enforceBudget(rt,{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"destination"});
    await expect(enforceBudget(rt,{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"destination"})).rejects.toMatchObject({code:"RATE_LIMITED"});
    await enforceBudget(rt,{class:"calendar-sync",userId:"bob",provider:"google",resourceId:"destination"});
    await enforceBudget(rt,{class:"calendar-sync",userId:"alice",provider:"microsoft",resourceId:"destination"});
    await enforceBudget(rt,{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"destination-2"});
    expect(count(database)).toBe(22);
  });

  it("honors server-tuned limits through actual admission and rejects invalid subjects",async()=>{
    const database=open();seed(database);clock(database);
    const {enforceBudget}=await import("@/lib/abuse/guard");
    const {policyFromEnvironment}=await import("@/lib/abuse/policy");
    const rt={...runtime(database.db),policy:policyFromEnvironment({KAIROS_ABUSE_BUDGETS:'{"sync-all":{"limit":2,"windowSeconds":60}}'})};
    await enforceBudget(rt,{class:"sync-all",userId:"alice"});
    await enforceBudget(rt,{class:"sync-all",userId:"alice"});
    await expect(enforceBudget(rt,{class:"sync-all",userId:"alice"})).rejects.toMatchObject({code:"RATE_LIMITED",retryAfterSeconds:60});
    for(const subject of [
      {class:"sync-all",userId:""}, {class:"credential",userId:"alice",provider:"unknown"},
      {class:"source-sync",userId:"alice",provider:"google",resourceId:"id"},
      {class:"calendar-sync",userId:"alice",provider:"google",resourceId:""},
      {class:"unknown",userId:"alice"},
    ])await expect(enforceBudget(rt,subject as RateSubject)).rejects.toMatchObject({code:"ABUSE_SUBJECT_INVALID"});
    expect(count(database)).toBe(2);
  });

  it("retains a denial with bounded retry if its live event expires before the read",async()=>{
    const database=open();seed(database);const time=clock(database);
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const input={keyHash:"a".repeat(43),userId:"alice",limit:1,windowSeconds:600};
    await new D1RateLimitRepository(database.db).consume(input);
    const db:D1DatabaseLike={batch:database.db.batch.bind(database.db),exec:database.db.exec.bind(database.db),
      prepare(sql){
        if(!sql.includes("INSERT INTO"))time.advance(600_000);
        return database.db.prepare(sql);
      },
    };
    expect(await new D1RateLimitRepository(db).consume(input)).toEqual({allowed:false,retryAfterSeconds:1});
    expect(count(database)).toBe(1);
  });

  it("rejects invalid repository budgets before touching storage",async()=>{
    const database=open();
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const repo=new D1RateLimitRepository(database.db),input={keyHash:"a".repeat(43),userId:null,limit:1,windowSeconds:600};
    for(const override of [{limit:0},{windowSeconds:3601},{keyHash:"raw-address"},{userId:""}]){
      await expect(repo.consume({...input,...override})).rejects.toMatchObject({code:"ABUSE_CONFIG_INVALID"});
    }
    expect(count(database)).toBe(0);
  });

  it("fails closed on INSERT failure, malformed changes metadata, and denial-read failure",async()=>{
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const input={keyHash:"a".repeat(43),userId:null,limit:1,windowSeconds:600};
    for(const result of [{success:false,results:[],meta:{changes:1}},{success:true,results:[],meta:{}},
      {success:true,results:[],meta:{changes:2}},{success:true,results:[],meta:{changes:0}}]){
      const statement:D1PreparedStatementLike={bind(){return this;},run:async()=>result,
        first:async()=>{throw new Error("private-storage-failure");},all:async()=>{throw new Error("private");}};
      const db:D1DatabaseLike={prepare:()=>statement,batch:async()=>[],exec:async()=>{}};
      await expect(new D1RateLimitRepository(db).consume(input)).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE",message:"Abuse protection storage is unavailable."});
    }
  });

  it.each([
    {label:"string false",success:"false"},
    {label:"string true",success:"true"},
    {label:"number one",success:1},
    {label:"empty array",success:[]},
  ])("rejects truthy nonboolean admission success ($label) before downstream work",async({success})=>{
    const {enforceBudget,abuseErrorResponse}=await import("@/lib/abuse/guard");
    // Deliberately violate the typed adapter contract at the storage boundary.
    const result={success,results:[],meta:{changes:1}} as unknown as {
      success:boolean;results:never[];meta:{changes:number};
    };
    const statement:D1PreparedStatementLike={bind(){return this;},run:async()=>result,
      first:async()=>{throw new Error("Unexpected denial read");},all:async()=>{throw new Error("Unexpected read");}};
    const db:D1DatabaseLike={prepare:()=>statement,batch:async()=>[],exec:async()=>{}};
    const downstream=vi.fn(async()=>undefined);
    const error=await (async()=>{
      await enforceBudget(runtime(db),{class:"sync-all",userId:"alice"});
      await downstream();
    })().catch(error=>error);
    const response=abuseErrorResponse(error);
    expect(response?.status).toBe(503);
    expect(await response!.json()).toEqual({code:"ABUSE_STORAGE_UNAVAILABLE",message:"Abuse protection storage is unavailable."});
    expect(response!.headers.get("Cache-Control")).toBe("no-store");
    expect(downstream).not.toHaveBeenCalled();
  });
});

describe("complete additive abuse schema and controls",()=>{
  it("fails closed on unavailable or corrupt control storage",async()=>{
    const {D1AbuseControlRepository}=await import("@/lib/db/d1/repositories/abuse-controls");
    for(const row of [null,{enabled:2,version:0},{enabled:1,version:-1},{enabled:1,version:0.5}]){
      const statement={bind(){return this;},first:async()=>row} as D1PreparedStatementLike;
      const db:D1DatabaseLike={prepare:()=>statement,batch:async()=>[],exec:async()=>{}};
      await expect(new D1AbuseControlRepository(db).get("auth:google")).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    }
    const db:D1DatabaseLike={prepare(){throw new Error("private-control-failure");},batch:async()=>[],exec:async()=>{}};
    await expect(new D1AbuseControlRepository(db).get("auth:google")).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE",message:"Abuse protection storage is unavailable."});
  });

  it("seeds all nine enabled version-zero controls and observes changes without caching",async()=>{
    const database=open();
    const {D1AbuseControlRepository}=await import("@/lib/db/d1/repositories/abuse-controls");
    const repo=new D1AbuseControlRepository(database.db);
    const keys=["auth:initiation","auth:google","auth:microsoft-entra-id","provider:canvas","provider:gradescope","provider:ed","provider:google","provider:microsoft","provider:caldav"] as const;
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM abuse_controls").get()).toEqual({count:9});
    for(const key of keys)expect(await repo.get(key)).toEqual({enabled:true,version:0});
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:google'");
    expect(await repo.get("auth:google")).toEqual({enabled:false,version:1});
    expect(await repo.get("auth:initiation")).toEqual({enabled:true,version:0});
    expect(await repo.get("provider:google")).toEqual({enabled:true,version:0});
    database.sqlite.exec("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='auth:google'");
    expect(await repo.get("auth:google")).toEqual({enabled:true,version:2});
    database.sqlite.exec("DELETE FROM abuse_controls WHERE control_key='auth:google'");
    await expect(repo.get("auth:google")).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    await expect(repo.get("unknown" as typeof keys[number])).rejects.toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
  });

  it("rejects invalid control/state/timestamp/step values and cross-tenant run claims",()=>{
    const database=open();seed(database);const sql=database.sqlite;
    sql.exec("INSERT INTO operation_locks VALUES ('alice','source:canvas','owner','running',100,200,0)");
    sql.exec("INSERT INTO sync_all_runs VALUES ('alice','run',600000,'[\"canvas-deadlines\",\"calendars\"]')");
    sql.exec("INSERT INTO sync_all_steps VALUES ('alice','run','calendars',100)");
    for(const statement of [
      "INSERT INTO operation_locks VALUES ('missing','x','owner','running',100,200,0)",
      "INSERT INTO operation_locks VALUES ('bob','x','owner','stale',100,200,0)",
      "INSERT INTO operation_locks VALUES ('bob','x',NULL,'running',100,200,0)",
      "INSERT INTO operation_locks VALUES ('bob','x','owner','running',200,100,0)",
      "INSERT INTO sync_all_steps VALUES ('bob','run','calendars',100)",
      "INSERT INTO sync_all_steps VALUES ('alice','run','calendars',100)",
      "INSERT INTO sync_all_steps VALUES ('alice','run','arbitrary-step',100)",
      "INSERT INTO sync_all_runs VALUES ('bob','run',-1,'[]')",
      "INSERT INTO sync_all_runs VALUES ('bob','run',600000,'invalid-json')",
      "INSERT INTO sync_all_runs VALUES ('bob','run',600000,'{}')",
      "UPDATE abuse_controls SET enabled=2 WHERE control_key='auth:google'",
      "UPDATE abuse_controls SET version=-1 WHERE control_key='auth:google'",
      "INSERT INTO abuse_controls VALUES ('arbitrary',1,0,100)",
    ])expect(()=>sql.exec(statement),statement).toThrow();
    sql.exec("INSERT INTO sync_all_runs VALUES ('bob','run',600000,'[\"calendars\"]')");
    sql.exec("INSERT INTO sync_all_steps VALUES ('bob','run','calendars',100)");
    expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_all_steps").get()).toEqual({count:2});
  });

  it("cascades owned events/locks/runs/steps but retains anonymous admitted events",async()=>{
    const database=open();seed(database);clock(database);
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    const repo=new D1RateLimitRepository(database.db);
    await repo.consume({keyHash:"a".repeat(43),userId:"alice",limit:1,windowSeconds:600});
    await repo.consume({keyHash:"b".repeat(43),userId:null,limit:1,windowSeconds:600});
    database.sqlite.exec("INSERT INTO operation_locks VALUES ('alice','source:canvas','owner','uncertain',100,200,0)");
    database.sqlite.exec("INSERT INTO sync_all_runs VALUES ('alice','run',600000,'[\"calendars\"]')");
    database.sqlite.exec("INSERT INTO sync_all_steps VALUES ('alice','run','calendars',100)");
    database.sqlite.exec("DELETE FROM users WHERE id='alice'");
    expect(count(database)).toBe(1);
    for(const table of ["operation_locks","sync_all_runs","sync_all_steps"]){
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({count:0});
    }
  });

  it("preserves existing OAuth state and adds default control version zero",()=>{
    const database=open({beforeMigration:(name,sql)=>{
      if(name!=="0005_abuse_controls.sql")return;
      sql.exec("INSERT INTO users(id) VALUES ('alice')");
      sql.exec("INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,return_to,redirect_uri,created_at,expires_at) VALUES ('alice','hash','google','dummy-envelope','/sources','https://mykairos.me/callback','before','after')");
    }});
    expect(database.sqlite.prepare("SELECT state_hash,code_verifier_envelope,control_version FROM oauth_requests").get())
      .toEqual({state_hash:"hash",code_verifier_envelope:"dummy-envelope",control_version:0});
    expect(()=>database.sqlite.exec("UPDATE oauth_requests SET control_version=-1")).toThrow();
  });

  it("provides indexed key/time and purge lookups with bounded event retention",async()=>{
    const database=open();seed(database);const time=clock(database);
    const {D1RateLimitRepository}=await import("@/lib/db/d1/repositories/rate-limits");
    await new D1RateLimitRepository(database.db).consume({keyHash:"a".repeat(43),userId:null,limit:1,windowSeconds:600});
    expect(database.sqlite.prepare("SELECT admitted_at_ms,purge_after_ms FROM abuse_rate_events").get())
      .toEqual({admitted_at_ms:time.now,purge_after_ms:time.now+3600000});
    const keyPlan=database.sqlite.prepare("EXPLAIN QUERY PLAN SELECT admitted_at_ms FROM abuse_rate_events WHERE key_hash=? AND admitted_at_ms>? AND admitted_at_ms<=? ORDER BY admitted_at_ms LIMIT 1").all("a",0,time.now);
    expect(JSON.stringify(keyPlan)).toContain("abuse_rate_events_key_time_idx");
    const purgePlan=database.sqlite.prepare("EXPLAIN QUERY PLAN SELECT event_id FROM abuse_rate_events WHERE purge_after_ms<=? ORDER BY purge_after_ms LIMIT 100").all(time.now);
    expect(JSON.stringify(purgePlan)).toContain("abuse_rate_events_purge_idx");
    expect(()=>database.sqlite.exec("INSERT INTO abuse_rate_events VALUES ('bad','hash',NULL,100,99)")).toThrow();
  });
});
