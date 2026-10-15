import "server-only";
import crypto from "node:crypto";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SubmissionStatusRepository} from "@/lib/db/d1/repositories/submission-status";
import {D1SyncRequestRepository} from "@/lib/db/d1/repositories/sync-requests";
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
  db:LegacyDatabase,
  now?:Date,
):SubmissionSyncStartResponse;
export function startCanvasSubmissionStatusSync(
  db:D1DatabaseLike,
  scope:UserScope,
  now?:Date,
):Promise<SubmissionSyncStartResponse>;
export function startCanvasSubmissionStatusSync(
  db:LegacyDatabase|D1DatabaseLike,
  arg2?:Date|UserScope,
  arg3?:Date,
):SubmissionSyncStartResponse|Promise<SubmissionSyncStartResponse>{
  if(arg2 instanceof Date||arg2===undefined){
    const legacyDb=db as LegacyDatabase;
    const now=arg2??new Date();
    const connection=new SourceConnectionRepository(legacyDb).getByKind("canvas");
    if(!connection){
      throw new SubmissionStatusSyncServiceError("CANVAS_NOT_CONFIGURED","Connect Canvas before syncing submission status.");
    }
    const assignments=new AssignmentRepository(legacyDb)
      .list({source:"canvas"})
      .map(parseCanvasAssignmentLocator)
      .filter((value):value is CanvasAssignmentLocator=>value!==null);
    const requestId=crypto.randomUUID();
    const startedAt=now.toISOString();
    new SubmissionStatusRepository(legacyDb).markAttempt(connection.id,startedAt);
    registerSubmissionSyncRequest(requestId,connection.id,assignments,startedAt);
    return {requestId,assignments,maxBatchSize:100};
  }

  return (async()=>{
    const hostedDb=db as D1DatabaseLike;
    const scope=arg2;
    const now=arg3??new Date();
    const connection=await new D1SourceConnectionRepository(hostedDb,scope)
      .getByKind("canvas");
    if(!connection){
      throw new SubmissionStatusSyncServiceError("CANVAS_NOT_CONFIGURED","Connect Canvas before syncing submission status.");
    }
    const assignments=(await new D1AssignmentRepository(hostedDb,scope)
      .list({source:"canvas"}))
      .map(parseCanvasAssignmentLocator)
      .filter((value):value is CanvasAssignmentLocator=>value!==null);
    const requestId=crypto.randomUUID();
    const startedAt=now.toISOString();
    await new D1SubmissionStatusRepository(hostedDb,scope)
      .markAttempt(connection.id,startedAt);
    await new D1SyncRequestRepository(hostedDb,scope).register({
      requestId,
      kind:"canvas_submission",
      payload:{connectionId:connection.id,assignments},
      createdAt:startedAt,
      expiresAt:new Date(now.getTime()+10*60*1000).toISOString(),
    });
    return {requestId,assignments,maxBatchSize:100 as const};
  })();
}

function sameIdentity(a:CanvasAssignmentLocator,b:SubmissionStatusResultV1):boolean {
  return a.assignmentLocalId===b.assignmentLocalId
    && a.courseId===b.courseId
    && a.assignmentId===b.assignmentId;
}

export function completeCanvasSubmissionStatusSync(
  db:LegacyDatabase,
  input:SubmissionSyncCompleteInput,
  now?:Date,
):SubmissionSyncCompleteResponse;
export function completeCanvasSubmissionStatusSync(
  db:D1DatabaseLike,
  scope:UserScope,
  input:SubmissionSyncCompleteInput,
  now?:Date,
):Promise<SubmissionSyncCompleteResponse>;
export function completeCanvasSubmissionStatusSync(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:SubmissionSyncCompleteInput|UserScope,
  arg3?:Date|SubmissionSyncCompleteInput,
  arg4?:Date,
):SubmissionSyncCompleteResponse|Promise<SubmissionSyncCompleteResponse>{
  if("requestId" in arg2){
    return completeCanvasSubmissionStatusSyncLegacy(
      db as LegacyDatabase,
      arg2,
      arg3 instanceof Date?arg3:new Date(),
    );
  }
  return completeCanvasSubmissionStatusSyncHosted(
    db as D1DatabaseLike,
    arg2,
    arg3 as SubmissionSyncCompleteInput,
    arg4??new Date(),
  );
}

function completeCanvasSubmissionStatusSyncLegacy(
  db:LegacyDatabase,
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

async function completeCanvasSubmissionStatusSyncHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  input:SubmissionSyncCompleteInput,
  now:Date,
):Promise<SubmissionSyncCompleteResponse>{
  const registered=await new D1SyncRequestRepository(db,scope).consume<{
    connectionId:string;
    assignments:CanvasAssignmentLocator[];
  }>(input.requestId,"canvas_submission",now);
  if(!registered){
    throw new SubmissionStatusSyncServiceError(
      "SYNC_REQUEST_NOT_FOUND",
      "This submission-status sync request is no longer active.",
    );
  }

  const {connectionId,assignments}=registered.payload;
  const statusRepo=new D1SubmissionStatusRepository(db,scope);
  const requestedByLocalId=new Map(assignments.map(item=>[item.assignmentLocalId,item]));
  const seen=new Set<string>();
  for(const result of input.results){
    const requested=requestedByLocalId.get(result.assignmentLocalId);
    if(!requested||seen.has(result.assignmentLocalId)||!sameIdentity(requested,result)){
      await statusRepo.applyCompletion(
        connectionId,[],assignments.length,"INVALID_RESULT",now.toISOString(),0,
      );
      throw new SubmissionStatusSyncServiceError(
        "INVALID_RESULT",
        "The extension returned an unexpected assignment result.",
      );
    }
    seen.add(result.assignmentLocalId);
  }

  const explicitFailures=input.results.filter(result=>Boolean(result.errorCode)).length;
  const omitted=Math.max(0,assignments.length-input.results.length);
  const failedCount=explicitFailures+omitted;
  const successfulCount=input.results.length-explicitFailures;
  let errorCode:SubmissionSyncErrorCode|null=null;
  if(successfulCount>0&&failedCount>0){
    errorCode="PARTIAL_SYNC";
  }else if(successfulCount===0&&failedCount>0){
    errorCode=input.batchErrorCode
      ??input.results.find(result=>result.errorCode)?.errorCode
      ??"INVALID_RESULT";
  }

  const diagnosticCounts=new Map<SubmissionFailureDiagnostic,number>();
  const httpStatusCounts=new Map<number,number>();
  for(const result of input.results){
    if(result.diagnosticCode){
      submissionFailureDiagnosticSchema.parse(result.diagnosticCode);
      diagnosticCounts.set(
        result.diagnosticCode,
        (diagnosticCounts.get(result.diagnosticCode)??0)+1,
      );
    }
    if(result.httpStatus!==undefined){
      httpStatusCounts.set(result.httpStatus,(httpStatusCounts.get(result.httpStatus)??0)+1);
    }
  }

  const completedAt=now.toISOString();
  const applied=await statusRepo.applyCompletion(
    connectionId,input.results,failedCount,errorCode,completedAt,
  );
  const state=await statusRepo.getSyncState(connectionId);
  return {
    requestId:input.requestId,
    updatedCount:applied.updated,
    failedCount,
    ignoredStale:applied.ignoredStale,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
    failureDiagnostics:Array.from(diagnosticCounts.entries())
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count})),
    failureHttpStatuses:Array.from(httpStatusCounts.entries())
      .sort(([a],[b])=>a-b)
      .map(([status,count])=>({status,count})),
  };
}
