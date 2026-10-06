import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1SyncRequestRepository} from "@/lib/db/d1/repositories/sync-requests";
import type {
  GradescopeDiscoverResultV1,
  GradescopeSyncErrorCode,
} from "@/lib/extension-protocol/gradescope";

const REQUEST_TTL_MS=10*60*1000;

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

export async function startGradescopeDiscovery(
  db:D1DatabaseLike,
  scope:UserScope,
  now:Date=new Date(),
):Promise<{requestId:string;protocolVersion:1}>{
  const requestId=crypto.randomUUID();
  const createdAt=now.toISOString();
  await new D1SyncRequestRepository(db,scope).register({
    requestId,
    kind:"gradescope_discovery",
    payload:{},
    createdAt,
    expiresAt:new Date(now.getTime()+REQUEST_TTL_MS).toISOString(),
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

export async function completeGradescopeDiscovery(
  db:D1DatabaseLike,
  scope:UserScope,
  input:GradescopeDiscoverResultV1,
  now:Date=new Date(),
){
  const registered=await new D1SyncRequestRepository(db,scope)
    .consume(input.requestId,"gradescope_discovery",now);
  if(!registered){
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
  const connectionRepo=new D1SourceConnectionRepository(db,scope);
  const connection=await connectionRepo.upsertGradescope("Gradescope");
  const courseRepo=new D1SourceCourseRepository(db,scope);
  await courseRepo.upsertDiscovered(
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
  return {connection,courses:await courseRepo.list(connection.id)};
}

export async function replaceEnabledGradescopeCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  enabledCourseIds:string[],
){
  const connection=await new D1SourceConnectionRepository(db,scope)
    .getByKind("gradescope");
  if(!connection){
    throw new GradescopeDiscoveryServiceError(
      "GRADESCOPE_NOT_CONFIGURED",
      "Discover Gradescope courses before selecting them.",
    );
  }

  const courseRepo=new D1SourceCourseRepository(db,scope);
  const discovered=await courseRepo.list(connection.id);
  const known=new Set(discovered.map(course=>course.externalCourseId));
  if(enabledCourseIds.some(courseId=>!known.has(courseId))){
    throw new GradescopeDiscoveryServiceError(
      "INVALID_COURSE_SELECTION",
      "Select only courses discovered from your Gradescope account.",
    );
  }

  await courseRepo.setEnabled(connection.id,enabledCourseIds);
  return {connection,courses:await courseRepo.list(connection.id)};
}
