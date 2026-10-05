export type SubmissionState =
  | "unknown"
  | "not_submitted"
  | "submitted"
  | "graded"
  | "excused";

export type AssignmentSubmissionStatus = {
  state: SubmissionState;
  isLate: boolean;
  isMissing: boolean;
  submittedAt: string | null;
  checkedAt: string;
  extractorVersion: string;
};

export type SubmissionSyncErrorCode =
  | "EXTENSION_UNAVAILABLE"
  | "EXTENSION_TIMEOUT"
  | "CANVAS_TAB_UNAVAILABLE"
  | "CANVAS_SIGNED_OUT"
  | "CANVAS_NETWORK_ERROR"
  | "UNRECOGNIZED_STATUS"
  | "PARTIAL_SYNC"
  | "INVALID_RESULT";

export type SubmissionStatusWrite = AssignmentSubmissionStatus & {
  assignmentLocalId: string;
  errorCode?: SubmissionSyncErrorCode;
};

export type SubmissionStatusSyncState<TError extends string = SubmissionSyncErrorCode> = {
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorCode: TError | null;
  updatedCount: number;
  failedCount: number;
};

export type CanvasAssignmentLocator = {
  assignmentLocalId: string;
  courseId: string;
  assignmentId: string;
};
