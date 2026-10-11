import fs from "node:fs";
import {afterEach,describe,expect,it} from "vitest";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const databases:ReturnType<typeof openD1TestDatabase>[]=[];
function open(options?:Parameters<typeof openD1TestDatabase>[0]){
  const database=openD1TestDatabase(options);
  databases.push(database);
  return database;
}
function seed(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"],id="alice"){
  sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(id);
}
async function repository(db:ReturnType<typeof openD1TestDatabase>["db"],userId="alice"){
  const {D1OnboardingRepository}=await import("@/lib/db/d1/repositories/onboarding");
  return new D1OnboardingRepository(db,{userId});
}
function setting(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"],userId:string,key:string){
  return sqlite.prepare("SELECT value FROM app_settings WHERE user_id=? AND key=?")
    .get(userId,key) as {value:string}|undefined;
}
afterEach(()=>{for(const database of databases.splice(0))database.close();});

describe("D1 migration and transaction test contract",()=>{
  it("loads_all_ordered_migrations",()=>{
    const loaded:string[]=[];
    open({beforeMigration:name=>{loaded.push(name);}});
    expect(loaded).toEqual(fs.readdirSync("migrations").filter(name=>/^\d+.*\.sql$/.test(name)).sort());
    expect(loaded).toContain("0003_identity_token_minimization.sql");
  });

  it("batch_failure_rolls_back_prior_statements",async()=>{
    const {db,sqlite}=open();
    seed(sqlite);
    await expect(db.batch([
      db.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('alice','test','kept','now')"),
      db.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('missing','test','bad','now')"),
    ])).rejects.toThrow();
    expect(setting(sqlite,"alice","test")).toBeUndefined();
  });
});

describe("tenant onboarding persistence",()=>{
  it("empty_pre_cutover_user_bypasses",async()=>{
    const {db,sqlite}=open({beforeMigration:(name,sqlite)=>{
      if(name==="0004_onboarding_state.sql")seed(sqlite);
    }});
    const state=await (await repository(db)).ensureInitialized();
    expect(state).toEqual({version:1,revision:0,status:"completed",currentStep:"finish",skipped:[],drafts:{}});
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_connections").get()).toEqual({count:0});
    expect(setting(sqlite,"alice","canvas_submission_status_enabled")?.value).toBe("1");
  });

  it("cutover_preserves_explicit_submission_preference_and_progress",async()=>{
    const {db,sqlite}=open({beforeMigration:(name,sqlite)=>{
      if(name!=="0004_onboarding_state.sql")return;
      seed(sqlite);
      sqlite.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('alice','canvas_submission_status_enabled','0','before')").run();
    }});
    expect((await (await repository(db)).ensureInitialized()).status).toBe("completed");
    expect(setting(sqlite,"alice","canvas_submission_status_enabled")?.value).toBe("0");
  });

  it("post_cutover_user_starts_active",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    const repo=await repository(db);
    expect(await repo.get()).toBeNull();
    expect(await repo.ensureInitialized()).toEqual({version:1,revision:0,status:"active",currentStep:"timezone",skipped:[],drafts:{}});
    expect(setting(sqlite,"alice","canvas_submission_status_enabled")?.value).toBe("0");
  });

  it("initialization_is_idempotent",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    const repo=await repository(db);
    await Promise.all([repo.ensureInitialized(),repo.ensureInitialized()]);
    const saved=await repo.apply({type:"save-draft",drafts:{timeZone:"Asia/Kolkata",edCourseIds:["123"]}},0);
    expect(await repo.ensureInitialized()).toEqual(saved);
    expect(sqlite.prepare("SELECT count(*) AS count FROM app_settings WHERE user_id='alice' AND key='onboarding'").get()).toEqual({count:1});
  });

  it("tenant_state_isolated",async()=>{
    const {db,sqlite}=open();seed(sqlite);seed(sqlite,"bob");
    const alice=await repository(db),bob=await repository(db,"bob");
    await alice.ensureInitialized();await bob.ensureInitialized();
    await alice.apply({type:"visit",step:"ed"},0);
    expect(await bob.get()).toMatchObject({revision:0,currentStep:"timezone",drafts:{}});
    expect(await alice.get()).toMatchObject({revision:1,currentStep:"ed"});
    sqlite.prepare("DELETE FROM users WHERE id='alice'").run();
    expect(await alice.get()).toBeNull();
    expect(await bob.get()).not.toBeNull();
  });

  it("stale_revision_preserves_progress",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    const repo=await repository(db);await repo.ensureInitialized();
    await repo.apply({type:"save-draft",drafts:{gradescopeCourseIds:["42"]}},0);
    await expect(repo.apply({type:"visit",step:"canvas"},0)).rejects.toMatchObject({code:"ONBOARDING_CONFLICT"});
    expect(await repo.get()).toMatchObject({revision:1,currentStep:"timezone",drafts:{gradescopeCourseIds:["42"]}});
  });

  it("simultaneous_revision_writers_have_one_winner",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    const repo=await repository(db);await repo.ensureInitialized();
    const results=await Promise.allSettled([
      repo.apply({type:"save-draft",drafts:{timeZone:"UTC"}},0),
      repo.apply({type:"save-draft",drafts:{edCourseIds:["9"]}},0),
    ]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.find(result=>result.status==="rejected")).toMatchObject({reason:{code:"ONBOARDING_CONFLICT"}});
    expect(await repo.get()).toMatchObject({revision:1});
  });

  it("completed_state_cannot_reopen_accidentally",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    const repo=await repository(db);await repo.ensureInitialized();
    const completed=await repo.apply({type:"finish"},0);
    expect(completed).toMatchObject({status:"completed",currentStep:"finish",revision:1});
    for(const command of [{type:"resume"},{type:"defer"},{type:"visit",step:"canvas"}] as const){
      await repo.apply(command,(await repo.get())!.revision);
      expect(await repo.get()).toMatchObject({status:"completed",currentStep:"finish"});
    }
  });

  it("initialization_failure_rolls_back_state_and_preference",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    sqlite.exec("CREATE TRIGGER fail_preference BEFORE INSERT ON app_settings WHEN NEW.key='canvas_submission_status_enabled' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    await expect((await repository(db)).ensureInitialized()).rejects.toThrow();
    expect(setting(sqlite,"alice","onboarding")).toBeUndefined();
    expect(setting(sqlite,"alice","canvas_submission_status_enabled")).toBeUndefined();
  });

  it("initialization_keeps_an_existing_opt_in",async()=>{
    const {db,sqlite}=open();seed(sqlite);
    sqlite.exec("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('alice','canvas_submission_status_enabled','1','before');");
    await (await repository(db)).ensureInitialized();
    expect(setting(sqlite,"alice","canvas_submission_status_enabled")?.value).toBe("1");
  });
});
