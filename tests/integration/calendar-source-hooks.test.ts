import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getDatabase,resetDatabaseSingletonForTests} from "../helpers/legacy-db";
import {migrate} from "../helpers/legacy-db";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";

const mocks=vi.hoisted(()=>({
  reconcileAll:vi.fn(async()=>({status:"success",results:[]})),
  adapterFactory:vi.fn(),
  canvasSync:vi.fn(),
  gradescopeComplete:vi.fn(),
  submissionComplete:vi.fn(),
  edSync:vi.fn(),
}));

vi.mock("@/lib/calendar/reconcile",()=>({
  reconcileAllCalendars:mocks.reconcileAll,
}));
vi.mock("@/lib/calendar/provider-factory",()=>({
  createCalendarAdapterFactory:()=>mocks.adapterFactory,
}));
vi.mock("@/lib/sync/sync-source",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/sync/sync-source")>();
  return {...actual,syncCanvasConnection:mocks.canvasSync};
});
vi.mock("@/lib/gradescope/sync-service",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/gradescope/sync-service")>();
  return {...actual,completeGradescopeSync:mocks.gradescopeComplete};
});
vi.mock("@/lib/submission-status/sync-service",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/submission-status/sync-service")>();
  return {...actual,completeCanvasSubmissionStatusSync:mocks.submissionComplete};
});
vi.mock("@/lib/ed/sync-service",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/ed/sync-service")>();
  return {...actual,syncEdConnection:mocks.edSync};
});

let dbPath:string;
const requestId="00000000-0000-4000-8000-000000000001";

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-calendar-source-hook-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  process.env.E2E_FIXTURES="0";
  resetDatabaseSingletonForTests();
  const db=getDatabase();
  migrate(db);
  new SourceConnectionRepository(db).upsertCanvas("Canvas");

  mocks.reconcileAll.mockReset();
  mocks.reconcileAll.mockResolvedValue({status:"success",results:[]});
  mocks.adapterFactory.mockReset();
  mocks.canvasSync.mockReset();
  mocks.canvasSync.mockResolvedValue({
    connectionId:"canvas",
    inserted:1,
    updated:0,
    skipped:0,
    errors:[],
    partial:false,
    completedAt:"2026-10-06T01:00:00.000Z",
  });
  mocks.gradescopeComplete.mockReset();
  mocks.gradescopeComplete.mockReturnValue({
    requestId,
    insertedCount:1,
    updatedCount:0,
    statusUpdatedCount:0,
    failedCourseCount:0,
    ignoredStale:0,
    lastAttemptedAt:"2026-10-06T01:00:00.000Z",
    lastSuccessfulAt:"2026-10-06T01:00:00.000Z",
    lastErrorCode:null,
    failureDiagnostics:[],
    failureHttpStatuses:[],
    failureErrorCodes:[],
    failureStructures:[],
  });
  mocks.submissionComplete.mockReset();
  mocks.submissionComplete.mockReturnValue({
    requestId,
    updatedCount:1,
    failedCount:0,
    ignoredStale:0,
    lastAttemptedAt:"2026-10-06T01:00:00.000Z",
    lastSuccessfulAt:"2026-10-06T01:00:00.000Z",
    lastErrorCode:null,
    failureDiagnostics:[],
    failureHttpStatuses:[],
  });
  mocks.edSync.mockReset();
  mocks.edSync.mockResolvedValue({
    insertedCount:1,
    updatedCount:0,
    statusUpdatedCount:0,
    failedCourseCount:0,
    lastAttemptedAt:"2026-10-06T01:00:00.000Z",
    lastSuccessfulAt:"2026-10-06T01:00:00.000Z",
    lastErrorCode:null,
  });
});

afterEach(()=>{
  resetDatabaseSingletonForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

describe("calendar reconciliation after source writes",()=>{
  it("runs after a changed Canvas deadline sync",async()=>{
    const route=await import("@/app/api/sources/canvas/sync/route");
    const response=await route.POST(new Request("http://localhost/api/sources/canvas/sync",{method:"POST"}));
    expect(response.status).toBe(200);
    expect(mocks.reconcileAll).toHaveBeenCalledTimes(1);
  });

  it("defers the Canvas calendar pass without suppressing the source write",async()=>{
    const route=await import("@/app/api/sources/canvas/sync/route");
    const response=await route.POST(new Request("http://localhost/api/sources/canvas/sync",{
      method:"POST",
      headers:{"x-kairos-calendar-sync":"defer"},
    }));
    expect(response.status).toBe(200);
    expect(mocks.canvasSync).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileAll).not.toHaveBeenCalled();
  });

  it("runs after Gradescope, Ed, and Canvas submission writes",async()=>{
    const gradescope=await import("@/app/api/sources/gradescope/sync/complete/route");
    const gradescopeResponse=await gradescope.POST(new Request("http://localhost/api/sources/gradescope/sync/complete",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({requestId,batches:[],batchErrorCode:"EXTENSION_UNAVAILABLE"}),
    }));
    expect(gradescopeResponse.status).toBe(200);

    const ed=await import("@/app/api/sources/ed/sync/route");
    const edResponse=await ed.POST(new Request("http://localhost/api/sources/ed/sync",{method:"POST"}));
    expect(edResponse.status).toBe(200);

    const submission=await import("@/app/api/sources/canvas/submission-status/complete/route");
    const submissionResponse=await submission.POST(new Request("http://localhost/api/sources/canvas/submission-status/complete",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({requestId,results:[]}),
    }));
    expect(submissionResponse.status).toBe(200);

    expect(mocks.reconcileAll).toHaveBeenCalledTimes(3);
  });

  it("also reconciles after partial source results when local writes succeeded",async()=>{
    mocks.gradescopeComplete.mockReturnValue({
      requestId,
      insertedCount:0,
      updatedCount:1,
      statusUpdatedCount:0,
      failedCourseCount:1,
      ignoredStale:0,
      lastAttemptedAt:"2026-10-06T01:00:00.000Z",
      lastSuccessfulAt:"2026-10-06T01:00:00.000Z",
      lastErrorCode:"PARTIAL_SYNC",
      failureDiagnostics:[],
      failureHttpStatuses:[],
      failureErrorCodes:[],
      failureStructures:[],
    });
    const route=await import("@/app/api/sources/gradescope/sync/complete/route");
    const response=await route.POST(new Request("http://localhost/api/sources/gradescope/sync/complete",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({requestId,batches:[],batchErrorCode:"EXTENSION_UNAVAILABLE"}),
    }));
    expect(response.status).toBe(200);
    expect(mocks.reconcileAll).toHaveBeenCalledTimes(1);
  });

  it("does not reconcile when a successful source operation changed no projection data",async()=>{
    mocks.canvasSync.mockResolvedValue({
      connectionId:"canvas",
      inserted:0,
      updated:0,
      skipped:0,
      errors:[],
      partial:false,
      completedAt:"2026-10-06T01:00:00.000Z",
    });
    const route=await import("@/app/api/sources/canvas/sync/route");
    expect((await route.POST(new Request("http://localhost/api/sources/canvas/sync",{method:"POST"}))).status).toBe(200);
    expect(mocks.reconcileAll).not.toHaveBeenCalled();
  });

  it("keeps the source response successful when outbound calendar reconciliation throws",async()=>{
    mocks.reconcileAll.mockRejectedValueOnce(new Error("fixture calendar failure"));
    const route=await import("@/app/api/sources/canvas/sync/route");
    const response=await route.POST(new Request("http://localhost/api/sources/canvas/sync",{method:"POST"}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({inserted:1});
    expect(mocks.reconcileAll).toHaveBeenCalledTimes(1);
  });
});
