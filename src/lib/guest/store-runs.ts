import {z} from "zod";
import {GuestDataError} from "./errors";
import {GUEST_CANVAS_BATCH_SIZE,GUEST_LEASE_MS,GUEST_MAX_DISPATCHED_OPERATIONS,GUEST_RUN_DEADLINE_MS,GUEST_SOURCE_DEADLINE_MS} from "./limits";
import {guestCountSchema,guestDecimalIdSchema,guestSourceKindSchema,guestUuidSchema} from "./schema";
import {idbRequest,type Metadata} from "./indexeddb";
import type {GuestCommitResult,GuestRegisteredRequest,GuestRequestFence,GuestRunIdentity,GuestRunLease,GuestSnapshot} from "./types";

const milliseconds=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fenceSchema=z.object({datasetId:guestUuidSchema,runId:guestUuidSchema,pageEpoch:guestUuidSchema,generation:guestCountSchema,
  requestId:guestUuidSchema,operation:z.enum(["canvas-feed","canvas-status","gradescope","gradescope-discovery","ed","ed-courses"]),source:guestSourceKindSchema,
  purpose:z.enum(["setup","read"]),connectionId:guestUuidSchema.nullable(),connectionGeneration:guestCountSchema.nullable(),deadlineAtMs:milliseconds}).strict();
const registrationSchema=z.object({fence:fenceSchema,members:z.object({canvas:z.array(z.object({assignmentLocalId:guestUuidSchema,courseId:guestDecimalIdSchema,assignmentId:guestDecimalIdSchema}).strict()).max(GUEST_CANVAS_BATCH_SIZE),courseIds:z.array(guestDecimalIdSchema).max(1)}).strict()}).strict();
export type StoredRequest=GuestRegisteredRequest & {consumed:boolean};
export function invalid():never{throw new GuestDataError("INVALID_RESULT");}
export function sameRun(a:GuestRunIdentity|null,b:GuestRunIdentity):boolean{return !!a && a.datasetId===b.datasetId && a.runId===b.runId && a.pageEpoch===b.pageEpoch && a.generation===b.generation;}
export function activeLease(lease:GuestRunLease|null,at:number):lease is GuestRunLease {
  return !!lease && Number.isSafeInteger(at) && lease.startedAtMs<=at && at<lease.leaseExpiresAtMs && at<lease.deadlineAtMs &&
    lease.deadlineAtMs<=lease.startedAtMs+GUEST_RUN_DEADLINE_MS && lease.leaseExpiresAtMs<=at+GUEST_LEASE_MS && lease.leaseExpiresAtMs<=lease.deadlineAtMs;
}
export function authorizationTime(caller:number,now:()=>number):number {
  const fresh=now();if(!Number.isSafeInteger(caller)||!Number.isSafeInteger(fresh)||caller<0||fresh<0)invalid();return Math.max(caller,fresh);
}
export function matchingConnection(snapshot:GuestSnapshot,fence:GuestRequestFence):boolean {
  if(fence.purpose==="setup")return fence.connectionId===null && fence.connectionGeneration===null && !snapshot.connections.some(c=>c.kind===fence.source);
  return fence.connectionId!==null && fence.connectionGeneration!==null && snapshot.connections.some(c=>c.id===fence.connectionId && c.kind===fence.source && c.generation===fence.connectionGeneration);
}
export function parseRegistration(input:GuestRegisteredRequest):GuestRegisteredRequest {
  const parsed=registrationSchema.safeParse(input);if(!parsed.success)invalid();return parsed.data;
}
export function validateMembers(request:GuestRegisteredRequest,snapshot:GuestSnapshot):void {
  const {fence,members}=request;
  const source=fence.operation.startsWith("canvas-")?"canvas":fence.operation.startsWith("gradescope")?"gradescope":"ed";
  if(source!==fence.source || fence.purpose==="setup" && !["canvas-feed","gradescope-discovery","ed-courses"].includes(fence.operation))invalid();
  if(fence.operation!=="canvas-status" && members.canvas.length || !["gradescope","ed"].includes(fence.operation) && members.courseIds.length)invalid();
  const ids=new Set<string>();
  for(const locator of members.canvas){
    const row=snapshot.assignments.find(a=>a.id===locator.assignmentLocalId && a.sourceConnectionId===fence.connectionId);
    if(!row || row.courseId!==locator.courseId || row.sourceUrl!==`https://canvas.uw.edu/courses/${locator.courseId}/assignments/${locator.assignmentId}` || ids.has(row.id))invalid();ids.add(row.id);
  }
  for(const id of members.courseIds)if(!snapshot.courses.some(c=>c.sourceConnectionId===fence.connectionId && c.externalCourseId===id && c.enabled))invalid();
}
export async function register(tx:IDBTransaction,metadata:Metadata,snapshot:GuestSnapshot,input:GuestRegisteredRequest,at:()=>number):Promise<boolean> {
  const request=parseRegistration(input);validateMembers(request,snapshot);
  const records:StoredRequest[]=await idbRequest(tx.objectStore("requests").getAll());
  const now=at();
  if(!sameRun(metadata.lease,request.fence)||!activeLease(metadata.lease,now)||!matchingConnection(snapshot,request.fence) || request.fence.deadlineAtMs<=now || request.fence.deadlineAtMs>Math.min(metadata.lease.deadlineAtMs,now+GUEST_SOURCE_DEADLINE_MS))return false;
  if(records.length>=GUEST_MAX_DISPATCHED_OPERATIONS || records.some(r=>r.fence.requestId===request.fence.requestId))return false;
  tx.objectStore("requests").add({...request,consumed:false} satisfies StoredRequest);return true;
}
export function commitFence(metadata:Metadata,snapshot:GuestSnapshot,request:GuestRequestFence,stored:StoredRequest|undefined,at:number):Extract<GuestCommitResult,{status:"discarded"}>|null {
  if(!sameRun(metadata.lease,request)||metadata.datasetId!==request.datasetId)return {status:"discarded",reason:"superseded"};
  if(!activeLease(metadata.lease,at)||request.deadlineAtMs<=at)return {status:"discarded",reason:"expired"};
  if(!matchingConnection(snapshot,request))return {status:"discarded",reason:"disconnected"};
  if(!stored || Object.keys(fenceSchema.shape).some(key=>stored.fence[key as keyof GuestRequestFence]!==request[key as keyof GuestRequestFence]))return {status:"discarded",reason:"superseded"};
  if(stored.consumed)return {status:"discarded",reason:"consumed"};
  return null;
}
