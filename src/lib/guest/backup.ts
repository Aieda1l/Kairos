import { z } from "zod";
import { GuestDataError } from "./errors";
import { GUEST_MAX_IMPORT_BYTES } from "./limits";
import { guestSnapshotSchema,guestUtcDateSchema,parseGuestSnapshot } from "./schema";
import type { GuestBackupV1,GuestSnapshot } from "./types";

const dataShape={connections:guestSnapshotSchema.shape.connections,courses:guestSnapshotSchema.shape.courses,
  assignments:guestSnapshotSchema.shape.assignments,statuses:guestSnapshotSchema.shape.statuses,
  syncStates:guestSnapshotSchema.shape.syncStates,preferences:guestSnapshotSchema.shape.preferences};
const backupSchema=z.object({schemaVersion:z.literal(1),exportedAt:guestUtcDateSchema,data:z.object(dataShape).strict()}).strict();

function pick<T,K extends keyof T>(value:T,keys:readonly K[]):Pick<T,K> {
  return Object.fromEntries(keys.map(key=>[key,value[key]])) as Pick<T,K>;
}

/** Explicit nested allowlists also exclude accidental internal fields on typed inputs. */
function projectData(snapshot:GuestSnapshot):GuestBackupV1["data"] {
  return {
    connections:snapshot.connections.map(row=>pick(row,["id","kind","enabled","generation","createdAt","updatedAt"])),
    courses:snapshot.courses.map(row=>pick(row,["id","sourceConnectionId","externalCourseId","shortName","fullName","term","year","enabled","firstSeenAt","lastSeenAt"])),
    assignments:snapshot.assignments.map(row=>pick(row,["id","sourceConnectionId","metadataCheckedAt","source","externalId","courseId","courseName","title",
      "releaseAt","dueAt","lateDueAt","status","sourceStatusText","gradeScore","gradeMax","gradeDisplay","sourceUrl","sourceUpdatedAt","firstSeenAt","lastSeenAt"])),
    statuses:snapshot.statuses.map(row=>pick(row,["assignmentId","state","isLate","isMissing","submittedAt","checkedAt","extractorVersion"])),
    syncStates:snapshot.syncStates.map(row=>pick(row,["sourceConnectionId","stage","lastAttemptedAt","lastSuccessfulAt","lastErrorCode","updatedCount","failedCount","resumeKeys"])),
    preferences:{...pick(snapshot.preferences,["timeZone","sort","automaticCanvas","automaticGradescope"]),filters:pick(snapshot.preferences.filters,["course","source","search"])},
  };
}

function validateBackup(value:unknown):GuestBackupV1 {
  const backup=backupSchema.parse(value);
  // Apply F1's complete source graph and dataset-size validation without exporting a dataset identity.
  parseGuestSnapshot({schemaVersion:1,datasetId:"00000000-0000-4000-8000-000000000000",revision:0,...backup.data});
  return backup;
}

export function serializeGuestBackup(snapshot:GuestSnapshot,exportedAt:string):string {
  try { return JSON.stringify(validateBackup({schemaVersion:1,exportedAt,data:projectData(snapshot)})); }
  catch { throw new GuestDataError("INVALID_BACKUP"); }
}

export function parseGuestBackup(text:string):GuestBackupV1 {
  if(typeof text!=="string" || new TextEncoder().encode(text).byteLength>GUEST_MAX_IMPORT_BYTES)throw new GuestDataError("INVALID_BACKUP");
  let value:unknown;
  try { value=JSON.parse(text); } catch { throw new GuestDataError("INVALID_BACKUP"); }
  if(value!==null && typeof value==="object" && "schemaVersion" in value && value.schemaVersion!==1)throw new GuestDataError("UNSUPPORTED_BACKUP_VERSION");
  try { return validateBackup(value); } catch { throw new GuestDataError("INVALID_BACKUP"); }
}
