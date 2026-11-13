import {GuestSourceError} from './errors';
import {GuestDataError} from '../errors';
import type {GuestSourceParseInput} from './wire';
import {validateGuestCanvasFeedResponse,validateGuestEdCoursesResponse,validateGuestEdLessonsResponse,type GuestCanvasFeedResponse,type GuestEdCoursesResponse,type GuestEdLessonsResponse} from './contracts';
import {parseCanvasCore,splitCanvasEvents} from '@/lib/sources/canvas-ical/parser-core';
import {CanvasSourceError} from '@/lib/sources/canvas-ical/errors';
import {parseEdCourses,parseEdLessons} from '@/lib/sources/ed/parser';
import {EdSourceError} from '@/lib/sources/ed/errors';
import {normalizeSourceAssignment} from '@/lib/assignments/normalize';
import {guestUuidSchema,guestUtcDateSchema,guestDecimalIdSchema,isGuestSourceUrl} from '../schema';
import {GUEST_MAX_UPSTREAM_BYTES,GUEST_CANVAS_MAX_EVENT_BLOCKS,GUEST_CANVAS_MAX_ASSIGNMENTS,GUEST_ED_MAX_COURSES,GUEST_ED_MAX_RAW_LESSONS,GUEST_ED_MAX_VISIBLE_LESSONS} from '../limits';

function record(value:unknown):Record<string,unknown>|null{return typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function numericId(value:unknown){if(typeof value==='number'&&!Number.isSafeInteger(value))throw new GuestSourceError('ED_PARSE_ERROR');}
function context(input:GuestSourceParseInput):GuestSourceParseInput{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input))throw 0;
  const {operation,requestId,checkedAt,bytes}=input;
  if(!['canvas-feed','ed-courses','ed-lessons'].includes(operation)||!guestUuidSchema.safeParse(requestId).success||!guestUtcDateSchema.safeParse(checkedAt).success||!(bytes instanceof ArrayBuffer))throw 0;
  const allowed=operation==='ed-lessons'?['operation','requestId','checkedAt','bytes','courseId']:['operation','requestId','checkedAt','bytes'];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw 0;
  if(operation==='ed-lessons'){
   const courseId=input.courseId;
   if(typeof courseId!=='string'||!guestDecimalIdSchema.safeParse(courseId).success)throw 0;
   return {operation,requestId,checkedAt,bytes,courseId};
  }
  return {operation,requestId,checkedAt,bytes};
 }catch{throw new GuestSourceError('BAD_REQUEST');}
}

export async function parseGuestSourceBytes(input:GuestSourceParseInput,options:{signal?:AbortSignal;check?:()=>void}={}):Promise<GuestCanvasFeedResponse|GuestEdCoursesResponse|GuestEdLessonsResponse>{
 const check=()=>{if(options.signal?.aborted)throw new GuestDataError('GUEST_INTERRUPTED');options.check?.();};
 check();const data=context(input);
 try{
  if(data.bytes.byteLength>GUEST_MAX_UPSTREAM_BYTES)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(data.bytes);}catch{throw new GuestSourceError(data.operation==='canvas-feed'?'INVALID_ICAL':'ED_PARSE_ERROR');}
  check();
  const fields={ok:true as const,schemaVersion:1 as const,requestId:data.requestId,checkedAt:data.checkedAt};
  if(data.operation==='canvas-feed'){
   let count=0;for(const _event of splitCanvasEvents(text)){void _event;check();if(++count>GUEST_CANVAS_MAX_EVENT_BLOCKS)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');}
   const parsed=parseCanvasCore(text,true,check);check();
   if(parsed.assignments.length>GUEST_CANVAS_MAX_ASSIGNMENTS)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');
   if(parsed.assignments.length===0&&parsed.errors.length>0)throw new GuestSourceError('INVALID_ICAL');
   for(const [index,parts]of parsed.fallbacks){
    check();
    let digest:ArrayBuffer;
    try{if(!globalThis.crypto?.subtle)throw 0;digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts.join('\u001f')));}catch{check();throw new GuestSourceError('SERVICE_UNAVAILABLE');}
    check();if(digest.byteLength!==32)throw new GuestSourceError('SERVICE_UNAVAILABLE');
    parsed.assignments[index].externalId='fallback-'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
   }
   const assignments=parsed.assignments.map(row=>{check();const n=normalizeSourceAssignment('canvas',row);return {...n,source:'canvas' as const,sourceUrl:isGuestSourceUrl(n.sourceUrl,'canvas',n.courseId)?n.sourceUrl:null};});
   const result=validateGuestCanvasFeedResponse({...fields,assignments,report:{skippedCount:parsed.skipped,malformedCount:parsed.errors.length,partial:parsed.errors.length>0}});check();
   if(!result.success)throw new GuestSourceError(result.reason==='oversize'?'SOURCE_RESULT_TOO_LARGE':'INVALID_ICAL');
   return result.data;
  }
  let payload:unknown;try{payload=JSON.parse(text);}catch{throw new GuestSourceError('ED_PARSE_ERROR');}check();
  if(data.operation==='ed-courses'){
   const rows=record(payload)?.courses;
   if(Array.isArray(rows)){if(rows.length>GUEST_ED_MAX_COURSES)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');for(const row of rows){check();numericId(record(record(row)?.course)?.id);}}
   const courses=parseEdCourses(payload);check();
   const result=validateGuestEdCoursesResponse({...fields,courses});check();
   if(!result.success)throw new GuestSourceError(result.reason==='oversize'?'SOURCE_RESULT_TOO_LARGE':'ED_PARSE_ERROR');
   return result.data;
  }
  if(data.operation!=='ed-lessons')throw new GuestSourceError('BAD_REQUEST');
  const rows=record(payload)?.lessons;
  if(Array.isArray(rows)){if(rows.length>GUEST_ED_MAX_RAW_LESSONS)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');for(const row of rows){check();for(const k of ['id','course_id','module_id'])numericId(record(row)?.[k]);}}
  const parsed=parseEdLessons(payload,{id:'',sourceConnectionId:'',externalCourseId:data.courseId,shortName:null,fullName:'Ed',term:null,year:null,enabled:true,firstSeenAt:data.checkedAt,lastSeenAt:data.checkedAt});check();
  if(parsed.length>GUEST_ED_MAX_VISIBLE_LESSONS)throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');
  const lessons=parsed.map(row=>{check();const {courseName,...n}=normalizeSourceAssignment('ed',row);void courseName;return {...n,source:'ed' as const,courseId:data.courseId,sourceUrl:null};});
  const result=validateGuestEdLessonsResponse({...fields,courseId:data.courseId,lessons});check();
  if(!result.success)throw new GuestSourceError(result.reason==='oversize'?'SOURCE_RESULT_TOO_LARGE':'ED_PARSE_ERROR');
  return result.data;
 }catch(error){
  check();
  if(error instanceof GuestSourceError)throw error;
  if(error instanceof CanvasSourceError||error instanceof EdSourceError)throw new GuestSourceError(error.code);
  throw new GuestSourceError(data.operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR');
 }
}
