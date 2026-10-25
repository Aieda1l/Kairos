import "server-only";
import {normalizeSourceAssignment} from "@/lib/assignments/normalize";
import {BoundedBodyError,readBoundedUtf8} from "@/lib/http/bounded-body";
import {EdSourceError} from "@/lib/sources/ed/errors";
import {parseEdCourses,parseEdLessons} from "@/lib/sources/ed/parser";
import {fetchEdResponse,type EdResource} from "@/lib/sources/ed/transport";
import {GUEST_MAX_UPSTREAM_BYTES,GUEST_ED_MAX_COURSES,GUEST_ED_COURSES_MAX_OUTPUT_BYTES,GUEST_ED_MAX_RAW_LESSONS,GUEST_ED_MAX_VISIBLE_LESSONS,GUEST_ED_LESSONS_MAX_OUTPUT_BYTES,guestJsonBytes} from "../limits";
import {guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,type GuestEdCoursesRequest,type GuestEdCoursesResponse,type GuestEdLessonsRequest,type GuestEdLessonsResponse} from "./contracts";
import {type GuestSourceContext,type GuestSourceScope,withGuestSourceDeadline} from "./deadline";
import {GuestSourceError} from "./errors";

function record(value:unknown):Record<string,unknown>|null{
  return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function safeNumericId(value:unknown){
  if(typeof value==="number"&&!Number.isSafeInteger(value))throw new GuestSourceError("ED_PARSE_ERROR");
}
async function readPayload(token:string,resource:EdResource,scope:GuestSourceScope):Promise<unknown>{
  const response=await fetchEdResponse(token,resource,scope.fetchImpl,scope.signal);
  if(!response.ok){try{void response.body?.cancel().catch(()=>{});}catch{/* Best effort only. */}}
  if(response.status===401||response.status===403)throw new GuestSourceError("ED_AUTH_INVALID");
  if(response.status===429)throw new GuestSourceError("ED_RATE_LIMITED");
  if(response.status===404&&resource.kind==="lessons")throw new GuestSourceError("ED_COURSE_UNAVAILABLE");
  if(!response.ok)throw new GuestSourceError("ED_UPSTREAM_ERROR");
  const text=await readBoundedUtf8(response.body,{maxBytes:GUEST_MAX_UPSTREAM_BYTES,signal:scope.signal});
  scope.check();
  let payload:unknown;
  try{payload=JSON.parse(text);}catch{throw new GuestSourceError("ED_PARSE_ERROR");}
  scope.check();return payload;
}
function mapFailure(error:unknown):never{
  if(error instanceof GuestSourceError)throw error;
  if(error instanceof EdSourceError)throw new GuestSourceError(error.code);
  if(error instanceof BoundedBodyError){
    if(error.code==="BODY_TOO_LARGE")throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
    if(error.code==="INVALID_JSON"||error.code==="INVALID_UTF8")throw new GuestSourceError("ED_PARSE_ERROR");
  }
  throw new GuestSourceError("ED_NETWORK_ERROR");
}

export async function readGuestEdCourses(input:GuestEdCoursesRequest,context:GuestSourceContext):Promise<GuestEdCoursesResponse>{
  return withGuestSourceDeadline(context,"ED_NETWORK_ERROR",async scope=>{
    try{
      if(!guestEdCoursesRequestSchema.safeParse(input).success||input.requestId!==context.requestId)throw new GuestSourceError("BAD_REQUEST");
      const payload=await readPayload(input.token,{kind:"user"},scope);
      const entries=record(payload)?.courses;
      if(Array.isArray(entries)){
        if(entries.length>GUEST_ED_MAX_COURSES)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
        for(const entry of entries)safeNumericId(record(record(entry)?.course)?.id);
      }
      scope.check();
      const courses=parseEdCourses(payload);
      scope.check();
      const result={ok:true as const,schemaVersion:1 as const,requestId:context.requestId,checkedAt:context.checkedAt,courses};
      if(guestJsonBytes(result)>GUEST_ED_COURSES_MAX_OUTPUT_BYTES)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      const validated=guestEdCoursesResponseSchema.safeParse(result);
      scope.check();
      if(!validated.success)throw new GuestSourceError("ED_PARSE_ERROR");
      await scope.assertProviderCurrent();
      return validated.data;
    }catch(error){scope.check();return mapFailure(error);}
  });
}

export async function readGuestEdLessons(input:GuestEdLessonsRequest,context:GuestSourceContext):Promise<GuestEdLessonsResponse>{
  return withGuestSourceDeadline(context,"ED_NETWORK_ERROR",async scope=>{
    try{
      if(!guestEdLessonsRequestSchema.safeParse(input).success||input.requestId!==context.requestId)throw new GuestSourceError("BAD_REQUEST");
      const payload=await readPayload(input.token,{kind:"lessons",courseId:input.courseId},scope);
      const entries=record(payload)?.lessons;
      if(Array.isArray(entries)){
        if(entries.length>GUEST_ED_MAX_RAW_LESSONS)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
        for(const entry of entries){const lesson=record(entry);for(const key of ["id","course_id","module_id"])safeNumericId(lesson?.[key]);}
      }
      scope.check();
      const parsed=parseEdLessons(payload,{id:"",sourceConnectionId:"",externalCourseId:input.courseId,shortName:null,fullName:"Ed",term:null,year:null,enabled:true,firstSeenAt:context.checkedAt,lastSeenAt:context.checkedAt});
      scope.check();
      if(parsed.length>GUEST_ED_MAX_VISIBLE_LESSONS)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      const lessons=parsed.map(row=>{
        const {courseName,...normalized}=normalizeSourceAssignment("ed",row);
        void courseName;
        return {...normalized,source:"ed" as const,courseId:input.courseId,sourceUrl:null};
      });
      const result={ok:true as const,schemaVersion:1 as const,requestId:context.requestId,checkedAt:context.checkedAt,courseId:input.courseId,lessons};
      if(guestJsonBytes(result)>GUEST_ED_LESSONS_MAX_OUTPUT_BYTES)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      const validated=guestEdLessonsResponseSchema.safeParse(result);
      scope.check();
      if(!validated.success)throw new GuestSourceError("ED_PARSE_ERROR");
      await scope.assertProviderCurrent();
      return validated.data;
    }catch(error){scope.check();return mapFailure(error);}
  });
}
