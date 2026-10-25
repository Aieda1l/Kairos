import { z } from "zod";
import { guestApiErrorCodeSchema } from "../errors";
import {
  guestCountSchema,guestDecimalIdSchema,guestDiscoveredCourseSchema,guestNormalizedAssignmentSchema,
  guestUtcDateSchema,guestUuidSchema,isGuestSourceUrl,
} from "../schema";
import * as limits from "../limits";

const requestFields={schemaVersion:z.literal(1),requestId:guestUuidSchema};
const successFields={ok:z.literal(true),...requestFields,checkedAt:guestUtcDateSchema};
const secretSchema=z.string().min(1).max(limits.GUEST_MAX_SECRET_CHARACTERS);
function boundedJson<T extends z.ZodType>(schema:T,bytes:number){
  return schema.refine(value=>limits.guestJsonBytes(value)<=bytes,"Guest payload exceeds the byte limit.");
}

export const guestCanvasFeedRequestSchema=boundedJson(z.object({...requestFields,feedUrl:secretSchema}).strict(),limits.GUEST_MAX_REQUEST_BYTES);
export const guestEdCoursesRequestSchema=boundedJson(z.object({...requestFields,token:secretSchema}).strict(),limits.GUEST_MAX_REQUEST_BYTES);
export const guestEdLessonsRequestSchema=boundedJson(z.object({...requestFields,token:secretSchema,courseId:guestDecimalIdSchema}).strict(),limits.GUEST_MAX_REQUEST_BYTES);

const canvasAssignmentSchema=z.object({...guestNormalizedAssignmentSchema.shape,source:z.literal("canvas")}).strict()
  .refine(row=>isGuestSourceUrl(row.sourceUrl,row.source,row.courseId),"Unsupported Canvas assignment URL.");
const {courseName,...lessonFields}=guestNormalizedAssignmentSchema.shape;
void courseName;
const edLessonSchema=z.object({...lessonFields,source:z.literal("ed"),courseId:guestDecimalIdSchema,sourceUrl:z.null()}).strict();
const canvasReportSchema=z.object({
  skippedCount:guestCountSchema.max(limits.GUEST_CANVAS_MAX_EVENT_BLOCKS),
  malformedCount:guestCountSchema.max(limits.GUEST_CANVAS_MAX_EVENT_BLOCKS),partial:z.boolean(),
}).strict().refine(report=>report.malformedCount<=report.skippedCount && report.partial===(report.malformedCount>0),"Invalid Canvas parse counts.");

export const guestCanvasFeedResponseSchema=boundedJson(z.object({
  ...successFields,assignments:z.array(canvasAssignmentSchema).max(limits.GUEST_CANVAS_MAX_ASSIGNMENTS),report:canvasReportSchema,
}).strict().superRefine((result,ctx)=>{
  if(new Set(result.assignments.map(row=>row.externalId)).size!==result.assignments.length)ctx.addIssue({code:"custom",message:"Duplicate assignment identity."});
  if(result.assignments.length+result.report.skippedCount>limits.GUEST_CANVAS_MAX_EVENT_BLOCKS)ctx.addIssue({code:"custom",message:"Too many Canvas event blocks."});
}),limits.GUEST_CANVAS_MAX_OUTPUT_BYTES);
export const guestEdCoursesResponseSchema=boundedJson(z.object({
  ...successFields,courses:z.array(guestDiscoveredCourseSchema).max(limits.GUEST_ED_MAX_COURSES),
}).strict().refine(result=>new Set(result.courses.map(course=>course.externalCourseId)).size===result.courses.length,"Duplicate course identity."),limits.GUEST_ED_COURSES_MAX_OUTPUT_BYTES);
export const guestEdLessonsResponseSchema=boundedJson(z.object({
  ...successFields,courseId:guestDecimalIdSchema,lessons:z.array(edLessonSchema).max(limits.GUEST_ED_MAX_VISIBLE_LESSONS),
}).strict().superRefine((result,ctx)=>{
  if(result.lessons.some(lesson=>lesson.courseId!==result.courseId))ctx.addIssue({code:"custom",message:"Lesson course does not match the requested course."});
  if(new Set(result.lessons.map(lesson=>lesson.externalId)).size!==result.lessons.length)ctx.addIssue({code:"custom",message:"Duplicate lesson identity."});
}),limits.GUEST_ED_LESSONS_MAX_OUTPUT_BYTES);

export const guestSessionRequestSchema=boundedJson(z.object({...requestFields,turnstileToken:secretSchema}).strict(),limits.GUEST_MAX_REQUEST_BYTES);
export const guestSessionResponseSchema=z.object({...successFields,expiresAt:guestUtcDateSchema}).strict()
  .refine(result=>Date.parse(result.expiresAt)>Date.parse(result.checkedAt),"Session expiry must follow admission.");
export const guestSessionEndRequestSchema=z.object({}).strict();
export const guestApiErrorSchema=z.object({ok:z.literal(false),...requestFields,code:guestApiErrorCodeSchema}).strict();

export type GuestCanvasFeedRequest=z.infer<typeof guestCanvasFeedRequestSchema>;
export type GuestCanvasFeedResponse=z.infer<typeof guestCanvasFeedResponseSchema>;
export type GuestEdCoursesRequest=z.infer<typeof guestEdCoursesRequestSchema>;
export type GuestEdCoursesResponse=z.infer<typeof guestEdCoursesResponseSchema>;
export type GuestEdLessonsRequest=z.infer<typeof guestEdLessonsRequestSchema>;
export type GuestEdLessonsResponse=z.infer<typeof guestEdLessonsResponseSchema>;
export type GuestSessionRequest=z.infer<typeof guestSessionRequestSchema>;
export type GuestSessionResponse=z.infer<typeof guestSessionResponseSchema>;
export type GuestSessionEndRequest=z.infer<typeof guestSessionEndRequestSchema>;
export type GuestApiError=z.infer<typeof guestApiErrorSchema>;
