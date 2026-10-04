import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import type { SubmissionStatusResultV1 } from "@/lib/extension-protocol/submission-status";

function setup() {
  const db=openDatabase(":memory:");
  migrate(db);
  const connection=new SourceConnectionRepository(db).upsertCanvas("Canvas");
  const assignments=new AssignmentRepository(db);
  assignments.upsertMany(connection.id,[{
    source:"canvas",externalId:"event-assignment-1",courseId:"999",courseName:"CSE 999",title:"HW",
    dueAt:"2026-10-08T06:59:00.000Z",status:"unknown",sourceUrl:"https://canvas.uw.edu/courses/999/assignments/4242",sourceUpdatedAt:null,
  }],"2026-10-01T00:00:00.000Z");
  return {db,connection,assignments,assignmentId:assignments.list()[0].id,statuses:new SubmissionStatusRepository(db)};
}

const makeResult=(assignmentLocalId:string,overrides:Partial<SubmissionStatusResultV1>={}):SubmissionStatusResultV1=>({
  assignmentLocalId,courseId:"999",assignmentId:"4242",state:"submitted",isLate:false,isMissing:false,
  submittedAt:"2026-10-04T05:00:00.000Z",checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",...overrides,
});

describe("SubmissionStatusRepository",()=>{
  it("persists the latest checked status and ignores an older completion",()=>{
    const {db,connection,assignments,assignmentId,statuses}=setup();
    expect(statuses.applyCompletion(connection.id,[makeResult(assignmentId)],0,null,"2026-10-04T06:00:01.000Z")).toEqual({updated:1,ignoredStale:0});
    expect(assignments.list()[0].submissionStatus?.state).toBe("submitted");

    expect(statuses.applyCompletion(connection.id,[makeResult(assignmentId,{state:"graded",checkedAt:"2026-10-04T07:00:00.000Z"})],0,null,"2026-10-04T07:00:01.000Z")).toEqual({updated:1,ignoredStale:0});
    expect(statuses.applyCompletion(connection.id,[makeResult(assignmentId,{state:"not_submitted",checkedAt:"2026-10-04T06:30:00.000Z"})],0,null,"2026-10-04T07:00:02.000Z")).toEqual({updated:0,ignoredStale:1});
    expect(assignments.list()[0].submissionStatus?.state).toBe("graded");
    db.close();
  });

  it("preserves a known status when a later lookup fails but persists a clean unknown check",()=>{
    const {db,connection,assignments,assignmentId,statuses}=setup();
    statuses.applyCompletion(connection.id,[makeResult(assignmentId)],0,null,"2026-10-04T06:00:01.000Z");
    statuses.applyCompletion(connection.id,[makeResult(assignmentId,{state:"unknown",checkedAt:"2026-10-04T07:00:00.000Z",errorCode:"CANVAS_NETWORK_ERROR"})],1,"PARTIAL_SYNC","2026-10-04T07:00:01.000Z");
    expect(assignments.list()[0].submissionStatus?.state).toBe("submitted");

    statuses.applyCompletion(connection.id,[makeResult(assignmentId,{state:"unknown",checkedAt:"2026-10-04T08:00:00.000Z",errorCode:undefined})],0,null,"2026-10-04T08:00:01.000Z");
    expect(assignments.list()[0].submissionStatus?.state).toBe("unknown");
    db.close();
  });

  it("tracks attempt, successful-partial, and total-failure semantics",()=>{
    const {db,connection,assignmentId,statuses}=setup();
    statuses.markAttempt(connection.id,"2026-10-04T05:55:00.000Z");
    expect(statuses.getSyncState(connection.id).lastAttemptedAt).toBe("2026-10-04T05:55:00.000Z");

    statuses.applyCompletion(connection.id,[
      makeResult(assignmentId),
      makeResult("missing-local",{assignmentId:"9999",state:"unknown",errorCode:"CANVAS_NETWORK_ERROR"}),
    ],1,"PARTIAL_SYNC","2026-10-04T06:00:01.000Z");
    expect(statuses.getSyncState(connection.id)).toMatchObject({
      lastSuccessfulAt:"2026-10-04T06:00:01.000Z",
      lastErrorCode:"PARTIAL_SYNC",
      updatedCount:1,
      failedCount:1,
    });

    statuses.applyCompletion(connection.id,[makeResult(assignmentId,{state:"unknown",checkedAt:"2026-10-04T07:00:00.000Z",errorCode:"CANVAS_SIGNED_OUT"})],1,"CANVAS_SIGNED_OUT","2026-10-04T07:00:01.000Z");
    expect(statuses.getSyncState(connection.id).lastSuccessfulAt).toBe("2026-10-04T06:00:01.000Z");
    db.close();
  });

  it("cascades status rows when an assignment is deleted",()=>{
    const {db,connection,assignmentId,statuses}=setup();
    statuses.applyCompletion(connection.id,[makeResult(assignmentId)],0,null,"2026-10-04T06:00:01.000Z");
    db.prepare("DELETE FROM assignments WHERE id=?").run(assignmentId);
    expect(db.prepare("SELECT count(*) AS count FROM assignment_submission_status").get()).toEqual({count:0});
    db.close();
  });
});
