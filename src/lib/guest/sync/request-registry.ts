import {z} from "zod";
import {canvasBatchResultV1Schema,type CanvasBatchResultV1} from "@/lib/extension-protocol/submission-status";
import {gradescopeDiscoverResultV1Schema,gradescopeSyncResultV1Schema,type GradescopeDiscoverResultV1,type GradescopeSyncResultV1} from "@/lib/extension-protocol/gradescope";
import {guestCanvasFeedResponseSchema,guestEdCoursesResponseSchema,guestEdLessonsResponseSchema,type GuestCanvasFeedResponse,type GuestEdCoursesResponse,type GuestEdLessonsResponse} from "../sources/contracts";
import {GuestDataError} from "../errors";
import {GUEST_EXTENSION_WAIT_MS,GUEST_MAX_DISPATCHED_OPERATIONS,GUEST_SOURCE_DEADLINE_MS} from "../limits";
import {authorizationTime,parseRegistration} from "../store-runs";
import type {GuestOperation,GuestRegisteredRequest} from "../types";

type Immutable<T> = T extends object ? {readonly [K in keyof T]:Immutable<T[K]>} : T;
export type GuestImmutableRegistration = Immutable<GuestRegisteredRequest>;
type ReadResults = {
  "canvas-feed":GuestCanvasFeedResponse;
  "canvas-status":CanvasBatchResultV1;
  "gradescope-discovery":GradescopeDiscoverResultV1;
  gradescope:GradescopeSyncResultV1;
  "ed-courses":GuestEdCoursesResponse;
  ed:GuestEdLessonsResponse;
};
export type GuestValidatedRead = {
  [O in GuestOperation]:{operation:O;registration:GuestImmutableRegistration;result:ReadResults[O]}
}[GuestOperation];
export interface GuestRequestRegistry {
  register(registration:GuestRegisteredRequest):boolean;
  accept(requestId:string,value:unknown,nowMs:number):GuestValidatedRead|null;
  invalidateRun(runId:string):void;
}

function invalid():never {throw new GuestDataError("INVALID_RESULT");}
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value);
  if(!parsed.success)invalid();
  return parsed.data;
}
function freeze<T extends object>(value:T):Immutable<T> {
  for(const child of Object.values(value))if(child!==null && typeof child==="object")freeze(child);
  return Object.freeze(value) as Immutable<T>;
}
function unique(values:readonly string[]):void {if(new Set(values).size!==values.length)invalid();}
function canvasKey(value:{assignmentLocalId:string;courseId:string;assignmentId:string}):string {
  return JSON.stringify([value.assignmentLocalId,value.courseId,value.assignmentId]);
}
function validate(registration:GuestImmutableRegistration,value:unknown):GuestValidatedRead {
  const operation=registration.fence.operation,requestId=registration.fence.requestId;
  function correlated<T extends {requestId:string}>(result:T):T {
    if(result.requestId!==requestId)invalid();
    return result;
  }
  switch(operation){
    case "canvas-feed":return {operation,registration,result:correlated(parse(guestCanvasFeedResponseSchema,value))};
    case "canvas-status":{
      const result=correlated(parse(canvasBatchResultV1Schema,value));
      const requested=new Set(registration.members.canvas.map(canvasKey));
      unique(result.results.map(canvasKey));
      if(result.results.some(row=>!requested.has(canvasKey(row))))invalid();
      return {operation,registration,result};
    }
    case "gradescope-discovery":{
      const result=correlated(parse(gradescopeDiscoverResultV1Schema,value));
      unique(result.courses.map(course=>course.courseId));
      return {operation,registration,result};
    }
    case "gradescope":{
      const result=correlated(parse(gradescopeSyncResultV1Schema,value));
      const requested=new Set(registration.members.courseIds);
      unique(result.courses.map(course=>course.courseId));
      for(const course of result.courses){
        if(!requested.has(course.courseId) || course.assignments.some(row=>row.courseId!==course.courseId))invalid();
        // Assignment IDs are scoped to their course; never normalize decimal strings.
        unique(course.assignments.map(row=>JSON.stringify([row.courseId,row.assignmentId])));
      }
      return {operation,registration,result};
    }
    case "ed-courses":return {operation,registration,result:correlated(parse(guestEdCoursesResponseSchema,value))};
    case "ed":{
      const result=correlated(parse(guestEdLessonsResponseSchema,value));
      if(!registration.members.courseIds.includes(result.courseId))invalid();
      return {operation,registration,result};
    }
  }
}

/** Wire reads only. Local stage finalizers register directly in GuestStore. */
export function createGuestRequestRegistry({now}:{now:()=>number}):GuestRequestRegistry {
  const records=new Map<string,{registration:GuestImmutableRegistration;consumed:boolean}>();
  const seenRequestIds=new Set<string>();
  const invalidated=new Set<string>();
  let latestTime=0;
  function current(caller=now()):number {
    latestTime=Math.max(latestTime,authorizationTime(caller,now));
    return latestTime;
  }
  return {
    register(input){
      const registration=parseRegistration(input),{fence,members}=registration;
      if(registration.intent==="stage-result")return false;
      const source=fence.operation.startsWith("canvas-")?"canvas":fence.operation.startsWith("gradescope")?"gradescope":"ed";
      if(fence.source!==source ||
        fence.purpose==="setup" && (!["canvas-feed","gradescope-discovery","ed-courses"].includes(fence.operation) || fence.connectionId!==null || fence.connectionGeneration!==null) ||
        fence.purpose==="read" && (fence.connectionId===null || fence.connectionGeneration===null) ||
        fence.operation!=="canvas-status" && members.canvas.length ||
        !["gradescope","ed"].includes(fence.operation) && members.courseIds.length)invalid();
      unique(members.canvas.map(row=>row.assignmentLocalId));
      unique(members.courseIds);
      const at=current(),wait=fence.operation==="canvas-status" || fence.operation.startsWith("gradescope")?GUEST_EXTENSION_WAIT_MS:GUEST_SOURCE_DEADLINE_MS;
      if(invalidated.has(fence.runId) || seenRequestIds.has(fence.requestId) || fence.deadlineAtMs<=at || fence.deadlineAtMs>at+wait ||
        [...records.values()].filter(row=>row.registration.fence.runId===fence.runId).length>=GUEST_MAX_DISPATCHED_OPERATIONS)return false;
      records.set(fence.requestId,{registration:freeze(registration),consumed:false});
      seenRequestIds.add(fence.requestId);
      return true;
    },
    accept(requestId,value,nowMs){
      const record=records.get(requestId);
      if(!record || record.consumed || invalidated.has(record.registration.fence.runId))return null;
      if(record.registration.fence.deadlineAtMs<=current(nowMs))return null;
      const accepted=validate(record.registration,value);
      record.consumed=true;
      return accepted;
    },
    invalidateRun(runId){
      invalidated.add(runId);
      for(const [id,record] of records)if(record.registration.fence.runId===runId)records.delete(id);
    },
  };
}
