import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabase, resetDatabaseSingletonForTests } from "../helpers/legacy-db";
import { migrate } from "../helpers/legacy-db";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { resetGradescopeRequestRegistryForTests } from "@/lib/gradescope/request-registry";

let dbPath:string;
const requestIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-gradescope-discovery-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  resetDatabaseSingletonForTests();
  resetGradescopeRequestRegistryForTests();
});
afterEach(()=>{
  resetDatabaseSingletonForTests();
  resetGradescopeRequestRegistryForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

const start=async()=>{
  const route=await import("@/app/api/sources/gradescope/discover/start/route");
  return route.POST();
};
const complete=async(body:unknown)=>{
  const route=await import("@/app/api/sources/gradescope/discover/complete/route");
  return route.POST(new Request("http://local/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
};
const selectCourses=async(enabledCourseIds:string[])=>{
  const route=await import("@/app/api/sources/gradescope/courses/route");
  return route.PUT(new Request("http://local/api",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({enabledCourseIds})}));
};

const courses=[
  {courseId:"123",shortName:"CSE 331",fullName:"Software Design",term:"Autumn",year:"2026"},
  {courseId:"456",shortName:"MATH 308",fullName:"Linear Algebra",term:"Autumn",year:"2026"},
];

describe("Gradescope discovery routes",()=>{
  it("persists discovered courses disabled by default",async()=>{
    const started=await (await start()).json();
    expect(started.requestId).toMatch(requestIdPattern);
    expect(started.protocolVersion).toBe(1);

    const response=await complete({protocolVersion:1,requestId:started.requestId,courses,errorCode:null});
    expect(response.status).toBe(200);
    const connection=new SourceConnectionRepository(getDatabase()).getByKind("gradescope");
    expect(connection).not.toBeNull();
    expect(new SourceCourseRepository(getDatabase()).list(connection!.id)).toMatchObject([
      {externalCourseId:"456",enabled:false},
      {externalCourseId:"123",enabled:false},
    ]);
  });

  it("preserves prior selection and leaves newly discovered courses disabled",async()=>{
    const first=await (await start()).json();
    await complete({protocolVersion:1,requestId:first.requestId,courses:[courses[0]],errorCode:null});
    expect((await selectCourses(["123"])).status).toBe(200);

    const second=await (await start()).json();
    await complete({protocolVersion:1,requestId:second.requestId,courses,errorCode:null});
    const connection=new SourceConnectionRepository(getDatabase()).getByKind("gradescope")!;
    const repo=new SourceCourseRepository(getDatabase());
    expect(repo.listEnabled(connection.id).map(course=>course.externalCourseId)).toEqual(["123"]);
    expect(repo.list(connection.id).find(course=>course.externalCourseId==="456")?.enabled).toBe(false);
  });

  it("rejects unknown selections and consumes discovery requests once",async()=>{
    const started=await (await start()).json();
    expect((await complete({protocolVersion:1,requestId:started.requestId,courses,errorCode:null})).status).toBe(200);
    expect((await complete({protocolVersion:1,requestId:started.requestId,courses,errorCode:null})).status).toBe(409);

    const bad=await selectCourses(["999"]);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({code:"INVALID_COURSE_SELECTION"});
  });

  it("returns an actionable signed-out discovery error",async()=>{
    const started=await (await start()).json();
    const response=await complete({
      protocolVersion:1,
      requestId:started.requestId,
      courses:[],
      errorCode:"GRADESCOPE_SIGNED_OUT",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code:"GRADESCOPE_SIGNED_OUT",
      message:"Sign in to Gradescope, then retry.",
    });
  });

  it("strictly rejects raw authenticated content and oversized discovery results",async()=>{
    const started=await (await start()).json();
    const raw=await complete({protocolVersion:1,requestId:started.requestId,courses,errorCode:null,html:"<html>private</html>"});
    expect(raw.status).toBe(400);

    const next=await (await start()).json();
    const tooMany=Array.from({length:51},(_,index)=>({
      courseId:String(index+1),shortName:null,fullName:`Course ${index+1}`,term:null,year:null,
    }));
    const oversized=await complete({protocolVersion:1,requestId:next.requestId,courses:tooMany,errorCode:null});
    expect(oversized.status).toBe(400);
  });
});
