import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const submissionSyncErrorCodeSchema = z.enum([
  "EXTENSION_UNAVAILABLE",
  "EXTENSION_TIMEOUT",
  "CANVAS_TAB_UNAVAILABLE",
  "CANVAS_SIGNED_OUT",
  "CANVAS_NETWORK_ERROR",
  "UNRECOGNIZED_STATUS",
  "PARTIAL_SYNC",
  "INVALID_RESULT",
]);

export const submissionStateSchema = z.enum([
  "unknown",
  "not_submitted",
  "submitted",
  "graded",
  "excused",
]);

export const canvasAssignmentLocatorSchema = z
  .object({
    assignmentLocalId: z.string().min(1),
    courseId: z.string().regex(/^\d+$/),
    assignmentId: z.string().regex(/^\d+$/),
  })
  .strict();

export const submissionSyncRequestV1Schema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    assignments: z.array(canvasAssignmentLocatorSchema).max(100),
  })
  .strict();

export const submissionStatusResultV1Schema = z
  .object({
    assignmentLocalId: z.string().min(1),
    courseId: z.string().regex(/^\d+$/),
    assignmentId: z.string().regex(/^\d+$/),
    state: submissionStateSchema,
    isLate: z.boolean(),
    isMissing: z.boolean(),
    submittedAt: z.string().datetime().nullable(),
    checkedAt: z.string().datetime(),
    extractorVersion: z.string().min(1),
    errorCode: submissionSyncErrorCodeSchema.optional(),
  })
  .strict();

export const canvasBatchResultV1Schema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    results: z.array(submissionStatusResultV1Schema).max(100),
    errorCode: submissionSyncErrorCodeSchema.nullable().optional(),
  })
  .strict();

const pingRequestSchema = z
  .object({
    source: z.literal("kairos-page"),
    type: z.literal("PING"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
  })
  .strict();

const syncRequestSchema = z
  .object({
    source: z.literal("kairos-page"),
    type: z.literal("SYNC_SUBMISSION_STATUS"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    payload: submissionSyncRequestV1Schema,
  })
  .strict();

export const kairosBridgeRequestV1Schema = z.discriminatedUnion("type", [
  pingRequestSchema,
  syncRequestSchema,
]);

const pongResponseSchema = z
  .object({
    source: z.literal("kairos-extension"),
    type: z.literal("PONG"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    extensionVersion: z.string().min(1),
    canvasTabDetected: z.boolean(),
  })
  .strict();

const syncResponseSchema = z
  .object({
    source: z.literal("kairos-extension"),
    type: z.literal("SYNC_SUBMISSION_STATUS_RESULT"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    payload: canvasBatchResultV1Schema,
  })
  .strict();

const errorResponseSchema = z
  .object({
    source: z.literal("kairos-extension"),
    type: z.literal("ERROR"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    errorCode: submissionSyncErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const kairosBridgeResponseV1Schema = z.discriminatedUnion("type", [
  pongResponseSchema,
  syncResponseSchema,
  errorResponseSchema,
]);

export type SubmissionSyncRequestV1 = z.infer<typeof submissionSyncRequestV1Schema>;
export type SubmissionStatusResultV1 = z.infer<typeof submissionStatusResultV1Schema>;
export type CanvasBatchResultV1 = z.infer<typeof canvasBatchResultV1Schema>;
export type KairosBridgeRequestV1 = z.infer<typeof kairosBridgeRequestV1Schema>;
export type KairosBridgeResponseV1 = z.infer<typeof kairosBridgeResponseV1Schema>;
export type SubmissionSyncErrorCode = z.infer<typeof submissionSyncErrorCodeSchema>;
