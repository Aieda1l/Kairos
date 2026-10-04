import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import {
  submissionFailureDiagnosticSchema,
  submissionStatusResultV1Schema,
  submissionSyncErrorCodeSchema,
  type SubmissionFailureDiagnostic,
  type SubmissionStatusResultV1,
} from "@/lib/extension-protocol/submission-status";
import { parseCanvasAssignmentLocator } from "@/lib/submission-status/canvas-locator";
import type { CanvasAssignmentLocator, SubmissionSyncErrorCode } from "@/lib/submission-status/types";
import {
  consumeSubmissionSyncRequest,
  registerSubmissionSyncRequest,
} from "@/lib/submission-status/request-registry";

export const submissionSyncCompleteInputSchema=z.object({
  requestId:z.string().uuid(),
  results:z.array(submissionStatusResultV1Schema),
  batchErrorCode:submissionSyncErrorCodeSchema.nullable().optional(),
}).strict();

export type SubmissionSyncCompleteInput=z.infer<typeof submissionSyncCompleteInputSchema>;

export type SubmissionSyncStartResponse={
  requestId:string;
  assignments:CanvasAssignmentLocator[];
  maxBatchSize:100;
};

export type SubmissionSyncCompleteResponse={
  requestId:string;
  updatedCount:number;
  failedCount:number;
  ignoredStale:number;
  lastAttemptedAt:string|null;
  lastSuccessfulAt:string|null;
  lastErrorCode:SubmissionSyncErrorCode|null;
  failureDiagnostics:Array<{code:SubmissionFailureDiagnostic;count:number}>;
  failureHttpStatuses:Array<{status:number;count:number}>;
};

export class SubmissionStatusSyncServiceError extends Error {
  constructor(
    public readonly code:"CANVAS_NOT_CONFIGURED"|"SYNC_REQUEST_NOT_FOUND"|"INVALID_RESULT",
    message:string,
  ){
    super(message);
    this.name="SubmissionStatusSyncServiceError";
  }
}

export function startCanvasSubmissionStatusSync(
  db:Database.Database,
  now:Date=new Date(),
):SubmissionSyncStartResponse {
  const connection=new SourceConnectionRepository(db).getByKind("canvas");
  if(!connection){
    throw new SubmissionStatusSyncServiceError("CANVAS_NOT_CONFIGURED","Connect Canvas before syncing submission status.");
  }
  const assignments=new AssignmentRepository(db)
    .list({source:"canvas"})
    .map(parseCanvasAssignmentLocator)
    .filter((value):value is CanvasAssignmentLocator=>value!==null);
  const requestId=crypto.randomUUID();
  const startedAt=now.toISOString();
  new SubmissionStatusRepository(db).markAttempt(connection.id,startedAt);
  registerSubmissionSyncRequest(requestId,connection.id,assignments,startedAt);
  return {requestId,assignments,maxBatchSize:100};
}

function sameIdentity(a:CanvasAssignmentLocator,b:SubmissionStatusResultV1):boolean {
  return a.assignmentLocalId===b.assignmentLocalId
    && a.courseId===b.courseId
    && a.assignmentId===b.assignmentId;
}

export function completeCanvasSubmissionStatusSync(
  db:Database.Database,
  input:SubmissionSyncCompleteInput,
  now:Date=new Date(),
):SubmissionSyncCompleteResponse {
  const registered=consumeSubmissionSyncRequest(input.requestId,now.getTime());
  if(!registered){
    throw new SubmissionStatusSyncServiceError("SYNC_REQUEST_NOT_FOUND","This submission-status sync request is no longer active.");
  }

  const statusRepo=new SubmissionStatusRepository(db);
  const requestedByLocalId=new Map(registered.assignments.map(item=>[item.assignmentLocalId,item]));
  const seen=new Set<string>();
  for(const result of input.results){
    const requested=requestedByLocalId.get(result.assignmentLocalId);
    if(!requested||seen.has(result.assignmentLocalId)||!sameIdentity(requested,result)){
      statusRepo.applyCompletion(
        registered.connectionId,
        [],
        registered.assignments.length,
        "INVALID_RESULT",
        now.toISOString(),
      );
      throw new SubmissionStatusSyncServiceError("INVALID_RESULT","The extension returned an unexpected assignment result.");
    }
    seen.add(result.assignmentLocalId);
  }

  const explicitFailures=input.results.filter(result=>Boolean(result.errorCode)).length;
  const omitted=Math.max(0,registered.assignments.length-input.results.length);
  const failedCount=explicitFailures+omitted;
  const successfulCount=input.results.length-explicitFailures;
  let errorCode:SubmissionSyncErrorCode|null=null;
  if(successfulCount>0&&failedCount>0){
    errorCode="PARTIAL_SYNC";
  }else if(successfulCount===0&&failedCount>0){
    errorCode=input.batchErrorCode
      ?? input.results.find(result=>result.errorCode)?.errorCode
      ?? "INVALID_RESULT";
  }

  const diagnosticCounts=new Map<SubmissionFailureDiagnostic,number>();
  for(const result of input.results){
    if(result.diagnosticCode){
      submissionFailureDiagnosticSchema.parse(result.diagnosticCode);
      diagnosticCounts.set(result.diagnosticCode,(diagnosticCounts.get(result.diagnosticCode)??0)+1);
    }
  }
  const failureDiagnostics=Array.from(diagnosticCounts.entries())
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));

  const httpStatusCounts=new Map<number,number>();
  for(const result of input.results){
    if(result.httpStatus!==undefined){
      httpStatusCounts.set(result.httpStatus,(httpStatusCounts.get(result.httpStatus)??0)+1);
    }
  }
  const failureHttpStatuses=Array.from(httpStatusCounts.entries())
    .sort(([a],[b])=>a-b)
    .map(([status,count])=>({status,count}));

  const completedAt=now.toISOString();
  const applied=statusRepo.applyCompletion(
    registered.connectionId,
    input.results,
    failedCount,
    errorCode,
    completedAt,
  );
  const state=statusRepo.getSyncState(registered.connectionId);
  return {
    requestId:input.requestId,
    updatedCount:applied.updated,
    failedCount,
    ignoredStale:applied.ignoredStale,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
    failureDiagnostics,
    failureHttpStatuses,
  };
}
