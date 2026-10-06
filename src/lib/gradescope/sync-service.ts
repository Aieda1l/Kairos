import "server-only";
import crypto from "node:crypto";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1SubmissionStatusRepository} from "@/lib/db/d1/repositories/submission-status";
import {D1SyncRequestRepository} from "@/lib/db/d1/repositories/sync-requests";
import { z } from "zod";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import {
  gradescopeSyncErrorCodeSchema,
  gradescopeSyncResultV1Schema,
  type GradescopeAssignmentStructureDiagnosticsV1,
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
  failureErrorCodes:Array<{code:GradescopeSyncErrorCode;count:number}>;
  failureStructures:Array<{
    errorCode:GradescopeSyncErrorCode;
    diagnostics:GradescopeAssignmentStructureDiagnosticsV1;
  }>;
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
  db:LegacyDatabase,
  now?:Date,
):GradescopeSyncStartResponse;
export function startGradescopeSync(
  db:D1DatabaseLike,
  scope:UserScope,
  now?:Date,
):Promise<GradescopeSyncStartResponse>;
export function startGradescopeSync(
  db:LegacyDatabase|D1DatabaseLike,
  arg2?:Date|UserScope,
  arg3?:Date,
):GradescopeSyncStartResponse|Promise<GradescopeSyncStartResponse>{
  if(arg2 instanceof Date||arg2===undefined){
    const legacyDb=db as LegacyDatabase;
    const now=arg2??new Date();
    const connection=new SourceConnectionRepository(legacyDb).getByKind("gradescope");
    if(!connection){
      throw new GradescopeSyncServiceError(
        "GRADESCOPE_NOT_CONFIGURED",
        "Discover Gradescope courses before syncing.",
      );
    }
    const enabled=new SourceCourseRepository(legacyDb).listEnabled(connection.id);
    if(enabled.length===0){
      throw new GradescopeSyncServiceError(
        "GRADESCOPE_NO_COURSES_ENABLED",
        "Enable at least one Gradescope course before syncing.",
      );
    }

    const requestId=crypto.randomUUID();
    const startedAt=now.toISOString();
    const courseIds=enabled.map(course=>course.externalCourseId);
    new SubmissionStatusRepository(legacyDb).markAttempt(connection.id,startedAt);
    registerGradescopeRequest({
      requestId,
      kind:"sync",
      connectionId:connection.id,
      courseIds,
      startedAt,
    });
    return {protocolVersion:1,requestId,courseIds,maxCourseBatchSize:20};
  }

  return (async()=>{
    const hostedDb=db as D1DatabaseLike;
    const scope=arg2;
    const now=arg3??new Date();
    const connection=await new D1SourceConnectionRepository(hostedDb,scope)
      .getByKind("gradescope");
    if(!connection){
      throw new GradescopeSyncServiceError(
        "GRADESCOPE_NOT_CONFIGURED",
        "Discover Gradescope courses before syncing.",
      );
    }
    const enabled=await new D1SourceCourseRepository(hostedDb,scope)
      .listEnabled(connection.id);
    if(enabled.length===0){
      throw new GradescopeSyncServiceError(
        "GRADESCOPE_NO_COURSES_ENABLED",
        "Enable at least one Gradescope course before syncing.",
      );
    }

    const requestId=crypto.randomUUID();
    const startedAt=now.toISOString();
    const courseIds=enabled.map(course=>course.externalCourseId);
    await new D1SubmissionStatusRepository(hostedDb,scope)
      .markAttempt(connection.id,startedAt);
    await new D1SyncRequestRepository(hostedDb,scope).register({
      requestId,
      kind:"gradescope_sync",
      payload:{connectionId:connection.id,courseIds},
      createdAt:startedAt,
      expiresAt:new Date(now.getTime()+10*60*1000).toISOString(),
    });
    return {protocolVersion:1 as const,requestId,courseIds,maxCourseBatchSize:20 as const};
  })();
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
  const errorCounts=new Map<GradescopeSyncErrorCode,number>();
  const failureStructures:GradescopeSyncCompleteResponse["failureStructures"]=[];
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
    if(course.errorCode){
      errorCounts.set(course.errorCode,(errorCounts.get(course.errorCode)??0)+1);
      if(course.assignmentDiagnostics){
        failureStructures.push({
          errorCode:course.errorCode,
          diagnostics:course.assignmentDiagnostics,
        });
      }
    }
  }
  return {
    failureDiagnostics:Array.from(diagnosticCounts.entries())
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count})),
    failureHttpStatuses:Array.from(httpCounts.entries())
      .sort(([a],[b])=>a-b)
      .map(([status,count])=>({status,count})),
    failureErrorCodes:Array.from(errorCounts.entries())
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count})),
    failureStructures,
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
  db:LegacyDatabase,
  registered:RegisteredGradescopeRequest,
  now:Date,
):never{
  if(!registered.connectionId){
    throw new GradescopeSyncServiceError("INVALID_RESULT","The Gradescope sync request had no connection identity.");
  }
  new SubmissionStatusRepository(db).applyCompletion(
    registered.connectionId,
    [],
    registered.courseIds.length,
    "INVALID_RESULT",
    now.toISOString(),
    0,
  );
  throw new GradescopeSyncServiceError("INVALID_RESULT","The extension returned an unexpected Gradescope result.");
}

type HostedGradescopeRequest={
  connectionId:string;
  courseIds:string[];
};

export function completeGradescopeSync(
  db:LegacyDatabase,
  input:GradescopeSyncCompleteInput,
  now?:Date,
):GradescopeSyncCompleteResponse;
export function completeGradescopeSync(
  db:D1DatabaseLike,
  scope:UserScope,
  input:GradescopeSyncCompleteInput,
  now?:Date,
):Promise<GradescopeSyncCompleteResponse>;
export function completeGradescopeSync(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:GradescopeSyncCompleteInput|UserScope,
  arg3?:Date|GradescopeSyncCompleteInput,
  arg4?:Date,
):GradescopeSyncCompleteResponse|Promise<GradescopeSyncCompleteResponse>{
  if("requestId" in arg2){
    return completeGradescopeSyncLegacy(
      db as LegacyDatabase,
      arg2,
      arg3 instanceof Date?arg3:new Date(),
    );
  }
  return completeGradescopeSyncHosted(
    db as D1DatabaseLike,
    arg2,
    arg3 as GradescopeSyncCompleteInput,
    arg4??new Date(),
  );
}

async function recordInvalidHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  registered:HostedGradescopeRequest,
  now:Date,
):Promise<never>{
  await new D1SubmissionStatusRepository(db,scope).applyCompletion(
    registered.connectionId,
    [],
    registered.courseIds.length,
    "INVALID_RESULT",
    now.toISOString(),
    0,
  );
  throw new GradescopeSyncServiceError(
    "INVALID_RESULT",
    "The extension returned an unexpected Gradescope result.",
  );
}

async function completeGradescopeSyncHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  input:GradescopeSyncCompleteInput,
  now:Date,
):Promise<GradescopeSyncCompleteResponse>{
  const request=await new D1SyncRequestRepository(db,scope)
    .consume<HostedGradescopeRequest>(input.requestId,"gradescope_sync",now);
  if(!request){
    throw new GradescopeSyncServiceError(
      "SYNC_REQUEST_NOT_FOUND",
      "This Gradescope sync request is no longer active.",
    );
  }
  const registered=request.payload;
  const connectionId=registered.connectionId;

  if(input.batches.some(batch=>batch.requestId!==input.requestId)){
    return recordInvalidHosted(db,scope,registered,now);
  }

  const statusRepo=new D1SubmissionStatusRepository(db,scope);
  if(input.batches.length===0){
    const errorCode=input.batchErrorCode??"INVALID_RESULT";
    const completedAt=now.toISOString();
    await statusRepo.applyCompletion(
      connectionId,[],registered.courseIds.length,errorCode,completedAt,0,
    );
    const state=await statusRepo.getSyncState<GradescopeSyncErrorCode>(connectionId);
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
      failureErrorCodes:[{code:errorCode,count:registered.courseIds.length}],
      failureStructures:[],
    };
  }

  const courses=input.batches.flatMap(batch=>batch.courses);
  const requested=new Set(registered.courseIds);
  const seenCourses=new Set<string>();
  for(const course of courses){
    if(!requested.has(course.courseId)||seenCourses.has(course.courseId)){
      return recordInvalidHosted(db,scope,registered,now);
    }
    seenCourses.add(course.courseId);
    for(const assignment of course.assignments){
      if(assignment.courseId!==course.courseId){
        return recordInvalidHosted(db,scope,registered,now);
      }
    }
  }
  if(
    seenCourses.size!==requested.size
    ||registered.courseIds.some(courseId=>!seenCourses.has(courseId))
  ){
    return recordInvalidHosted(db,scope,registered,now);
  }

  const successfulCourses=courses.filter(course=>!course.errorCode);
  const failedCourseCount=courses.length-successfulCourses.length;
  const errorCode=overallErrorCode(courses,input.batchErrorCode);
  const completedAt=now.toISOString();
  const assignmentRepo=new D1AssignmentRepository(db,scope);
  const courseRepo=new D1SourceCourseRepository(db,scope);
  const sourceCourses=await courseRepo.list(connectionId);
  const courseById=new Map(sourceCourses.map(course=>[course.externalCourseId,course]));
  const currentByExternalId=new Map(
    (await assignmentRepo.list({source:"gradescope"}))
      .map(item=>[item.externalId,item]),
  );

  const normalized:NormalizedAssignment[]=[];
  const incoming:GradescopeAssignmentV1[]=[];
  const seenAssignments=new Set<string>();
  for(const courseResult of successfulCourses){
    const course=courseById.get(courseResult.courseId);
    if(!course)return recordInvalidHosted(db,scope,registered,now);
    for(const assignment of courseResult.assignments){
      if(seenAssignments.has(assignment.assignmentId)){
        return recordInvalidHosted(db,scope,registered,now);
      }
      seenAssignments.add(assignment.assignmentId);
      incoming.push(assignment);
      const existing=currentByExternalId.get(assignment.assignmentId);
      const isStale=Boolean(
        existing?.submissionStatus?.checkedAt
        &&existing.submissionStatus.checkedAt>=assignment.checkedAt,
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

  const upserted=await assignmentRepo.upsertMany(connectionId,normalized,completedAt);
  const afterByExternalId=new Map(
    (await assignmentRepo.list({source:"gradescope"}))
      .map(item=>[item.externalId,item]),
  );
  const writes:SubmissionStatusWrite[]=[];
  for(const assignment of incoming){
    const local=afterByExternalId.get(assignment.assignmentId);
    if(!local)return recordInvalidHosted(db,scope,registered,now);
    writes.push({
      assignmentLocalId:local.id,
      state:assignment.state,
      isLate:assignment.isLate,
      isMissing:assignment.isMissing,
      submittedAt:assignment.submittedAt,
      checkedAt:assignment.checkedAt,
      extractorVersion:assignment.extractorVersion,
    });
  }

  const applied=await statusRepo.applyCompletion(
    connectionId,
    writes,
    failedCourseCount,
    errorCode,
    completedAt,
    successfulCourses.length,
  );
  const state=await statusRepo.getSyncState<GradescopeSyncErrorCode>(connectionId);
  return {
    requestId:input.requestId,
    insertedCount:upserted.inserted,
    updatedCount:upserted.updated,
    statusUpdatedCount:applied.updated,
    failedCourseCount,
    ignoredStale:applied.ignoredStale,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
    ...aggregateDiagnostics(courses),
  };
}

function completeGradescopeSyncLegacy(
  db:LegacyDatabase,
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
      failureErrorCodes:[{code:errorCode,count:registered.courseIds.length}],
      failureStructures:[],
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

  const state=statusRepo.getSyncState<GradescopeSyncErrorCode>(connectionId);
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
