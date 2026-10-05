import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  GradescopeDiscoverResultV1,
  GradescopeSyncErrorCode,
} from "@/lib/extension-protocol/gradescope";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import {
  consumeGradescopeRequest,
  registerGradescopeRequest,
} from "./request-registry";

export class GradescopeDiscoveryServiceError extends Error{
  constructor(
    public readonly code:
      |"SYNC_REQUEST_NOT_FOUND"
      |"INVALID_RESULT"
      |"GRADESCOPE_DISCOVERY_FAILED"
      |"GRADESCOPE_NOT_CONFIGURED"
      |"INVALID_COURSE_SELECTION",
    message:string,
    public readonly sourceCode:GradescopeSyncErrorCode|null=null,
  ){
    super(message);
    this.name="GradescopeDiscoveryServiceError";
  }
}

export function startGradescopeDiscovery(
  _db:Database.Database,
  now:Date=new Date(),
):{requestId:string;protocolVersion:1}{
  const requestId=crypto.randomUUID();
  registerGradescopeRequest({
    requestId,
    kind:"discovery",
    connectionId:null,
    courseIds:[],
    startedAt:now.toISOString(),
  });
  return {requestId,protocolVersion:1};
}

function discoveryFailureMessage(code:GradescopeSyncErrorCode):string{
  switch(code){
    case "EXTENSION_UNAVAILABLE":return "Firefox extension not detected";
    case "EXTENSION_TIMEOUT":return "Firefox extension timed out.";
    case "GRADESCOPE_TAB_UNAVAILABLE":return "Open Gradescope in Firefox, then try again.";
    case "GRADESCOPE_SIGNED_OUT":return "Sign in to Gradescope, then retry.";
    case "GRADESCOPE_NETWORK_ERROR":return "Gradescope could not be reached. Try again.";
    case "GRADESCOPE_PARSE_ERROR":return "Gradescope course data could not be recognized. The connector may need an update.";
    case "GRADESCOPE_COURSE_UNAVAILABLE":return "A Gradescope course is unavailable.";
    case "PARTIAL_SYNC":return "Gradescope course discovery completed only partially.";
    case "INVALID_RESULT":return "Gradescope returned an invalid result.";
  }
}

export function completeGradescopeDiscovery(
  db:Database.Database,
  input:GradescopeDiscoverResultV1,
  now:Date=new Date(),
){
  const registered=consumeGradescopeRequest(input.requestId,now.getTime());
  if(!registered||registered.kind!=="discovery"){
    throw new GradescopeDiscoveryServiceError(
      "SYNC_REQUEST_NOT_FOUND",
      "This Gradescope discovery request is no longer active.",
    );
  }
  if(input.errorCode){
    throw new GradescopeDiscoveryServiceError(
      "GRADESCOPE_DISCOVERY_FAILED",
      discoveryFailureMessage(input.errorCode),
      input.errorCode,
    );
  }

  const seenAt=now.toISOString();
  const connectionRepo=new SourceConnectionRepository(db);
  const connection=connectionRepo.upsertGradescope("Gradescope");
  const courseRepo=new SourceCourseRepository(db);
  courseRepo.upsertDiscovered(
    connection.id,
    input.courses.map(course=>({
      externalCourseId:course.courseId,
      shortName:course.shortName,
      fullName:course.fullName,
      term:course.term,
      year:course.year,
    })),
    seenAt,
  );
  return {connection,courses:courseRepo.list(connection.id)};
}

export function replaceEnabledGradescopeCourses(
  db:Database.Database,
  enabledCourseIds:string[],
){
  const connection=new SourceConnectionRepository(db).getByKind("gradescope");
  if(!connection){
    throw new GradescopeDiscoveryServiceError(
      "GRADESCOPE_NOT_CONFIGURED",
      "Discover Gradescope courses before selecting them.",
    );
  }

  const courseRepo=new SourceCourseRepository(db);
  const discovered=courseRepo.list(connection.id);
  const known=new Set(discovered.map(course=>course.externalCourseId));
  if(enabledCourseIds.some(courseId=>!known.has(courseId))){
    throw new GradescopeDiscoveryServiceError(
      "INVALID_COURSE_SELECTION",
      "Select only courses discovered from your Gradescope account.",
    );
  }

  courseRepo.setEnabled(connection.id,enabledCourseIds);
  return {connection,courses:courseRepo.list(connection.id)};
}
