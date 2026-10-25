import {z} from "zod";
import {guestSafeCodeSchema} from "./errors";
import {GUEST_MAX_ASSIGNMENTS,GUEST_MAX_COURSES,GUEST_MAX_SECRET_CHARACTERS} from "./limits";
import {applyGuestCourseResult} from "./merge";
import {guestConnectionSchema,guestCountSchema,guestDiscoveredCourseSchema,guestExternalIdSchema,guestNormalizedAssignmentSchema,guestStageSchema,guestUtcDateSchema,guestUuidSchema,parseGuestSnapshot} from "./schema";
import {invalid,type StoredRequest} from "./store-runs";
import type {GuestCommitChanges,GuestRequestFence,GuestSnapshot,GuestSyncState} from "./types";

const secretSchema=z.object({value:z.string().min(1).max(GUEST_MAX_SECRET_CHARACTERS),remember:z.boolean()}).strict();
const connectSchema=z.object({kind:z.literal("connect"),connection:guestConnectionSchema,courses:z.array(guestDiscoveredCourseSchema).max(GUEST_MAX_COURSES),assignments:z.array(guestNormalizedAssignmentSchema).max(GUEST_MAX_ASSIGNMENTS),secret:secretSchema.nullable()}).strict();
const credentialSchema=z.object({kind:z.literal("credential"),secret:secretSchema}).strict();
const stageSchema=z.object({kind:z.literal("stage-result"),outcome:z.object({runId:guestUuidSchema,stage:guestStageSchema,status:z.enum(["success","partial","failed","skipped","timed-out","cancelled"]),code:guestSafeCodeSchema.nullable(),updatedCount:guestCountSchema,failedCount:guestCountSchema,ignoredCount:guestCountSchema,pendingCount:guestCountSchema,attemptedAt:guestUtcDateSchema,completedAt:guestUtcDateSchema}).strict(),remainingKeys:z.array(guestExternalIdSchema).max(GUEST_MAX_ASSIGNMENTS)}).strict();

export function initialStage(connectionId:string,stage:GuestSyncState["stage"]):GuestSyncState {
  return {sourceConnectionId:connectionId,stage,lastAttemptedAt:null,lastSuccessfulAt:null,hasSuccessfulCheck:false,lastErrorCode:null,updatedCount:0,failedCount:0,resumeKeys:[]};
}
export function updateStage(snapshot:GuestSnapshot,state:GuestSyncState):GuestSnapshot {
  return {...snapshot,syncStates:[...snapshot.syncStates.filter(s=>s.sourceConnectionId!==state.sourceConnectionId||s.stage!==state.stage),state]};
}
export function applyChanges(snapshot:GuestSnapshot,request:GuestRequestFence,registered:StoredRequest,changes:GuestCommitChanges,at:string,uuid:()=>string):{snapshot:GuestSnapshot;updatedCount:number;ignoredCount:number;credential?:{connectionId:string;generation:number;value:string|null}} {
  if(changes.kind==="connect"){
    const parsed=connectSchema.safeParse(changes);if(!parsed.success)invalid();const data=parsed.data;
    if(request.purpose!=="setup"||data.connection.kind!==request.source||request.source!=="canvas"&&data.assignments.length||request.source==="canvas"&&data.courses.length)invalid();
    snapshot={...snapshot,connections:[...snapshot.connections,data.connection],courses:[...snapshot.courses,...data.courses.map(c=>({...c,id:uuid(),sourceConnectionId:data.connection.id,enabled:false,firstSeenAt:at,lastSeenAt:at}))]};
    let updatedCount=0,ignoredCount=0;
    if(request.source==="canvas"){
      const merged=applyGuestCourseResult(snapshot,{sourceConnectionId:data.connection.id,connectionGeneration:data.connection.generation,stage:"canvas-feed",externalCourseId:null,checkedAt:at,assignments:data.assignments,statuses:[],courseSucceeded:true,failedCount:0,code:null,remainingKeys:[]},at,uuid);
      snapshot=merged.snapshot;updatedCount=merged.updatedCount;ignoredCount=merged.ignoredCount;
    }
    return {snapshot,updatedCount,ignoredCount,credential:{connectionId:data.connection.id,generation:data.connection.generation,value:data.secret?.remember?data.secret.value:null}};
  }
  if(request.purpose!=="read")invalid();
  const connection=snapshot.connections.find(c=>c.id===request.connectionId);if(!connection)invalid();
  if(changes.kind==="credential"){
    const parsed=credentialSchema.safeParse(changes);if(!parsed.success || !["canvas-feed","ed-courses","gradescope-discovery"].includes(request.operation))invalid();
    const generation=connection.generation+1;
    return {snapshot:{...snapshot,connections:snapshot.connections.map(c=>c.id===connection.id?{...c,generation,updatedAt:at}:c)},updatedCount:0,ignoredCount:0,credential:{connectionId:connection.id,generation,value:parsed.data.secret.remember?parsed.data.secret.value:null}};
  }
  if(changes.kind==="course-result"){
    if(Object.keys(changes).some(k=>k!=="kind"&&k!=="result"))invalid();
    const result=changes.result;
    if(result.sourceConnectionId!==connection.id||result.connectionGeneration!==connection.generation||result.stage!==request.operation)invalid();
    if(result.stage==="canvas-feed"&&result.externalCourseId!==null)invalid();
    if(["gradescope","ed"].includes(result.stage)&&!registered.members.courseIds.includes(result.externalCourseId!))invalid();
    if(result.stage==="canvas-status"){
      if(result.externalCourseId!==null)invalid();
      const members=new Set(registered.members.canvas.map(locator=>snapshot.assignments.find(a=>a.id===locator.assignmentLocalId)?.externalId));
      if(result.statuses.some(status=>!members.has(status.externalId)))invalid();
    }
    return applyGuestCourseResult(snapshot,result,at,uuid);
  }
  const parsed=stageSchema.safeParse(changes);if(!parsed.success)invalid();
  const {outcome,remainingKeys}=parsed.data;
  if(outcome.runId!==request.runId||outcome.stage!==request.operation)invalid();
  const previous=snapshot.syncStates.find(s=>s.sourceConnectionId===connection.id&&s.stage===outcome.stage)??initialStage(connection.id,outcome.stage);
  const hasRemainder=outcome.failedCount>0||outcome.pendingCount>0||["partial","failed","timed-out","cancelled"].includes(outcome.status);
  const state={...previous,lastAttemptedAt:previous.lastAttemptedAt??outcome.attemptedAt,lastErrorCode:previous.hasSuccessfulCheck&&hasRemainder?"PARTIAL_SYNC" as const:outcome.code,updatedCount:outcome.updatedCount,failedCount:outcome.failedCount,resumeKeys:remainingKeys};
  snapshot=updateStage(snapshot,state);
  try{snapshot=parseGuestSnapshot(snapshot);}catch{invalid();}
  return {snapshot,updatedCount:0,ignoredCount:0};
}
