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
  | "GRADESCOPE_TAB_UNAVAILABLE"
  | "GRADESCOPE_SIGNED_OUT"
  | "GRADESCOPE_NETWORK_ERROR"
  | "GRADESCOPE_COURSE_UNAVAILABLE"
  | "GRADESCOPE_PARSE_ERROR"
  | "PARTIAL_SYNC"
  | "INVALID_RESULT";

export type SubmissionStatusWrite = AssignmentSubmissionStatus & {
  assignmentLocalId: string;
  errorCode?: SubmissionSyncErrorCode;
};

export type SubmissionStatusSyncState = {
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorCode: SubmissionSyncErrorCode | null;
  updatedCount: number;
  failedCount: number;
};

export type CanvasAssignmentLocator = {
  assignmentLocalId: string;
  courseId: string;
  assignmentId: string;
};
