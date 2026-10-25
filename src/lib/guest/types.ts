import type { FilterState } from "@/features/assignments/assignment-filter-bar";
import type { Assignment } from "@/lib/assignments/types";
import type { NormalizedAssignment } from "@/lib/assignments/normalize";
import type { SourceCourse,DiscoveredSourceCourse,SourceKind } from "@/lib/sources/types";
import type { AssignmentSubmissionStatus,CanvasAssignmentLocator } from "@/lib/submission-status/types";
import type { GuestSafeCode } from "./errors";

export type GuestStage = "canvas-feed" | "canvas-status" | "gradescope" | "ed";
export type GuestOperation = GuestStage | "gradescope-discovery" | "ed-courses";
export type GuestOutcomeStatus = "success" | "partial" | "failed" | "skipped" | "timed-out" | "cancelled";
export type GuestAssignmentRecord = Omit<Assignment,"submissionStatus"> & {sourceConnectionId:string;metadataCheckedAt:string|null};
export type GuestStatusRecord = AssignmentSubmissionStatus & {assignmentId:string};
export type GuestConnection = {id:string;kind:SourceKind;enabled:boolean;generation:number;createdAt:string;updatedAt:string};
export type GuestPreferences = {timeZone:string;filters:FilterState;sort:"due"|"status";automaticCanvas:boolean;automaticGradescope:boolean};
export type GuestSyncState = {sourceConnectionId:string;stage:GuestStage;lastAttemptedAt:string|null;lastSuccessfulAt:string|null;hasSuccessfulCheck:boolean;lastErrorCode:GuestSafeCode|null;updatedCount:number;failedCount:number;resumeKeys:string[]};
export type GuestSnapshot = {schemaVersion:1;datasetId:string;revision:number;connections:GuestConnection[];courses:SourceCourse[];assignments:GuestAssignmentRecord[];statuses:GuestStatusRecord[];syncStates:GuestSyncState[];preferences:GuestPreferences};
export type GuestRunIdentity = {datasetId:string;runId:string;pageEpoch:string;generation:number};
export type GuestRunLease = GuestRunIdentity & {startedAtMs:number;deadlineAtMs:number;leaseExpiresAtMs:number};
export type GuestRequestFence = GuestRunIdentity & {
  requestId:string;operation:GuestOperation;source:SourceKind;
  // Setup expects no existing source; reads require a connection ID and generation.
  purpose:"setup"|"read";connectionId:string|null;connectionGeneration:number|null;deadlineAtMs:number;
};
// Local registration metadata only; omission normalizes to provider-read.
export type GuestRegisteredRequest = {fence:GuestRequestFence;members:{canvas:CanvasAssignmentLocator[];courseIds:string[]};intent?:"provider-read"|"stage-result"};
export type GuestStageOutcome = {runId:string;stage:GuestStage;status:GuestOutcomeStatus;code:GuestSafeCode|null;updatedCount:number;failedCount:number;ignoredCount:number;pendingCount:number;attemptedAt:string;completedAt:string};
export type GuestRunReport = {run:GuestRunIdentity;mode:"manual"|"automatic";outcomes:GuestStageOutcome[]};
export type GuestClock = {now:()=>number;setTimeout:(callback:()=>void,delayMs:number)=>unknown;clearTimeout:(handle:unknown)=>void};
export type GuestCommitResult = {status:"accepted";snapshot:GuestSnapshot;updatedCount:number;ignoredCount:number} | {status:"discarded";reason:"superseded"|"expired"|"disconnected"|"consumed"};
export type GuestSecretChoice = {value:string;remember:boolean};
export type GuestStatusInput = AssignmentSubmissionStatus & {externalId:string;errorCode:GuestSafeCode|null};
export type GuestCourseResult = {
  sourceConnectionId:string;connectionGeneration:number;stage:GuestStage;externalCourseId:string|null;checkedAt:string;
  assignments:NormalizedAssignment[];statuses:GuestStatusInput[];courseSucceeded:boolean;failedCount:number;code:GuestSafeCode|null;remainingKeys:string[];
};
export type GuestCommitChanges =
  | {kind:"connect";connection:GuestConnection;courses:DiscoveredSourceCourse[];assignments:NormalizedAssignment[];secret:GuestSecretChoice|null}
  | {kind:"credential";secret:GuestSecretChoice}
  | {kind:"course-result";result:GuestCourseResult}
  | {kind:"stage-result";outcome:GuestStageOutcome;remainingKeys:string[]};
export type GuestBackupV1 = {schemaVersion:1;exportedAt:string;data:Pick<GuestSnapshot,"connections"|"courses"|"assignments"|"statuses"|"syncStates"|"preferences">};

/** Implementations keep callbacks synchronous within each storage transaction. */
export interface GuestStore {
  getIdentity():Promise<{datasetId:string;revision:number}>;
  read():Promise<GuestSnapshot>;
  subscribe(listener:()=>void):()=>void;
  savePreferences(patch:Partial<GuestPreferences>,datasetId:string):Promise<GuestSnapshot>;
  setEnabledCourses(connectionId:string,ids:string[],generation:number):Promise<GuestSnapshot>;
  beginRun(input:{pageEpoch:string;nowMs:number;deadlineAtMs:number}):Promise<GuestRunLease|null>;
  renewRun(run:GuestRunIdentity,nowMs:number):Promise<GuestRunLease|null>;
  releaseRun(run:GuestRunIdentity):Promise<void>;
  registerRequest(request:GuestRegisteredRequest,nowMs:number):Promise<boolean>;
  markStageAttempt(run:GuestRunIdentity,connectionId:string,generation:number,stage:GuestStage,at:string):Promise<boolean>;
  invalidateRun(run:GuestRunIdentity):Promise<void>;
  commit(request:GuestRequestFence,changes:GuestCommitChanges,nowMs:number):Promise<GuestCommitResult>;
  readRememberedSecret(connectionId:string):Promise<string|null>;
  forgetCredential(connectionId:string,generation:number):Promise<GuestSnapshot>;
  disconnect(connectionId:string,generation:number):Promise<GuestSnapshot>;
  replaceDataset(backup:GuestBackupV1,datasetId:string):Promise<GuestSnapshot>;
  clear(datasetId:string):Promise<GuestSnapshot>;
  close():void;
}
