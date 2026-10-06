import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,expect,it} from "vitest";
import {resetDatabaseSingletonForTests} from "@/lib/db/client";

let dbPath:string;

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`settings-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  resetDatabaseSingletonForTests();
});

afterEach(()=>{
  resetDatabaseSingletonForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

it("gets, updates, and validates timezone",async()=>{
  const route=await import("@/app/api/settings/timezone/route");
  expect(await (await route.GET()).json()).toEqual({timeZone:"America/Los_Angeles"});
  const good=await route.PUT(new Request("http://local",{
    method:"PUT",
    body:JSON.stringify({timeZone:"UTC"}),
  }));
  expect(await good.json()).toEqual({timeZone:"UTC"});
  const bad=await route.PUT(new Request("http://local",{
    method:"PUT",
    body:JSON.stringify({timeZone:"not/a-zone"}),
  }));
  expect(bad.status).toBe(400);
  expect(await (await route.GET()).json()).toEqual({timeZone:"UTC"});
});

it("gets and updates the hide-submitted calendar preference",async()=>{
  const route=await import("@/app/api/settings/calendar/route");
  expect(await (await route.GET()).json()).toEqual({hideSubmitted:true});

  const off=await route.PUT(new Request("http://local",{
    method:"PUT",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({hideSubmitted:false}),
  }));
  expect(off.status).toBe(200);
  expect(await off.json()).toEqual({hideSubmitted:false});
  expect(await (await route.GET()).json()).toEqual({hideSubmitted:false});

  const bad=await route.PUT(new Request("http://local",{
    method:"PUT",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({hideSubmitted:"yes"}),
  }));
  expect(bad.status).toBe(400);
  expect(await (await route.GET()).json()).toEqual({hideSubmitted:false});
});
