import type { SourceKind } from "@/lib/sources/types";
import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

export type AssignmentStatus = "pending" | "submitted" | "graded" | "overdue" | "unknown";

export type Assignment = {
  id: string;
  source: SourceKind;
  externalId: string;
  courseId: string | null;
  courseName: string;
  title: string;
  releaseAt: string | null;
  dueAt: string | null;
  lateDueAt: string | null;
  status: AssignmentStatus;
  sourceStatusText: string | null;
  gradeScore: string | null;
  gradeMax: string | null;
  gradeDisplay: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  submissionStatus: AssignmentSubmissionStatus | null;
};

export type SourceConnection = {
  id: string;
  kind: SourceKind;
  label: string;
  enabled: boolean;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncStatus: "never" | "success" | "error";
  lastErrorCode: string | null;
};
