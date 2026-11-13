import {z} from 'zod';
import {guestApiErrorSchema,guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,guestSessionEndRequestSchema,guestSessionRequestSchema,guestSessionResponseSchema,type GuestCanvasFeedRequest,type GuestCanvasFeedResponse,type GuestEdCoursesRequest,type GuestEdCoursesResponse,type GuestEdLessonsRequest,type GuestEdLessonsResponse,type GuestSessionRequest,type GuestSessionResponse} from '../sources/contracts';
import {GuestDataError} from '../errors';
import {GUEST_MAX_UPSTREAM_BYTES,GUEST_SOURCE_DEADLINE_MS} from '../limits';
import {readBoundedBytes,readBoundedJson,BoundedBodyError} from '@/lib/http/bounded-body';
import {GUEST_SOURCE_VERSION_HEADER,GUEST_READ_RECEIPT_HEADER,readGuestReadReceiptMetadata,guestSourceApprovalAckSchema,type GuestSourceOperation,type GuestSourceParseInput} from '../sources/wire';
import {parseGuestSourceInWorker} from './source-parser-worker';
export interface GuestTransientClient {
 bootstrap(input:GuestSessionRequest,signal:AbortSignal):Promise<GuestSessionResponse>;
 endSession(signal:AbortSignal):Promise<{ok:true}>;
 canvasFeed(input:GuestCanvasFeedRequest,signal:AbortSignal):Promise<GuestCanvasFeedResponse>;
 edCourses(input:GuestEdCoursesRequest,signal:AbortSignal):Promise<GuestEdCoursesResponse>;
 edLessons(input:GuestEdLessonsRequest,signal:AbortSignal):Promise<GuestEdLessonsResponse>;
}
const endResponseSchema=z.object({ok:z.literal(true)}).strict();
type Result=GuestCanvasFeedResponse|GuestEdCoursesResponse|GuestEdLessonsResponse;
type Parse=(input:GuestSourceParseInput,signal:AbortSignal,deadline:number)=>Promise<Result>;
export function createGuestTransientClient({fetchImpl=fetch,parseSource=parseGuestSourceInWorker}:{fetchImpl?:typeof fetch;parseSource?:Parse}={}):GuestTransientClient {
 async function post<I,O>(path:string,input:I,requestSchema:z.ZodType<I>,responseSchema:z.ZodType<O>,signal:AbortSignal):Promise<O>{
  const body=requestSchema.safeParse(input);if(!body.success)throw new GuestDataError('BAD_REQUEST');if(signal.aborted)throw new GuestDataError('GUEST_INTERRUPTED');
  let response:Response;try{response=await fetchImpl(path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body.data),signal});}catch{throw new GuestDataError(signal.aborted?'GUEST_INTERRUPTED':'SERVICE_UNAVAILABLE');}
  if(signal.aborted)throw new GuestDataError('GUEST_INTERRUPTED');if(response.redirected||response.status>=300&&response.status<400)throw new GuestDataError('INVALID_RESULT');
  let value:unknown;try{value=await response.json();}catch{throw new GuestDataError(signal.aborted?'GUEST_INTERRUPTED':'INVALID_RESULT');}
  if(signal.aborted)throw new GuestDataError('GUEST_INTERRUPTED');const error=guestApiErrorSchema.safeParse(value);if(!response.ok){if(error.success)throw new GuestDataError(error.data.code);throw new GuestDataError('INVALID_RESULT');}
  const parsed=responseSchema.safeParse(value);if(!parsed.success)throw new GuestDataError('INVALID_RESULT');return parsed.data;
 }
 async function source<I extends {requestId:string;schemaVersion:1},O extends {requestId:string;checkedAt:string}>(path:string,operation:GuestSourceOperation,input:I,requestSchema:z.ZodType<I>,responseSchema:z.ZodType<O>,parent:AbortSignal):Promise<O>{
  const parsed=requestSchema.safeParse(input);if(!parsed.success)throw new GuestDataError('BAD_REQUEST');
  const body=parsed.data,requestId=body.requestId,courseId=operation==='ed-lessons'?(body as I&{courseId:string}).courseId:null;
  const deadline=Date.now()+GUEST_SOURCE_DEADLINE_MS,controller=new AbortController();let timedOut=false;
  const stop=()=>controller.abort();parent.addEventListener('abort',stop,{once:true});const timer=setTimeout(()=>{timedOut=true;controller.abort();},GUEST_SOURCE_DEADLINE_MS);
  const interrupted=()=>new GuestDataError(parent.aborted?'GUEST_INTERRUPTED':operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR');
  const check=()=>{if(parent.aborted||timedOut||Date.now()>=deadline)throw interrupted();};
  const wait=async<T>(promise:Promise<T>):Promise<T>=>{check();let listener!:()=>void;const aborted=new Promise<never>((_,reject)=>{listener=()=>reject(interrupted());controller.signal.addEventListener('abort',listener,{once:true});});try{const value=await Promise.race([promise,aborted]);check();return value;}finally{controller.signal.removeEventListener('abort',listener);}};
  const send=async(url:string,value:unknown)=>{check();try{return await wait(fetchImpl(url,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:controller.signal}));}catch(error){check();if(error instanceof GuestDataError)throw error;throw new GuestDataError('SERVICE_UNAVAILABLE');}};
  const json=async(response:Response)=>{try{return await wait(readBoundedJson(response.body,{maxBytes:16384,signal:controller.signal}));}catch{check();throw new GuestDataError('INVALID_RESULT');}};
  const ensure=async(response:Response)=>{if(response.redirected||response.status>=300&&response.status<400)throw new GuestDataError('INVALID_RESULT');if(!response.ok){const error=guestApiErrorSchema.safeParse(await json(response));throw new GuestDataError(error.success?error.data.code:'INVALID_RESULT');}};
  try{
   check();const response=await send(path,{...body,schemaVersion:2});await ensure(response);check();
   if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/octet-stream'||response.headers.get(GUEST_SOURCE_VERSION_HEADER)!=='2')throw new GuestDataError('INVALID_RESULT');
   const receipt=response.headers.get(GUEST_READ_RECEIPT_HEADER),claims=receipt&&readGuestReadReceiptMetadata(receipt);
   if(!receipt||!claims||claims.operation!==operation||claims.requestId!==requestId||claims.courseId!==courseId)throw new GuestDataError('INVALID_RESULT');
   let bytes:Uint8Array<ArrayBuffer>;try{bytes=await wait(readBoundedBytes(response.body,{maxBytes:GUEST_MAX_UPSTREAM_BYTES,signal:controller.signal}));}catch(error){check();throw new GuestDataError(error instanceof BoundedBodyError&&error.code==='BODY_TOO_LARGE'?'SOURCE_RESULT_TOO_LARGE':'INVALID_RESULT');}
   const context=operation==='ed-lessons'?{operation,requestId,checkedAt:claims.checkedAt,courseId:courseId!,bytes:bytes.buffer}:{operation,requestId,checkedAt:claims.checkedAt,bytes:bytes.buffer};
   const result=await wait(parseSource(context,controller.signal,deadline));check();const normalized=responseSchema.safeParse(result);
   if(!normalized.success||normalized.data.requestId!==requestId||normalized.data.checkedAt!==claims.checkedAt||(operation==='ed-lessons'&&(normalized.data as O&{courseId:string}).courseId!==courseId))throw new GuestDataError('INVALID_RESULT');
   const approval=await send('/api/guest/sources/approve',{schemaVersion:2,requestId,receipt});await ensure(approval);const ack=guestSourceApprovalAckSchema.safeParse(await json(approval));
   if(!ack.success||ack.data.requestId!==requestId||ack.data.operation!==operation||ack.data.courseId!==courseId||ack.data.checkedAt!==claims.checkedAt)throw new GuestDataError('INVALID_RESULT');check();return normalized.data;
  }finally{clearTimeout(timer);parent.removeEventListener('abort',stop);controller.abort();}
 }
 return {bootstrap:async(input,signal)=>{const id=input.requestId;const result=await post('/api/guest/session',input,guestSessionRequestSchema,guestSessionResponseSchema,signal);if(result.requestId!==id)throw new GuestDataError('INVALID_RESULT');return result;},endSession:signal=>post('/api/guest/session/end',{},guestSessionEndRequestSchema,endResponseSchema,signal),canvasFeed:(input,signal)=>source('/api/guest/sources/canvas/feed','canvas-feed',input,guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,signal),edCourses:(input,signal)=>source('/api/guest/sources/ed/courses','ed-courses',input,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,signal),edLessons:(input,signal)=>source('/api/guest/sources/ed/lessons','ed-lessons',input,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,signal)};
}
