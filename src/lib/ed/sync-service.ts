import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1SubmissionStatusRepository} from "@/lib/db/d1/repositories/submission-status";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import type { SubmissionStatusWrite } from "@/lib/submission-status/types";
import { normalizeSourceAssignment } from "@/lib/assignments/normalize";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import type { EdErrorCode } from "@/lib/sources/ed/errors";
import { EdSourceError } from "@/lib/sources/ed/errors";
import { EdSource } from "@/lib/sources/ed/source";

export type EdSyncErrorCode =
  | EdErrorCode
  | "PARTIAL_SYNC"
  | "ED_NOT_CONNECTED"
  | "ED_NO_COURSES_ENABLED";

export type EdSyncResult={
  insertedCount:number;
  updatedCount:number;
  statusUpdatedCount:number;
  failedCourseCount:number;
  lastAttemptedAt:string|null;
  lastSuccessfulAt:string|null;
  lastErrorCode:EdSyncErrorCode|null;
};

export class EdSyncServiceError extends Error{
  constructor(
    public readonly code:"ED_NOT_CONNECTED"|"ED_NO_COURSES_ENABLED",
    message:string,
  ){
    super(message);
    this.name="EdSyncServiceError";
  }
}

type SyncOptions={
  fetchImpl?:typeof fetch;
  now?:Date;
};

function isUserScope(value:unknown):value is UserScope{
  return typeof value==="object"
    && value!==null
    && "userId" in value
    && typeof (value as {userId?:unknown}).userId==="string";
}

async function syncHostedEdConnection(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  options:SyncOptions={},
):Promise<EdSyncResult>{
  const fetchImpl=options.fetchImpl??fetch;
  const now=options.now??new Date();
  const completedAt=now.toISOString();
  const connectionRepo=new D1SourceConnectionRepository(db,scope);
  const connection=await connectionRepo.getByKind("ed");
  if(!connection){
    throw new EdSyncServiceError("ED_NOT_CONNECTED","Connect Ed before syncing.");
  }

  const token=await new D1SourceCredentialRepository(db,scope,keyring)
    .getEdApiToken(connection.id);
  if(!token){
    throw new EdSyncServiceError("ED_NOT_CONNECTED","Connect Ed before syncing.");
  }

  const courses=await new D1SourceCourseRepository(db,scope).listEnabled(connection.id);
  if(courses.length===0){
    throw new EdSyncServiceError(
      "ED_NO_COURSES_ENABLED",
      "Enable at least one Ed course before syncing.",
    );
  }

  const statusRepo=new D1SubmissionStatusRepository(db,scope);
  await connectionRepo.markSyncStarted(connection.id,completedAt);
  await statusRepo.markAttempt(connection.id,completedAt);

  const successful:Array<{courseId:string;assignments:Awaited<ReturnType<EdSource["sync"]>>}>=[];
  const failures:EdErrorCode[]=[];
  for(const course of courses){
    try{
      const assignments=await new EdSource(token,course,fetchImpl).sync();
      successful.push({courseId:course.externalCourseId,assignments});
    }catch(error){
      failures.push(error instanceof EdSourceError?error.code:"ED_UPSTREAM_ERROR");
    }
  }

  const failedCourseCount=failures.length;
  const lastErrorCode:EdSyncErrorCode|null=
    failedCourseCount===0
      ?null
      :successful.length>0
        ?"PARTIAL_SYNC"
        :(failures[0]??"ED_UPSTREAM_ERROR");

  const assignmentRepo=new D1AssignmentRepository(db,scope);
  const normalized=successful.flatMap(result=>
    result.assignments.map(assignment=>normalizeSourceAssignment("ed",assignment)),
  );
  const upserted=await assignmentRepo.upsertMany(connection.id,normalized,completedAt);

  const localByExternalId=new Map(
    (await assignmentRepo.list({source:"ed"}))
      .map(assignment=>[assignment.externalId,assignment]),
  );
  const writes:SubmissionStatusWrite[]=successful.flatMap(result=>
    result.assignments.flatMap(assignment=>{
      const local=localByExternalId.get(assignment.externalId);
      if(!local)return [];
      return [{
        assignmentLocalId:local.id,
        state:assignment.status==="submitted"?"submitted":"unknown",
        isLate:false,
        isMissing:false,
        submittedAt:null,
        checkedAt:completedAt,
        extractorVersion:"ed-api-v1",
      }];
    }),
  );

  const applied=await statusRepo.applyCompletion(
    connection.id,
    writes,
    failedCourseCount,
    lastErrorCode,
    completedAt,
    successful.length,
  );

  if(successful.length>0){
    await connectionRepo.markSyncSuccess(connection.id,completedAt,lastErrorCode);
  }else{
    await connectionRepo.markSyncError(
      connection.id,
      completedAt,
      lastErrorCode??"ED_UPSTREAM_ERROR",
    );
  }

  const state=await statusRepo.getSyncState<EdSyncErrorCode>(connection.id);
  return {
    insertedCount:upserted.inserted,
    updatedCount:upserted.updated,
    statusUpdatedCount:applied.updated,
    failedCourseCount,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
  };
}

async function syncLegacyEdConnection(
  db:LegacyDatabase,
  options:SyncOptions={},
):Promise<EdSyncResult>{
},
):Promise<EdSyncResult>{
  const fetchImpl=options.fetchImpl??fetch;
  const now=options.now??new Date();
  const completedAt=now.toISOString();
  const connectionRepo=new SourceConnectionRepository(db);
  const connection=connectionRepo.getByKind("ed");
  if(!connection){
    throw new EdSyncServiceError("ED_NOT_CONNECTED","Connect Ed before syncing.");
  }
  const token=new SourceCredentialRepository(db).getEdApiToken(connection.id);
  if(!token){
    throw new EdSyncServiceError("ED_NOT_CONNECTED","Connect Ed before syncing.");
  }

  const courses=new SourceCourseRepository(db).listEnabled(connection.id);
  if(courses.length===0){
    throw new EdSyncServiceError("ED_NO_COURSES_ENABLED","Enable at least one Ed course before syncing.");
  }

  const statusRepo=new SubmissionStatusRepository(db);
  connectionRepo.markSyncStarted(connection.id,completedAt);
  statusRepo.markAttempt(connection.id,completedAt);

  const successful:Array<{courseId:string;assignments:Awaited<ReturnType<EdSource["sync"]>>}>=[];
  const failures:EdErrorCode[]=[];
  for(const course of courses){
    try{
      const assignments=await new EdSource(token,course,fetchImpl).sync();
      successful.push({courseId:course.externalCourseId,assignments});
    }catch(error){
      failures.push(error instanceof EdSourceError?error.code:"ED_UPSTREAM_ERROR");
    }
  }

  const failedCourseCount=failures.length;
  const lastErrorCode:EdSyncErrorCode|null=
    failedCourseCount===0
      ?null
      :successful.length>0
        ?"PARTIAL_SYNC"
        :(failures[0]??"ED_UPSTREAM_ERROR");

  const assignmentRepo=new AssignmentRepository(db);
  const normalized=successful.flatMap(result=>
    result.assignments.map(assignment=>normalizeSourceAssignment("ed",assignment)),
  );

  let insertedCount=0;
  let updatedCount=0;
  let statusUpdatedCount=0;

  db.transaction(()=>{
    const upserted=assignmentRepo.upsertMany(connection.id,normalized,completedAt);
    insertedCount=upserted.inserted;
    updatedCount=upserted.updated;

    const localByExternalId=new Map(
      assignmentRepo.list({source:"ed"}).map(assignment=>[assignment.externalId,assignment]),
    );
    const writes:SubmissionStatusWrite[]=successful.flatMap(result=>
      result.assignments.flatMap(assignment=>{
        const local=localByExternalId.get(assignment.externalId);
        if(!local)return [];
        return [{
          assignmentLocalId:local.id,
          state:assignment.status==="submitted"?"submitted":"unknown",
          isLate:false,
          isMissing:false,
          submittedAt:null,
          checkedAt:completedAt,
          extractorVersion:"ed-api-v1",
        }];
      }),
    );

    const applied=statusRepo.applyCompletion(
      connection.id,
      writes,
      failedCourseCount,
      lastErrorCode,
      completedAt,
      successful.length,
    );
    statusUpdatedCount=applied.updated;

    if(successful.length>0){
      connectionRepo.markSyncSuccess(connection.id,completedAt,lastErrorCode);
    }else{
      connectionRepo.markSyncError(connection.id,completedAt,lastErrorCode??"ED_UPSTREAM_ERROR");
    }
  })();

  const state=statusRepo.getSyncState<EdSyncErrorCode>(connection.id);
  return {
    insertedCount,
    updatedCount,
    statusUpdatedCount,
    failedCourseCount,
    lastAttemptedAt:state.lastAttemptedAt,
    lastSuccessfulAt:state.lastSuccessfulAt,
    lastErrorCode:state.lastErrorCode,
  };

}

export function syncEdConnection(
  db:LegacyDatabase,
  options?:SyncOptions,
):Promise<EdSyncResult>;
export function syncEdConnection(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  options?:SyncOptions,
):Promise<EdSyncResult>;
export function syncEdConnection(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:SyncOptions|UserScope={},
  arg3?:CredentialKeyring,
  arg4?:SyncOptions,
):Promise<EdSyncResult>{
  if(isUserScope(arg2)){
    return syncHostedEdConnection(
      db as D1DatabaseLike,
      arg2,
      arg3!,
      arg4,
    );
  }
  return syncLegacyEdConnection(db as LegacyDatabase,arg2);
}
