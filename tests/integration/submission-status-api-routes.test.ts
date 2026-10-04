import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabase, resetDatabaseSingletonForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import { resetSubmissionSyncRequestRegistryForTests } from "@/lib/submission-status/request-registry";

let dbPath:string;

beforeEach(()=>{
  dbPath=path.join(os.tmpdir(),`kairos-submission-${crypto.randomUUID()}.sqlite`);
  process.env.ASSIGNMENTS_DB_PATH=dbPath;
  resetDatabaseSingletonForTests();
  resetSubmissionSyncRequestRegistryForTests();
});

afterEach(()=>{
  resetDatabaseSingletonForTests();
  resetSubmissionSyncRequestRegistryForTests();
  for(const suffix of ["","-wal","-shm"])try{fs.unlinkSync(dbPath+suffix)}catch{}
});

function seed(options:{second?:boolean;invalid?:boolean}={}){
  const db=getDatabase(); migrate(db);
  const connection=new SourceConnectionRepository(db).upsertCanvas("Canvas");
  const assignments=new AssignmentRepository(db);
  assignments.upsertMany(connection.id,[{
    source:"canvas",externalId:"one",courseId:"999",courseName:"CSE 999",title:"One",dueAt:null,status:"unknown",
    sourceUrl:"https://canvas.uw.edu/courses/999/assignments/4242",sourceUpdatedAt:null,
  },...(options.second?[{
    source:"canvas" as const,externalId:"two",courseId:"999",courseName:"CSE 999",title:"Two",dueAt:null,status:"unknown" as const,
    sourceUrl:"https://canvas.uw.edu/courses/999/assignments/4343",sourceUpdatedAt:null,
  }]:[]),...(options.invalid?[{
    source:"canvas" as const,externalId:"bad",courseId:"abc",courseName:"CSE 999",title:"Bad",dueAt:null,status:"unknown" as const,
    sourceUrl:"https://evil.example/courses/abc/assignments/999",sourceUpdatedAt:null,
  }]:[])],"2026-10-04T05:00:00.000Z");
  return {db,connection,assignments};
}

const start=async()=>{const route=await import("@/app/api/sources/canvas/submission-status/start/route");return route.POST();};
const complete=async(body:unknown)=>{const route=await import("@/app/api/sources/canvas/submission-status/complete/route");return route.POST(new Request("http://local/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));};

describe("Canvas submission status routes",()=>{
  it("requires Canvas configuration",async()=>{
    const db=getDatabase(); migrate(db);
    const response=await start();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"CANVAS_NOT_CONFIGURED"});
  });

  it("starts from all eligible imported Canvas assignments and marks an attempt",async()=>{
    const {connection}=seed({second:true,invalid:true});
    const response=await start();
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.assignments).toHaveLength(2);
    expect(body.assignments.map((a:{assignmentId:string})=>a.assignmentId).sort()).toEqual(["4242","4343"]);
    expect(body.maxBatchSize).toBe(100);
    expect(new SubmissionStatusRepository(getDatabase()).getSyncState(connection.id).lastAttemptedAt).not.toBeNull();
  });

  it("rejects mismatched and duplicate result identities and records validation failure",async()=>{
    const {connection}=seed();
    const started=await (await start()).json();
    const bad=await complete({
      requestId:started.requestId,
      results:[{
        ...started.assignments[0],assignmentId:"9999",state:"submitted",isLate:false,isMissing:false,
        submittedAt:null,checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",
      }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({code:"INVALID_RESULT"});
    expect(new SubmissionStatusRepository(getDatabase()).getSyncState(connection.id)).toMatchObject({
      lastSuccessfulAt:null,
      lastErrorCode:"INVALID_RESULT",
      updatedCount:0,
      failedCount:1,
    });

    const consumed=await complete({requestId:started.requestId,results:[]});
    expect(consumed.status).toBe(409);
    expect(await consumed.json()).toMatchObject({code:"SYNC_REQUEST_NOT_FOUND"});

    const second=await (await start()).json();
    const result={...second.assignments[0],state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1"};
    const duplicate=await complete({requestId:second.requestId,results:[result,result]});
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({code:"INVALID_RESULT"});
  });

  it("persists successful partial results and counts failures",async()=>{
    const {connection,assignments}=seed({second:true});
    const started=await (await start()).json();
    const [one,two]=started.assignments;
    const response=await complete({
      requestId:started.requestId,
      results:[
        {...one,state:"submitted",isLate:true,isMissing:false,submittedAt:"2026-10-04T05:30:00.000Z",checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1"},
        {...two,state:"unknown",isLate:false,isMissing:false,submittedAt:null,checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",errorCode:"CANVAS_NETWORK_ERROR",diagnosticCode:"HTTP_OTHER",httpStatus:418},
      ],
      batchErrorCode:"PARTIAL_SYNC",
    });
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body).toMatchObject({updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC",failureDiagnostics:[{code:"HTTP_OTHER",count:1}],failureHttpStatuses:[{status:418,count:1}]});
    expect(assignments.list().find(a=>a.id===one.assignmentLocalId)?.submissionStatus).toMatchObject({state:"submitted",isLate:true});
    expect(assignments.list().find(a=>a.id===two.assignmentLocalId)?.submissionStatus).toBeNull();
    expect(new SubmissionStatusRepository(getDatabase()).getSyncState(connection.id).lastSuccessfulAt).not.toBeNull();
  });

  it("preserves prior status and last success on a signed-out total failure",async()=>{
    const {connection,assignments}=seed();
    const assignment=assignments.list()[0];
    const statuses=new SubmissionStatusRepository(getDatabase());
    statuses.applyCompletion(connection.id,[{
      assignmentLocalId:assignment.id,courseId:"999",assignmentId:"4242",state:"submitted",isLate:false,isMissing:false,
      submittedAt:null,checkedAt:"2026-10-04T05:00:00.000Z",extractorVersion:"canvas-html-v1",
    }],0,null,"2026-10-04T05:00:01.000Z");
    const previous=statuses.getSyncState(connection.id).lastSuccessfulAt;

    const started=await (await start()).json();
    const response=await complete({
      requestId:started.requestId,
      results:[{
        ...started.assignments[0],state:"unknown",isLate:false,isMissing:false,submittedAt:null,
        checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",errorCode:"CANVAS_SIGNED_OUT",
      }],
      batchErrorCode:"CANVAS_SIGNED_OUT",
    });
    expect(response.status).toBe(200);
    expect(assignments.list()[0].submissionStatus?.state).toBe("submitted");
    expect(statuses.getSyncState(connection.id).lastSuccessfulAt).toBe(previous);
  });
});
