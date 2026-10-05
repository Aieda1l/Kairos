import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabaseSingletonForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";

let dbPath:string;
const enrollment=(id:number,code:string,name:string)=>({course:{id,code,name,year:"2026",session:"Autumn"},role:{role:"student"}});

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-ed-courses-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  process.env.E2E_FIXTURES="0";
  resetDatabaseSingletonForTests();
});
afterEach(()=>{
  vi.unstubAllGlobals();
  resetDatabaseSingletonForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

function seed(){
  const db=getDatabase(); migrate(db);
  const connection=new SourceConnectionRepository(db).upsertEd("Ed");
  new SourceCredentialRepository(db).setEdApiToken(connection.id,"fixture-ed-token-never-echo");
  new SourceCourseRepository(db).upsertDiscovered(connection.id,[{
    externalCourseId:"123",shortName:"CSE 331",fullName:"Old Name",term:"Autumn",year:"2026",
  }],"2026-10-05T10:00:00.000Z");
  new SourceCourseRepository(db).setEnabled(connection.id,["123"]);
  return connection;
}

describe("Ed courses routes",()=>{
  it("returns an empty public state before Ed is connected",async()=>{
    const route=await import("@/app/api/sources/ed/courses/route");
    const response=await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({connection:null,courses:[]});
  });

  it("refreshes with the stored token, preserves enabled courses, and leaves new courses disabled",async()=>{
    const connection=seed();
    const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-ed-token-never-echo");
      return new Response(JSON.stringify({user:{id:7},courses:[
        enrollment(123,"CSE 331","Updated Name"),
        enrollment(456,"MATH 308","Linear Algebra"),
      ]}),{status:200,headers:{"content-type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchImpl);

    const route=await import("@/app/api/sources/ed/refresh/route");
    const response=await route.POST();
    expect(response.status).toBe(200);
    const body=await response.json() as {courses:Array<{externalCourseId:string;fullName:string;enabled:boolean}>};
    expect(body.courses.find(course=>course.externalCourseId==="123")).toMatchObject({fullName:"Updated Name",enabled:true});
    expect(body.courses.find(course=>course.externalCourseId==="456")).toMatchObject({enabled:false});

    const enabled=new SourceCourseRepository(getDatabase()).listEnabled(connection.id).map(course=>course.externalCourseId);
    expect(enabled).toEqual(["123"]);
  });

  it("rejects duplicate and unknown course selections without changing the previous selection",async()=>{
    seed();
    const route=await import("@/app/api/sources/ed/courses/route");

    const duplicate=await route.PUT(new Request("http://local/api",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({enabledCourseIds:["123","123"]})}));
    expect(duplicate.status).toBe(400);

    const unknown=await route.PUT(new Request("http://local/api",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({enabledCourseIds:["999"]})}));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({code:"INVALID_COURSE_SELECTION"});

    const connection=new SourceConnectionRepository(getDatabase()).getByKind("ed")!;
    expect(new SourceCourseRepository(getDatabase()).listEnabled(connection.id).map(course=>course.externalCourseId)).toEqual(["123"]);
  });

  it("saves a valid discovered-course selection",async()=>{
    seed();
    const route=await import("@/app/api/sources/ed/courses/route");
    const response=await route.PUT(new Request("http://local/api",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({enabledCourseIds:[]})}));
    expect(response.status).toBe(200);
    const connection=new SourceConnectionRepository(getDatabase()).getByKind("ed")!;
    expect(new SourceCourseRepository(getDatabase()).listEnabled(connection.id)).toEqual([]);
  });
});
