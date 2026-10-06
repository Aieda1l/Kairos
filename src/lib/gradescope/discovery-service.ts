import "server-only";
import type Database from "better-sqlite3";
import type {UserScope} from "@/lib/auth/user-scope";
import type {SourceConnection} from "@/lib/assignments/types";
import type {SourceCourse} from "@/lib/sources/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {D1SyncRequestRepository} from "@/lib/db/d1/repositories/sync-requests";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCourseRepository} from "@/lib/db/repositories/source-courses";
import type {
  GradescopeDiscoverResultV1,
  GradescopeSyncErrorCode,
} from "@/lib/extension-protocol/gradescope";
import {
  consumeGradescopeRequest,
  registerGradescopeRequest,
} from "./request-registry";

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

export function startGradescopeDiscovery(
  db:Database.Database,
  now?:Date,
):{requestId:string;protocolVersion:1};
export function startGradescopeDiscovery(
  db:D1DatabaseLike,
  scope:UserScope,
  now?:Date,
):Promise<{requestId:string;protocolVersion:1}>;
export function startGradescopeDiscovery(
  db:Database.Database|D1DatabaseLike,
  arg2?:Date|UserScope,
  arg3?:Date,
):{requestId:string;protocolVersion:1}|Promise<{requestId:string;protocolVersion:1}>{
  if(arg2 instanceof Date||arg2===undefined){
    const requestId=crypto.randomUUID();
    const now=arg2??new Date();
    registerGradescopeRequest({
      requestId,
      kind:"discovery",
      connectionId:null,
      courseIds:[],
      startedAt:now.toISOString(),
    });
    return {requestId,protocolVersion:1};
  }

  return (async()=>{
    const requestId=crypto.randomUUID();
    const now=arg3??new Date();
    await new D1SyncRequestRepository(db as D1DatabaseLike,arg2).register({
      requestId,
      kind:"gradescope_discovery",
      payload:{},
      createdAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+REQUEST_TTL_MS).toISOString(),
    });
    return {requestId,protocolVersion:1 as const};
  })();
}

export function completeGradescopeDiscovery(
  db:Database.Database,
  input:GradescopeDiscoverResultV1,
  now?:Date,
):{connection:ReturnType<SourceConnectionRepository["upsertGradescope"]>;courses:ReturnType<SourceCourseRepository["list"]>};
export function completeGradescopeDiscovery(
  db:D1DatabaseLike,
  scope:UserScope,
  input:GradescopeDiscoverResultV1,
  now?:Date,
):Promise<{connection:Awaited<ReturnType<D1SourceConnectionRepository["upsertGradescope"]>>;courses:Awaited<ReturnType<D1SourceCourseRepository["list"]>>}>;
export function completeGradescopeDiscovery(
  db:Database.Database|D1DatabaseLike,
  arg2:GradescopeDiscoverResultV1|UserScope,
  arg3?:Date|GradescopeDiscoverResultV1,
  arg4?:Date,
){
  if("requestId" in arg2){
    const legacyDb=db as Database.Database;
    const input=arg2;
    const now=arg3 instanceof Date?arg3:new Date();
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
    const connectionRepo=new SourceConnectionRepository(legacyDb);
    const connection=connectionRepo.upsertGradescope("Gradescope");
    const courseRepo=new SourceCourseRepository(legacyDb);
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

  return (async()=>{
    const hostedDb=db as D1DatabaseLike;
    const scope=arg2;
    const input=arg3 as GradescopeDiscoverResultV1;
    const now=arg4??new Date();
    const registered=await new D1SyncRequestRepository(hostedDb,scope)
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
    const connectionRepo=new D1SourceConnectionRepository(hostedDb,scope);
    const connection=await connectionRepo.upsertGradescope("Gradescope");
    const courseRepo=new D1SourceCourseRepository(hostedDb,scope);
    await courseRepo.upsertDiscovered(
      connection.id,
      input.courses.map(course=>({
        externalCourseId:course.courseId,
        shortName:course.shortName,
        fullName:course.fullName,
        term:course.term,
        year:course.year,
      })),
      now.toISOString(),
    );
    return {connection,courses:await courseRepo.list(connection.id)};
  })();
}

export function replaceEnabledGradescopeCourses(
  db:Database.Database,
  enabledCourseIds:string[],
):{connection:SourceConnection;courses:SourceCourse[]};
export function replaceEnabledGradescopeCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  enabledCourseIds:string[],
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export function replaceEnabledGradescopeCourses(
  db:Database.Database|D1DatabaseLike,
  arg2:string[]|UserScope,
  arg3?:string[],
):{connection:SourceConnection;courses:SourceCourse[]}|Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  if(Array.isArray(arg2)){
    const legacyDb=db as Database.Database;
    const connection=new SourceConnectionRepository(legacyDb).getByKind("gradescope");
    if(!connection){
      throw new GradescopeDiscoveryServiceError(
        "GRADESCOPE_NOT_CONFIGURED",
        "Discover Gradescope courses before selecting them.",
      );
    }
    const courseRepo=new SourceCourseRepository(legacyDb);
    const discovered=courseRepo.list(connection.id);
    const known=new Set(discovered.map(course=>course.externalCourseId));
    if(arg2.some(courseId=>!known.has(courseId))){
      throw new GradescopeDiscoveryServiceError(
        "INVALID_COURSE_SELECTION",
        "Select only courses discovered from your Gradescope account.",
      );
    }
    courseRepo.setEnabled(connection.id,arg2);
    return {connection,courses:courseRepo.list(connection.id)};
  }

  return (async()=>{
    const hostedDb=db as D1DatabaseLike;
    const connection=await new D1SourceConnectionRepository(hostedDb,arg2).getByKind("gradescope");
    if(!connection){
      throw new GradescopeDiscoveryServiceError(
        "GRADESCOPE_NOT_CONFIGURED",
        "Discover Gradescope courses before selecting them.",
      );
    }
    const courseRepo=new D1SourceCourseRepository(hostedDb,arg2);
    const discovered=await courseRepo.list(connection.id);
    const known=new Set(discovered.map(course=>course.externalCourseId));
    const enabledCourseIds=arg3??[];
    if(enabledCourseIds.some(courseId=>!known.has(courseId))){
      throw new GradescopeDiscoveryServiceError(
        "INVALID_COURSE_SELECTION",
        "Select only courses discovered from your Gradescope account.",
      );
    }
    await courseRepo.setEnabled(connection.id,enabledCourseIds);
    return {connection,courses:await courseRepo.list(connection.id)};
  })();
}
