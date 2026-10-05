import { z } from "zod";
import { PROTOCOL_VERSION, submissionStateSchema } from "./submission-status";

const decimalIdSchema=z.string().regex(/^\d+$/);
const decimalGradeSchema=z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const gradescopeSyncErrorCodeSchema=z.enum([
  "EXTENSION_UNAVAILABLE",
  "EXTENSION_TIMEOUT",
  "GRADESCOPE_TAB_UNAVAILABLE",
  "GRADESCOPE_SIGNED_OUT",
  "GRADESCOPE_NETWORK_ERROR",
  "GRADESCOPE_COURSE_UNAVAILABLE",
  "GRADESCOPE_PARSE_ERROR",
  "PARTIAL_SYNC",
  "INVALID_RESULT",
]);

export const gradescopeDiagnosticCodeSchema=z.enum([
  "FETCH_EXCEPTION",
  "HTTP_429",
  "HTTP_5XX",
  "HTTP_OTHER",
  "UNRECOGNIZED_ROW",
  "MISSING_STABLE_ID",
]);

export const gradescopeDiscoveryDiagnosticsV1Schema=z.object({
  accountRootDetected:z.boolean(),
  createCourseControlDetected:z.boolean(),
  headings:z.object({
    courses:z.number().int().nonnegative(),
    studentCourses:z.number().int().nonnegative(),
    instructorCourses:z.number().int().nonnegative(),
    other:z.number().int().nonnegative(),
  }).strict(),
  courseListDescendantCount:z.number().int().nonnegative(),
  courseListDirectCount:z.number().int().nonnegative(),
  termDescendantCount:z.number().int().nonnegative(),
  courseAnchorDescendantCount:z.number().int().nonnegative(),
  courseHrefContainsCount:z.number().int().nonnegative(),
  shortNameNodeCount:z.number().int().nonnegative(),
  fullNameNodeCount:z.number().int().nonnegative(),
  reactPropsNodeCount:z.number().int().nonnegative(),
}).strict();

export const gradescopeCourseV1Schema=z.object({
  courseId:decimalIdSchema,
  shortName:z.string().trim().min(1).max(160).nullable(),
  fullName:z.string().trim().min(1).max(240),
  term:z.string().trim().min(1).max(80).nullable(),
  year:z.string().trim().min(1).max(16).nullable(),
}).strict();

export const gradescopeAssignmentV1Schema=z.object({
  courseId:decimalIdSchema,
  assignmentId:decimalIdSchema,
  title:z.string().trim().min(1).max(500),
  releaseAt:z.string().datetime().nullable(),
  dueAt:z.string().datetime().nullable(),
  lateDueAt:z.string().datetime().nullable(),
  sourceStatusText:z.string().trim().max(500).nullable(),
  state:submissionStateSchema,
  isLate:z.boolean(),
  isMissing:z.boolean(),
  submittedAt:z.string().datetime().nullable(),
  gradeScore:decimalGradeSchema.nullable(),
  gradeMax:decimalGradeSchema.nullable(),
  gradeDisplay:z.string().trim().max(200).nullable(),
  checkedAt:z.string().datetime(),
  extractorVersion:z.string().min(1).max(80),
}).strict();

export const gradescopeDiscoverRequestV1Schema=z.object({
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
}).strict();

export const gradescopeDiscoverResultV1Schema=z.object({
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  courses:z.array(gradescopeCourseV1Schema).max(50),
  errorCode:gradescopeSyncErrorCodeSchema.nullable().optional(),
  diagnosticCode:gradescopeDiagnosticCodeSchema.optional(),
  httpStatus:z.number().int().min(100).max(599).optional(),
  discoveryDiagnostics:gradescopeDiscoveryDiagnosticsV1Schema.optional(),
}).strict();

export const gradescopeSyncRequestV1Schema=z.object({
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  courseIds:z.array(decimalIdSchema).max(20).refine(
    values=>new Set(values).size===values.length,
    "Course identifiers must be unique.",
  ),
}).strict();

export const gradescopeCourseSyncResultV1Schema=z.object({
  courseId:decimalIdSchema,
  checkedAt:z.string().datetime(),
  assignments:z.array(gradescopeAssignmentV1Schema).max(500),
  errorCode:gradescopeSyncErrorCodeSchema.nullable().optional(),
  diagnosticCode:gradescopeDiagnosticCodeSchema.optional(),
  httpStatus:z.number().int().min(100).max(599).optional(),
  parseDiagnosticCounts:z.array(z.object({
    code:z.enum(["UNRECOGNIZED_ROW","MISSING_STABLE_ID"]),
    count:z.number().int().positive(),
  }).strict()).default([]),
}).strict();

export const gradescopeSyncResultV1Schema=z.object({
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  courses:z.array(gradescopeCourseSyncResultV1Schema).max(20),
  errorCode:gradescopeSyncErrorCodeSchema.nullable().optional(),
}).strict().superRefine((value,ctx)=>{
  const total=value.courses.reduce((sum,course)=>sum+course.assignments.length,0);
  if(total>500){
    ctx.addIssue({
      code:"custom",
      message:"Gradescope sync results may contain at most 500 assignments.",
      path:["courses"],
    });
  }
});

const gradescopeDiscoverBridgeRequestV1Schema=z.object({
  source:z.literal("kairos-page"),
  type:z.literal("GRADESCOPE_DISCOVER_COURSES"),
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  payload:gradescopeDiscoverRequestV1Schema,
}).strict();

const gradescopeSyncBridgeRequestV1Schema=z.object({
  source:z.literal("kairos-page"),
  type:z.literal("GRADESCOPE_SYNC_ASSIGNMENTS"),
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  payload:gradescopeSyncRequestV1Schema,
}).strict();

export const gradescopeBridgeRequestV1Schema=z.discriminatedUnion("type",[
  gradescopeDiscoverBridgeRequestV1Schema,
  gradescopeSyncBridgeRequestV1Schema,
]);

const gradescopeDiscoverBridgeResponseV1Schema=z.object({
  source:z.literal("kairos-extension"),
  type:z.literal("GRADESCOPE_DISCOVER_COURSES_RESULT"),
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  payload:gradescopeDiscoverResultV1Schema,
}).strict();

const gradescopeSyncBridgeResponseV1Schema=z.object({
  source:z.literal("kairos-extension"),
  type:z.literal("GRADESCOPE_SYNC_ASSIGNMENTS_RESULT"),
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  payload:gradescopeSyncResultV1Schema,
}).strict();

const gradescopeErrorBridgeResponseV1Schema=z.object({
  source:z.literal("kairos-extension"),
  type:z.literal("ERROR"),
  protocolVersion:z.literal(PROTOCOL_VERSION),
  requestId:z.string().uuid(),
  errorCode:gradescopeSyncErrorCodeSchema,
  message:z.string().min(1),
}).strict();

export const gradescopeBridgeResponseV1Schema=z.discriminatedUnion("type",[
  gradescopeDiscoverBridgeResponseV1Schema,
  gradescopeSyncBridgeResponseV1Schema,
  gradescopeErrorBridgeResponseV1Schema,
]);

export type GradescopeDiscoveryDiagnosticsV1=z.infer<typeof gradescopeDiscoveryDiagnosticsV1Schema>;
export type GradescopeCourseV1=z.infer<typeof gradescopeCourseV1Schema>;
export type GradescopeAssignmentV1=z.infer<typeof gradescopeAssignmentV1Schema>;
export type GradescopeDiscoverRequestV1=z.infer<typeof gradescopeDiscoverRequestV1Schema>;
export type GradescopeDiscoverResultV1=z.infer<typeof gradescopeDiscoverResultV1Schema>;
export type GradescopeSyncRequestV1=z.infer<typeof gradescopeSyncRequestV1Schema>;
export type GradescopeCourseSyncResultV1=z.infer<typeof gradescopeCourseSyncResultV1Schema>;
export type GradescopeSyncResultV1=z.infer<typeof gradescopeSyncResultV1Schema>;
export type GradescopeSyncErrorCode=z.infer<typeof gradescopeSyncErrorCodeSchema>;
export type GradescopeDiagnosticCode=z.infer<typeof gradescopeDiagnosticCodeSchema>;
