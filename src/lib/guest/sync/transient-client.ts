import {z} from "zod";
import {
  guestApiErrorSchema,guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,
  guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,guestSessionEndRequestSchema,guestSessionRequestSchema,guestSessionResponseSchema,
  type GuestCanvasFeedRequest,type GuestCanvasFeedResponse,type GuestEdCoursesRequest,type GuestEdCoursesResponse,
  type GuestEdLessonsRequest,type GuestEdLessonsResponse,type GuestSessionRequest,type GuestSessionResponse,
} from "../sources/contracts";
import {GuestDataError} from "../errors";

export interface GuestTransientClient {
  bootstrap(input:GuestSessionRequest,signal:AbortSignal):Promise<GuestSessionResponse>;
  endSession(signal:AbortSignal):Promise<{ok:true}>;
  canvasFeed(input:GuestCanvasFeedRequest,signal:AbortSignal):Promise<GuestCanvasFeedResponse>;
  edCourses(input:GuestEdCoursesRequest,signal:AbortSignal):Promise<GuestEdCoursesResponse>;
  edLessons(input:GuestEdLessonsRequest,signal:AbortSignal):Promise<GuestEdLessonsResponse>;
}
const endResponseSchema=z.object({ok:z.literal(true)}).strict();

/** Capability cookies remain HttpOnly; all secrets travel only in these fixed-path JSON bodies. */
export function createGuestTransientClient({fetchImpl=fetch}:{fetchImpl?:typeof fetch}={}):GuestTransientClient {
  async function post<I,O>(path:string,input:I,requestSchema:z.ZodType<I>,responseSchema:z.ZodType<O>,signal:AbortSignal):Promise<O> {
    const body=requestSchema.safeParse(input);
    if(!body.success)throw new GuestDataError("BAD_REQUEST");
    if(signal.aborted)throw new GuestDataError("GUEST_INTERRUPTED");
    let response:Response;
    try{
      response=await fetchImpl(path,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body.data),signal});
    }catch{
      throw new GuestDataError(signal.aborted?"GUEST_INTERRUPTED":"SERVICE_UNAVAILABLE");
    }
    if(signal.aborted)throw new GuestDataError("GUEST_INTERRUPTED");
    if(response.redirected || response.status>=300 && response.status<400)throw new GuestDataError("INVALID_RESULT");
    let value:unknown;
    try{value=await response.json();}
    catch{throw new GuestDataError(signal.aborted?"GUEST_INTERRUPTED":"INVALID_RESULT");}
    if(signal.aborted)throw new GuestDataError("GUEST_INTERRUPTED");
    const error=guestApiErrorSchema.safeParse(value);
    if(!response.ok){
      if(error.success)throw new GuestDataError(error.data.code);
      throw new GuestDataError("INVALID_RESULT");
    }
    const parsed=responseSchema.safeParse(value);
    if(!parsed.success)throw new GuestDataError("INVALID_RESULT");
    return parsed.data;
  }
  async function read<I extends {requestId:string},O extends {requestId:string}>(path:string,input:I,requestSchema:z.ZodType<I>,responseSchema:z.ZodType<O>,signal:AbortSignal):Promise<O> {
    const requestId=input.requestId;
    const result=await post(path,input,requestSchema,responseSchema,signal);
    if(result.requestId!==requestId)throw new GuestDataError("INVALID_RESULT");
    return result;
  }
  return {
    bootstrap:(input,signal)=>read("/api/guest/session",input,guestSessionRequestSchema,guestSessionResponseSchema,signal),
    endSession:(signal)=>post("/api/guest/session/end",{},guestSessionEndRequestSchema,endResponseSchema,signal),
    canvasFeed:(input,signal)=>read("/api/guest/sources/canvas/feed",input,guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,signal),
    edCourses:(input,signal)=>read("/api/guest/sources/ed/courses",input,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,signal),
    async edLessons(input,signal){
      const courseId=input.courseId;
      const result=await read("/api/guest/sources/ed/lessons",input,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,signal);
      if(result.courseId!==courseId)throw new GuestDataError("INVALID_RESULT");
      return result;
    },
  };
}
