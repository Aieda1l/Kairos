import { z } from "zod";
import { submissionStateSchema } from "@/lib/extension-protocol/submission-status";
import { guestSafeCodeSchema } from "./errors";
import * as limits from "./limits";
import type { GuestSnapshot } from "./types";

export const guestUuidSchema=z.string().uuid();
export const guestCountSchema=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const guestUtcDateSchema=z.iso.datetime();
export const guestDecimalIdSchema=z.string().min(1).max(limits.GUEST_MAX_DECIMAL_ID_CHARACTERS).regex(/^\d+$/);
export const guestExternalIdSchema=z.string().min(1).max(limits.GUEST_MAX_EXTERNAL_ID_CHARACTERS);
export const guestSourceKindSchema=z.enum(["canvas","gradescope","ed"]);
export const guestStageSchema=z.enum(["canvas-feed","canvas-status","gradescope","ed"]);

function validTimeZone(value:string):boolean {
  if(/^[+-]/.test(value))return false;
  try{new Intl.DateTimeFormat("en-US",{timeZone:value});return true;}catch{return false;}
}

export const guestPreferencesSchema=z.object({
  timeZone:z.string().min(1).max(128).refine(validTimeZone,"Invalid IANA timezone."),
  filters:z.object({course:z.string().max(limits.GUEST_MAX_COURSE_NAME_CHARACTERS),source:z.enum(["","canvas","gradescope","ed"]),search:z.string().max(limits.GUEST_MAX_SEARCH_CHARACTERS)}).strict(),
  sort:z.enum(["due","status"]),automaticCanvas:z.boolean(),automaticGradescope:z.boolean(),
}).strict();

/** Supported, canonical public assignment links only; secret-bearing feed URLs never enter rows. */
export function isGuestSourceUrl(value:string|null,source:"canvas"|"gradescope"|"ed",courseId:string|null):boolean {
  if(value===null)return true;
  if(source==="ed")return false;
  try{
    const url=new URL(value);
    const origin=source==="canvas"?"https://canvas.uw.edu":"https://www.gradescope.com";
    if(url.origin!==origin || url.username || url.password || url.search || url.hash || url.port || value!==`${origin}${url.pathname}`)return false;
    const match=url.pathname.match(/^\/courses\/(\d{1,32})\/assignments\/(\d{1,32})$/);
    return match!==null && (courseId===null || match[1]===courseId);
  }catch{return false;}
}

export const guestNormalizedAssignmentSchema=z.object({
  source:guestSourceKindSchema,externalId:guestExternalIdSchema,courseId:guestDecimalIdSchema.nullable(),
  courseName:z.string().min(1).max(limits.GUEST_MAX_COURSE_NAME_CHARACTERS),
  title:z.string().min(1).max(limits.GUEST_MAX_TITLE_CHARACTERS),
  releaseAt:guestUtcDateSchema.nullable(),dueAt:guestUtcDateSchema.nullable(),lateDueAt:guestUtcDateSchema.nullable(),
  status:z.enum(["pending","submitted","graded","overdue","unknown"]),
  sourceStatusText:z.string().max(limits.GUEST_MAX_STATUS_TEXT_CHARACTERS).nullable(),
  gradeScore:z.string().max(limits.GUEST_MAX_GRADE_VALUE_CHARACTERS).nullable(),gradeMax:z.string().max(limits.GUEST_MAX_GRADE_VALUE_CHARACTERS).nullable(),
  gradeDisplay:z.string().max(limits.GUEST_MAX_GRADE_CHARACTERS).nullable(),
  sourceUrl:z.string().max(limits.GUEST_MAX_URL_CHARACTERS).nullable(),sourceUpdatedAt:guestUtcDateSchema.nullable(),
}).strict().superRefine((row,ctx)=>{
  if(!isGuestSourceUrl(row.sourceUrl,row.source,row.courseId))ctx.addIssue({code:"custom",message:"Unsupported source URL.",path:["sourceUrl"]});
  if(row.source!=="canvas" && row.courseId===null)ctx.addIssue({code:"custom",message:"Course identity is required.",path:["courseId"]});
});

export const guestConnectionSchema=z.object({
  id:guestUuidSchema,kind:guestSourceKindSchema,enabled:z.boolean(),generation:guestCountSchema,
  createdAt:guestUtcDateSchema,updatedAt:guestUtcDateSchema,
}).strict();
export const guestDiscoveredCourseSchema=z.object({
  externalCourseId:guestDecimalIdSchema,shortName:z.string().min(1).max(limits.GUEST_MAX_SHORT_NAME_CHARACTERS).nullable(),
  fullName:z.string().min(1).max(limits.GUEST_MAX_COURSE_NAME_CHARACTERS),
  term:z.string().min(1).max(limits.GUEST_MAX_TERM_CHARACTERS).nullable(),year:z.string().min(1).max(limits.GUEST_MAX_YEAR_CHARACTERS).nullable(),
}).strict();
export const guestCourseSchema=guestDiscoveredCourseSchema.extend({
  id:guestUuidSchema,sourceConnectionId:guestUuidSchema,enabled:z.boolean(),firstSeenAt:guestUtcDateSchema,lastSeenAt:guestUtcDateSchema,
}).strict();
export const guestAssignmentRecordSchema=guestNormalizedAssignmentSchema.safeExtend({
  id:guestUuidSchema,sourceConnectionId:guestUuidSchema,metadataCheckedAt:guestUtcDateSchema.nullable(),firstSeenAt:guestUtcDateSchema,lastSeenAt:guestUtcDateSchema,
}).strict();
export const guestSubmissionStatusSchema=z.object({
  state:submissionStateSchema,isLate:z.boolean(),isMissing:z.boolean(),submittedAt:guestUtcDateSchema.nullable(),
  checkedAt:guestUtcDateSchema,extractorVersion:z.string().min(1).max(limits.GUEST_MAX_EXTRACTOR_VERSION_CHARACTERS),
}).strict();
export const guestStatusRecordSchema=guestSubmissionStatusSchema.extend({assignmentId:guestUuidSchema}).strict();
export const guestSyncStateSchema=z.object({
  sourceConnectionId:guestUuidSchema,stage:guestStageSchema,lastAttemptedAt:guestUtcDateSchema.nullable(),lastSuccessfulAt:guestUtcDateSchema.nullable(),
  lastErrorCode:guestSafeCodeSchema.nullable(),updatedCount:guestCountSchema,failedCount:guestCountSchema,
  resumeKeys:z.array(guestExternalIdSchema).max(limits.GUEST_MAX_ASSIGNMENTS),
}).strict();

export const guestSnapshotSchema=z.object({
  schemaVersion:z.literal(1),datasetId:guestUuidSchema,revision:guestCountSchema,
  connections:z.array(guestConnectionSchema).max(3),courses:z.array(guestCourseSchema).max(limits.GUEST_MAX_COURSES),
  assignments:z.array(guestAssignmentRecordSchema).max(limits.GUEST_MAX_ASSIGNMENTS),statuses:z.array(guestStatusRecordSchema).max(limits.GUEST_MAX_STATUSES),
  syncStates:z.array(guestSyncStateSchema).max(4),preferences:guestPreferencesSchema,
}).strict().superRefine((snapshot,ctx)=>{
  const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:"custom",path,message});
  const ids=new Set<string>();
  const unique=(id:string,path:(string|number)[])=>{if(ids.has(id))issue(path,"Duplicate local identity.");ids.add(id);};
  const kinds=new Set<string>();
  const connections=new Map(snapshot.connections.map((connection,index)=>{
    unique(connection.id,["connections",index,"id"]);
    if(kinds.has(connection.kind))issue(["connections",index,"kind"],"Duplicate source kind.");
    kinds.add(connection.kind);return [connection.id,connection];
  }));
  const courses=new Set<string>();
  snapshot.courses.forEach((course,index)=>{
    unique(course.id,["courses",index,"id"]);
    if(!connections.has(course.sourceConnectionId))issue(["courses",index,"sourceConnectionId"],"Unknown source connection.");
    const key=JSON.stringify([course.sourceConnectionId,course.externalCourseId]);
    if(courses.has(key))issue(["courses",index],"Duplicate course identity.");courses.add(key);
  });
  const assignmentIds=new Set(snapshot.assignments.map(row=>row.id));
  const assignmentKeys=new Set<string>();
  const assignmentsByConnection=new Map<string,Set<string>>();
  snapshot.assignments.forEach((row,index)=>{
    unique(row.id,["assignments",index,"id"]);
    if(connections.get(row.sourceConnectionId)?.kind!==row.source)issue(["assignments",index,"sourceConnectionId"],"Assignment source does not match its connection.");
    if(row.source!=="canvas" && !courses.has(JSON.stringify([row.sourceConnectionId,row.courseId])))issue(["assignments",index,"courseId"],"Unknown course for this connection.");
    const key=JSON.stringify([row.sourceConnectionId,row.externalId]);
    if(assignmentKeys.has(key))issue(["assignments",index],"Duplicate assignment identity.");assignmentKeys.add(key);
    const members=assignmentsByConnection.get(row.sourceConnectionId)??new Set<string>();members.add(row.externalId);assignmentsByConnection.set(row.sourceConnectionId,members);
  });
  const statusIds=new Set<string>();
  snapshot.statuses.forEach((status,index)=>{
    if(!assignmentIds.has(status.assignmentId))issue(["statuses",index,"assignmentId"],"Unknown assignment.");
    if(statusIds.has(status.assignmentId))issue(["statuses",index],"Duplicate assignment status.");statusIds.add(status.assignmentId);
  });
  const states=new Set<string>();
  snapshot.syncStates.forEach((state,index)=>{
    const kind=connections.get(state.sourceConnectionId)?.kind;
    const expected=state.stage.startsWith("canvas-")?"canvas":state.stage;
    if(kind!==expected)issue(["syncStates",index,"stage"],"Stage does not match its connection.");
    const key=JSON.stringify([state.sourceConnectionId,state.stage]);
    if(states.has(key))issue(["syncStates",index],"Duplicate source stage.");states.add(key);
    const remaining=new Set<string>();
    state.resumeKeys.forEach((member,memberIndex)=>{
      const valid=state.stage==="canvas-status"?assignmentsByConnection.get(state.sourceConnectionId)?.has(member):
        state.stage!=="canvas-feed" && courses.has(JSON.stringify([state.sourceConnectionId,member]));
      if(!valid || remaining.has(member))issue(["syncStates",index,"resumeKeys",memberIndex],"Invalid remaining source member.");remaining.add(member);
    });
  });
  if(limits.guestJsonBytes(snapshot)>limits.GUEST_MAX_DATASET_BYTES)issue([],"Guest dataset exceeds the byte limit.");
});

export function parseGuestSnapshot(value:unknown):GuestSnapshot {
  return guestSnapshotSchema.parse(value);
}
