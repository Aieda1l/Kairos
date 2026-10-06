import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabase, resetDatabaseSingletonForTests } from "../helpers/legacy-db";
import { migrate } from "../helpers/legacy-db";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { resetGradescopeRequestRegistryForTests } from "@/lib/gradescope/request-registry";

let dbPath:string;

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-gradescope-sync-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  resetDatabaseSingletonForTests();
  resetGradescopeRequestRegistryForTests();
});
afterEach(()=>{
  resetDatabaseSingletonForTests();
  resetGradescopeRequestRegistryForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

function seed(enabled:boolean){
  const db=getDatabase();
  migrate(db);
  const connection=new SourceConnectionRepository(db).upsertGradescope("Gradescope");
  const courses=new SourceCourseRepository(db);
  courses.upsertDiscovered(connection.id,[{
    externalCourseId:"123",shortName:"CSE 331",fullName:"Software Design",term:"Autumn",year:"2026",
  }],"2026-10-05T04:00:00.000Z");
  courses.setEnabled(connection.id,enabled?["123"]:[]);
  return connection;
}

const start=async()=>{
  const route=await import("@/app/api/sources/gradescope/sync/start/route");
  return route.POST();
};
const complete=async(body:unknown)=>{
  const route=await import("@/app/api/sources/gradescope/sync/complete/route");
  return route.POST(new Request("http://local/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
};

function successfulBatch(requestId:string,courseId="123"){
  return {
    protocolVersion:1,
    requestId,
    courses:[{
      courseId,
      checkedAt:"2026-10-05T05:05:00.000Z",
      assignments:[],
      errorCode:null,
      parseDiagnosticCounts:[],
    }],
    errorCode:null,
  };
}

describe("Gradescope sync routes",()=>{
  it("requires a configured Gradescope connection with at least one enabled course",async()=>{
    const unconfigured=await start();
    expect(unconfigured.status).toBe(409);
    expect(await unconfigured.json()).toMatchObject({code:"GRADESCOPE_NOT_CONFIGURED"});

    seed(false);
    const disabled=await start();
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({code:"GRADESCOPE_NO_COURSES_ENABLED"});
  });

  it("returns a server-issued request and saves a valid extension batch",async()=>{
    seed(true);
    const response=await start();
    expect(response.status).toBe(200);
    const started=await response.json();
    expect(started).toMatchObject({courseIds:["123"],maxCourseBatchSize:20,protocolVersion:1});

    const completed=await complete({requestId:started.requestId,batches:[successfulBatch(started.requestId)]});
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({failedCourseCount:0,lastErrorCode:null});
  });

  it("rejects strict-body violations before consuming the active request",async()=>{
    seed(true);
    const started=await (await start()).json();
    const invalid=await complete({
      requestId:started.requestId,
      batches:[successfulBatch(started.requestId)],
      html:"<html>private</html>",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({code:"INVALID_RESULT"});

    const valid=await complete({requestId:started.requestId,batches:[successfulBatch(started.requestId)]});
    expect(valid.status).toBe(200);
  });

  it("rejects a result for an unrequested course and consumes the request",async()=>{
    seed(true);
    const started=await (await start()).json();
    const bad=await complete({requestId:started.requestId,batches:[successfulBatch(started.requestId,"999")]});
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({code:"INVALID_RESULT"});

    const consumed=await complete({requestId:started.requestId,batches:[successfulBatch(started.requestId)]});
    expect(consumed.status).toBe(409);
    expect(await consumed.json()).toMatchObject({code:"SYNC_REQUEST_NOT_FOUND"});
  });
});
