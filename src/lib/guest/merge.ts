import { z } from "zod";
import { GuestDataError,guestSafeCodeSchema } from "./errors";
import { GUEST_MAX_ASSIGNMENTS } from "./limits";
import { guestCountSchema,guestDecimalIdSchema,guestExternalIdSchema,guestNormalizedAssignmentSchema,
  guestStageSchema,guestSubmissionStatusSchema,guestUtcDateSchema,guestUuidSchema,parseGuestSnapshot } from "./schema";
import type { GuestAssignmentRecord,GuestCourseResult,GuestSnapshot,GuestSyncState } from "./types";

const courseResultSchema=z.object({
  sourceConnectionId:guestUuidSchema,connectionGeneration:guestCountSchema,stage:guestStageSchema,
  externalCourseId:guestDecimalIdSchema.nullable(),checkedAt:guestUtcDateSchema,
  assignments:z.array(guestNormalizedAssignmentSchema).max(GUEST_MAX_ASSIGNMENTS),
  statuses:z.array(guestSubmissionStatusSchema.extend({externalId:guestExternalIdSchema,errorCode:guestSafeCodeSchema.nullable()}).strict()).max(GUEST_MAX_ASSIGNMENTS),
  courseSucceeded:z.boolean(),failedCount:guestCountSchema,code:guestSafeCodeSchema.nullable(),
  remainingKeys:z.array(guestExternalIdSchema).max(GUEST_MAX_ASSIGNMENTS),
}).strict();

function invalid():never { throw new GuestDataError("INVALID_RESULT"); }
function newer(incoming:string,current:string|null|undefined):boolean {
  return current==null || Date.parse(incoming)>Date.parse(current);
}
function uniqueByExternalId<T extends {externalId:string}>(rows:T[]):Map<string,T> {
  const map=new Map<string,T>();
  for(const row of rows){if(map.has(row.externalId))invalid();map.set(row.externalId,row);}
  return map;
}

/** Pure source reducer. The store owns fencing, attempt resets and revision increments. */
export function applyGuestCourseResult(snapshot:GuestSnapshot,result:GuestCourseResult,at:string,uuid:()=>string):{snapshot:GuestSnapshot;updatedCount:number;ignoredCount:number} {
  try {
    snapshot=parseGuestSnapshot(snapshot);
    result=courseResultSchema.parse(result);
    guestUtcDateSchema.parse(at);
  } catch { invalid(); }
  const connection=snapshot.connections.find(row=>row.id===result.sourceConnectionId);
  const expectedSource=result.stage.startsWith("canvas-")?"canvas":result.stage;
  if(!connection || connection.generation!==result.connectionGeneration || connection.kind!==expectedSource)invalid();
  const courseIds=new Set(snapshot.courses.filter(row=>row.sourceConnectionId===connection.id).map(row=>row.externalCourseId));
  if(connection.kind!=="canvas" && (result.externalCourseId===null || !courseIds.has(result.externalCourseId)))invalid();
  if(result.stage==="canvas-feed" && result.statuses.length || result.stage==="canvas-status" && result.assignments.length)invalid();

  const existing=uniqueByExternalId(snapshot.assignments.filter(row=>row.sourceConnectionId===connection.id));
  const metadata=uniqueByExternalId(result.assignments);
  const statuses=uniqueByExternalId(result.statuses);
  for(const row of metadata.values()){
    if(row.source!==connection.kind || result.externalCourseId!==null && row.courseId!==result.externalCourseId)invalid();
    if(connection.kind!=="canvas" && (!row.courseId || !courseIds.has(row.courseId)))invalid();
    const current=existing.get(row.externalId);
    if(connection.kind!=="canvas" && current && current.courseId!==row.courseId)invalid();
    if(result.stage==="gradescope" && !statuses.has(row.externalId))invalid();
  }
  for(const row of statuses.values()){
    const member=metadata.get(row.externalId)??existing.get(row.externalId);
    if(!member || result.externalCourseId!==null && member.courseId!==result.externalCourseId)invalid();
    if(result.stage==="gradescope" && row.errorCode===null && !metadata.has(row.externalId))invalid();
  }
  const remaining=new Set<string>();
  for(const key of result.remainingKeys){
    const valid=result.stage==="canvas-status"?existing.has(key):result.stage!=="canvas-feed" && courseIds.has(key);
    if(!valid || remaining.has(key))invalid();
    remaining.add(key);
  }
  // Canvas reports failed assignment members; Gradescope/Ed report failed courses.
  if(result.stage==="canvas-status" && result.failedCount<result.statuses.filter(row=>row.errorCode!==null).length)invalid();

  const assignments=new Map(snapshot.assignments.map(row=>[row.id,row]));
  const localIds=new Set([...snapshot.connections,...snapshot.courses,...snapshot.assignments].map(row=>row.id));
  const savedStatuses=new Map(snapshot.statuses.map(row=>[row.assignmentId,row]));
  let updatedCount=0,ignoredCount=0;
  // Whole-course failures and errored members never replace previously accepted data.
  if(result.courseSucceeded){
    for(const externalId of new Set([...metadata.keys(),...statuses.keys()])){
      const incoming=metadata.get(externalId),status=statuses.get(externalId);
      if(status?.errorCode)continue;
      let current=existing.get(externalId);
      const previousStatus=current?savedStatuses.get(current.id):undefined;
      const metadataAt=result.stage==="gradescope"?status!.checkedAt:result.checkedAt;
      const coupledFresh=result.stage!=="gradescope" || newer(metadataAt,current?.metadataCheckedAt) && newer(metadataAt,previousStatus?.checkedAt);
      const writeMetadata=Boolean(incoming && coupledFresh && newer(metadataAt,current?.metadataCheckedAt));
      const writeStatus=Boolean(status && coupledFresh && newer(status.checkedAt,previousStatus?.checkedAt));
      if(!writeMetadata && !writeStatus){ignoredCount++;continue;}
      if(writeMetadata && incoming){
        const id=current?.id??uuid();
        if(!current && (!guestUuidSchema.safeParse(id).success || localIds.has(id)))invalid();
        localIds.add(id);
        current={...incoming,id,sourceConnectionId:connection.id,metadataCheckedAt:metadataAt,
          firstSeenAt:current?.firstSeenAt??at,lastSeenAt:at} satisfies GuestAssignmentRecord;
        assignments.set(id,current);
      }
      if(writeStatus && status && current){
        const {externalId:discardExternalId,errorCode,...fields}=status;
        void discardExternalId;void errorCode;
        savedStatuses.set(current.id,{...fields,assignmentId:current.id});
      }
      updatedCount++;
    }
  }

  const previous=snapshot.syncStates.find(row=>row.sourceConnectionId===connection.id && row.stage===result.stage);
  const failedCount=(previous?.failedCount??0)+result.failedCount;
  // Empty/stale successes count even when completion and attempt times are identical.
  const hasSuccessfulCheck=result.courseSucceeded || previous?.hasSuccessfulCheck===true;
  const state:GuestSyncState={
    sourceConnectionId:connection.id,stage:result.stage,lastAttemptedAt:previous?.lastAttemptedAt??at,
    lastSuccessfulAt:result.courseSucceeded && newer(at,previous?.lastSuccessfulAt)?at:previous?.lastSuccessfulAt??null,
    hasSuccessfulCheck,lastErrorCode:failedCount>0 && hasSuccessfulCheck?"PARTIAL_SYNC":result.code??previous?.lastErrorCode??null,
    updatedCount:(previous?.updatedCount??0)+updatedCount,failedCount,resumeKeys:[...result.remainingKeys],
  };
  const syncStates=previous?snapshot.syncStates.map(row=>row===previous?state:row):[...snapshot.syncStates,state];
  try {
    return {snapshot:parseGuestSnapshot({...snapshot,assignments:[...assignments.values()],statuses:[...savedStatuses.values()],syncStates}),updatedCount,ignoredCount};
  } catch { throw new GuestDataError("GUEST_STORAGE_LIMIT"); }
}

export function mergeGuestCourseResult(snapshot:GuestSnapshot,result:GuestCourseResult,at:string,uuid:()=>string):GuestSnapshot {
  return applyGuestCourseResult(snapshot,result,at,uuid).snapshot;
}
