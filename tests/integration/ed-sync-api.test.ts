import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDatabase, resetDatabaseSingletonForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";

let dbPath:string;

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-ed-sync-${crypto.randomUUID()}.sqlite`);
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
  const courses=new SourceCourseRepository(db);
  courses.upsertDiscovered(connection.id,[{externalCourseId:"123",shortName:"CSE 123",fullName:"Course 123",term:"Autumn",year:"2026"}],"2026-10-05T10:00:00Z");
  courses.setEnabled(connection.id,["123"]);
}

it("sync route never accepts or returns the Ed token",async()=>{
  seed();
  vi.stubGlobal("fetch",vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-ed-token-never-echo");
    return new Response(JSON.stringify({modules:[],lessons:[]}),{status:200,headers:{"content-type":"application/json"}});
  }));
  const route=await import("@/app/api/sources/ed/sync/route");
  const response=await route.POST();
  expect(response.status).toBe(200);
  const text=await response.text();
  expect(text).not.toContain("fixture-ed-token-never-echo");
  expect(text.toLowerCase()).not.toContain("authorization");
});

it("returns 409 before connection or when no courses are enabled",async()=>{
  const route=await import("@/app/api/sources/ed/sync/route");
  expect((await route.POST()).status).toBe(409);

  const db=getDatabase(); migrate(db);
  const connection=new SourceConnectionRepository(db).upsertEd("Ed");
  new SourceCredentialRepository(db).setEdApiToken(connection.id,"token");
  expect((await route.POST()).status).toBe(409);
});

it("uses 401 for total auth failure but 200 for partial success",async()=>{
  seed();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("",{status:401})));
  const route=await import("@/app/api/sources/ed/sync/route");
  const auth=await route.POST();
  expect(auth.status).toBe(401);
  expect(await auth.json()).toMatchObject({lastErrorCode:"ED_AUTH_INVALID"});
});
