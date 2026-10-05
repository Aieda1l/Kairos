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

const userPayload=(courses:unknown[]=[])=>({user:{id:7},courses});
const enrollment=(id:number,code:string,name:string)=>({
  course:{id,code,name,year:"2026",session:"Autumn"},
  role:{role:"student"},
});

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-ed-connect-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  process.env.E2E_FIXTURES="0";
  resetDatabaseSingletonForTests();
});
afterEach(()=>{
  vi.unstubAllGlobals();
  resetDatabaseSingletonForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

async function post(pathname:"test"|"connect",body:unknown){
  const request=new Request("http://local/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(pathname==="test"){
    const route=await import("@/app/api/sources/ed/test/route");
    return route.POST(request);
  }
  const route=await import("@/app/api/sources/ed/connect/route");
  return route.POST(request);
}

describe("Ed connection routes",()=>{
  it("tests a token without persisting credentials or a source connection",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(userPayload([
      enrollment(123,"CSE 331","Software Design"),
    ])),{status:200,headers:{"content-type":"application/json"}})));

    const response=await post("test",{token:"fixture-ed-token-never-echo"});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true,itemCount:1});

    const db=getDatabase(); migrate(db);
    expect(new SourceConnectionRepository(db).getByKind("ed")).toBeNull();
    const credentials=db.prepare("SELECT count(*) AS count FROM source_credentials").get() as {count:number};
    expect(credentials.count).toBe(0);
  });

  it("connects only after validation and never returns the token",async()=>{
    const token="fixture-ed-token-never-echo";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(userPayload([
      enrollment(123,"CSE 331","Software Design"),
    ])),{status:200,headers:{"content-type":"application/json"}})));

    const response=await post("connect",{token});
    expect(response.status).toBe(200);
    const text=await response.text();
    expect(text).not.toContain(token);
    const body=JSON.parse(text) as {connection:{kind:string};courses:Array<{externalCourseId:string;enabled:boolean}>};
    expect(body.connection.kind).toBe("ed");
    expect(body.courses).toMatchObject([{externalCourseId:"123",enabled:false}]);

    const db=getDatabase(); migrate(db);
    const connection=new SourceConnectionRepository(db).getByKind("ed")!;
    expect(new SourceCredentialRepository(db).getEdApiToken(connection.id)).toBe(token);
    expect(new SourceCourseRepository(db).list(connection.id)).toMatchObject([{externalCourseId:"123",enabled:false}]);
  });

  it("accepts a valid account with zero courses",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(userPayload()),{status:200,headers:{"content-type":"application/json"}})));
    const response=await post("connect",{token:"fixture-ed-token-never-echo"});
    expect(response.status).toBe(200);
    expect((await response.json()).courses).toEqual([]);
  });

  it("maps invalid auth and malformed user payloads to stable safe errors",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("",{status:401})));
    const auth=await post("connect",{token:"secret-invalid-token"});
    expect(auth.status).toBe(401);
    expect(await auth.json()).toMatchObject({code:"ED_AUTH_INVALID"});

    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({user:{id:7}}),{status:200,headers:{"content-type":"application/json"}})));
    const malformed=await post("connect",{token:"secret-malformed-token"});
    expect(malformed.status).toBe(502);
    const malformedText=await malformed.text();
    expect(JSON.parse(malformedText)).toMatchObject({code:"ED_PARSE_ERROR"});
    expect(malformedText).not.toContain("secret-malformed-token");
  });

  it("keeps the previous valid token when a replacement token fails validation",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(userPayload()),{status:200,headers:{"content-type":"application/json"}})));
    expect((await post("connect",{token:"old-valid-token"})).status).toBe(200);

    vi.stubGlobal("fetch",vi.fn(async()=>new Response("",{status:401})));
    const failed=await post("connect",{token:"new-invalid-token"});
    expect(failed.status).toBe(401);

    const db=getDatabase(); migrate(db);
    const connection=new SourceConnectionRepository(db).getByKind("ed")!;
    expect(new SourceCredentialRepository(db).getEdApiToken(connection.id)).toBe("old-valid-token");
  });
});
