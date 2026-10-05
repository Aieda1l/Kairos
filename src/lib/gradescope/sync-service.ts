import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import {
  gradescopeSyncErrorCodeSchema,
  gradescopeSyncResultV1Schema,
  type GradescopeAssignmentV1,
  type GradescopeDiagnosticCode,
  type GradescopeSyncErrorCode,
  type GradescopeSyncResultV1,
} from "@/lib/extension-protocol/gradescope";
import type { AssignmentStatus } from "@/lib/assignments/types";
import type { NormalizedAssignment } from "@/lib/assignments/normalize";
import type { SubmissionStatusWrite } from "@/lib/submission-status/types";
import {
  consumeGradescopeRequest,
  registerGradescopeRequest,
  type RegisteredGradescopeRequest,
} from "./request-registry";

export const gradescopeSyncCompleteInputSchema=z.object({
  requestId:z.string().uuid(),
  batches:z.array(gradescopeSyncResultV1Schema).max(3),
  batchErrorCode:gradescopeSyncErrorCodeSchema.nullable().optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.batches.length===0&&!value.batchErrorCode){
    ctx.addIssue({code:"custom",message:"A sync completion needs a result batch or an error code.",path:["batches"]});
  }
});

export type GradescopeSyncCompleteInput=z.infer<typeof gradescopeSyncCompleteInputSchema>;

export type GradescopeSyncStartResponse={
  protocolVersion:1;
  requestId:string;
  courseIds:string[];
  maxCourseBatchSize:20;
};

export type GradescopeSyncCompleteResponse={
  requestId:string;
  insertedCount:number;
  updatedCount:number;
  statusUpdatedCount:number;
  failedCourseCount:number;
  ignoredStale:number;
  lastAttemptedAt:string|null;
  lastSuccessfulAt:string|null;
  lastErrorCode:GradescopeSyncErrorCode|null;
  failureDiagnostics:Array<{code:GradescopeDiagnosticCode;count:number}>;
  failureHttpStatuses:Array<{status:number;count:number}>;
};

export class GradescopeSyncServiceError extends Error{
  constructor(
    public readonly code:
      |"GRADESCOPE_NOT_CONFIGURED"
      |"GRADESCOPE_NO_COURSES_ENABLED"
      |"SYNC_REQUEST_NOT_FOUND"
      |"INVALID_RESULT",
    message:string,
  ){
    super(message);
    this.name="GradescopeSyncServiceError";
  }
}

export function startGradescopeSync(
  db:Database.Database,
  now:Date=new Date(),
):GradescopeSyncStartResponse{
  const connection=new SourceConnectionRepository(db).getByKind("gradescope");
  if(!connection){
    throw new GradescopeSyncServiceError("GRADESCOPE_NOT_CONFIGURED","Discover Gradescope courses before syncing.");
  }
  const enabled=new SourceCourseRepository(db).listEnabled(connection.id);
  if(enabled.length===0){
    throw new GradescopeSyncServiceError("GRADESCOPE_NO_COURSES_ENABLED","Enable at least one Gradescope course before syncing.");
  }

  const requestId=crypto.randomUUID();
  const startedAt=now.toISOString();
  const courseIds=enabled.map(course=>course.externalCourseId);
  new SubmissionStatusRepository(db).markAttempt(connection.id,startedAt);
  registerGradescopeRequest({
    requestId,
    kind:"sync",
    connectionId:connection.id,
    courseIds,
    startedAt,
  });
  return {protocolVersion:1,requestId,courseIds,maxCourseBatchSize:20};
}

function legacyStatus(state:GradescopeAssignmentV1["state"]):AssignmentStatus{
  switch(state){
    case "graded":return "graded";
    case "submitted":
    case "excused":return "submitted";
    case "not_submitted":return "pending";
    default:return "unknown";
  }
}

function aggregateDiagnostics(courses:GradescopeSyncResultV1["courses"]){
  const diagnosticCounts=new Map<GradescopeDiagnosticCode,number>();
  const httpCounts=new Map<number,number>();
  for(const course of courses){
    if(course.diagnosticCode){
      diagnosticCounts.set(course.diagnosticCode,(diagnosticCounts.get(course.diagnosticCode)??0)+1);
    }
    for(const diagnostic of course.parseDiagnosticCounts){
      diagnosticCounts.set(diagnostic.code,(diagnosticCounts.get(diagnostic.code)??0)+diagnostic.count);
    }
    if(course.httpStatus!==undefined){
      httpCounts.set(course.httpStatus,(httpCounts.get(course.httpStatus)??0)+1);
    }
  }
  return {
    failureDiagnostics:Array.from(diagnosticCounts.entries())
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count})),
    failureHttpStatuses:Array.from(httpCounts.entries())
      .sort(([a],[b])=>a-b)
      .map(([status,count])=>({status,count})),
  };
}

function overallErrorCode(
  courses:GradescopeSyncResultV1["courses"],
  batchErrorCode:GradescopeSyncErrorCode|null|undefined,
):GradescopeSyncErrorCode|null{
  const failed=courses.filter(course=>Boolean(course.errorCode));
  const successful=courses.length-failed.length;
  if(failed.length===0)return null;
  if(successful>0)return "PARTIAL_SYNC";
  return batchErrorCode
    ?? courses.find(course=>course.errorCode)?.errorCode
    ?? "INVALID_RESULT";
}

function recordInvalid(
  db:Database.Database,
  registered:RegisteredGradescopeRequest,
  now:Date,
):never{
  new SubmissionStatusRepository(db).applyCompletion(
    connectionId,
    [],
    registered.courseIds.length,
    "INVALID_RESULT",
    now.toISOString(),
    0,
  );
  throw new GradescopeSyncServiceError("INVALID_RESULT","The extension returned an unexpected Gradescope result.");
}

export function completeGradescopeSync(
  db:Database.Database,
  input:GradescopeSyncCompleteInput,
  now:Date=new Date(),
):GradescopeSyncCompleteResponse{
  const registered=consumeGradescopeRequest(input.requestId,now.getTime());
  if(!registered||registered.kind!=="sync"||!registered.connectionId){
    throw new GradescopeSyncServiceError("SYNC_REQUEST_NOT_FOUND","This Gradescope sync request is no longer active.");
  }
  const connectionId=registered.connectionId;

  if(input.batches.some(batch=>batch.requestId!==input.requestId)){
    return recordInvalid(db,registered,now);
  }

  if(input.batches.length===0){
    const errorCode=input.batchErrorCode??"INVALID_RESULT";
    const completedAt=now.toISOString();
    const statusRepo=new SubmissionStatusRepository(db);
    statusRepo.applyCompletion(
      connectionId,
      [],
      registered.courseIds.length,
      errorCode,
      completedAt,
      0,
    );
    const state=statusRepo.getSyncState<GradescopeSyncErrorCode>(connectionId);
    return {
      requestId:input.requestId,
      insertedCount:0,
      updatedCount:0,
      statusUpdatedCount:0,
      failedCourseCount:registered.courseIds.length,
      ignoredStale:0,
      lastAttemptedAt:state.lastAttemptedAt,
      lastSuccessfulAt:state.lastSuccessfulAt,
      lastErrorCode:state.lastErrorCode,
      failureDiagnostics:[],
      failureHttpStatuses:[],
    };
  }

  const courses=input.batches.flatMap(batch=>batch.courses);
  const requested=new Set(registered.courseIds);
  const seenCourses=new Set<string>();
  for(const course of courses){
    if(!requested.has(course.courseId)||seenCourses.has(course.courseId)){
      return recordInvalid(db,registered,now);
    }
    seenCourses.add(course.courseId);
    for(const assignment of course.assignments){
      if(assignment.courseId!==course.courseId)return recordInvalid(db,registered,now);
    }
  }
  if(seenCourses.size!==requested.size||registered.courseIds.some(courseId=>!seenCourses.has(courseId))){
    return recordInvalid(db,registered,now);
  }

  const successfulCourses=courses.filter(course=>!course.errorCode);
  const failedCourseCount=courses.length-successfulCourses.length;
  const errorCode=overallErrorCode(courses,input.batchErrorCode);
  const completedAt=now.toISOString();
  const assignmentRepo=new AssignmentRepository(db);
  const statusRepo=new SubmissionStatusRepository(db);
  const sourceCourses=new SourceCourseRepository(db).list(connectionId);
  const courseById=new Map(sourceCourses.map(course=>[course.externalCourseId,course]));
  const currentByExternalId=new Map(
    assignmentRepo.list({source:"gradescope"}).map(item=>[item.externalId,item]),
  );

  const normalized:NormalizedAssignment[]=[];
  const incoming:GradescopeAssignmentV1[]=[];
  const seenAssignments=new Set<string>();
  for(const courseResult of successfulCourses){
    const course=courseById.get(courseResult.courseId);
    if(!course)return recordInvalid(db,registered,now);
    for(const assignment of courseResult.assignments){
      if(seenAssignments.has(assignment.assignmentId))return recordInvalid(db,registered,now);
      seenAssignments.add(assignment.assignmentId);
      incoming.push(assignment);
      const existing=currentByExternalId.get(assignment.assignmentId);
      const isStale=Boolean(
        existing?.submissionStatus?.checkedAt
        && existing.submissionStatus.checkedAt>=assignment.checkedAt,
      );
      if(isStale)continue;
      normalized.push({
        source:"gradescope",
        externalId:assignment.assignmentId,
        courseId:assignment.courseId,
        courseName:course.shortName??course.fullName,
        title:assignment.title,
        releaseAt:assignment.releaseAt,
        dueAt:assignment.dueAt,
        lateDueAt:assignment.lateDueAt,
        status:legacyStatus(assignment.state),
        sourceStatusText:assignment.sourceStatusText,
        gradeScore:assignment.gradeScore,
        gradeMax:assignment.gradeMax,
        gradeDisplay:assignment.gradeDisplay,
        sourceUrl:`https://www.gradescope.com/courses/${assignment.courseId}/assignments/${assignment.assignmentId}`,
        sourceUpdatedAt:null,
      });
    }
  }

  let insertedCount=0;
  let updatedCount=0;
  let statusUpdatedCount=0;
  let ignoredStale=0;

  db.transaction(()=>{
    const upserted=assignmentRepo.upsertMany(connectionId,normalized,completedAt);
    insertedCount=upserted.inserted;
    updatedCount=upserted.updated;

    const afterByExternalId=new Map(
      assignmentRepo.list({source:"gradescope"}).map(item=>[item.externalId,item]),
    );
    const writes:SubmissionStatusWrite[]=incoming.map(assignment=>{
      const local=afterByExternalId.get(assignment.assignmentId);
      if(!local)return recordInvalid(db,registered,now);
      return {
        assignmentLocalId:local.id,
        state:assignment.state,
        isLate:assignment.isLate,
        isMissing:assignment.isMissing,
        submittedAt:assignment.submittedAt,
        checkedAt:assignment.checkedAt,
        extractorVersion:assignment.extractorVersion,
      };
    });

    const applied=statusRepo.applyCompletion(
      connectionId,
      writes,
      failedCourseCount,
      errorCode,
      completedAt,
      successfulCourses.length,
    );
    statusUpdatedCount=applied.updated;
    ignoredStale=applied.ignoredStale;
  })();

  const state=statusRepo.getSyncState(registered.connectionId);
  const diagnostics=aggregateDiagnostics(courses);
  return {
    requestId:input.requestId,
    insertedCount,
    updatedCount,
    statusUpdatedCount,
    failedCourseCount,
    ignoredStale,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
    ...diagnostics,
  };
}
