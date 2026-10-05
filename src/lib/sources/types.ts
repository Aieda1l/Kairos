import type { AssignmentStatus } from "@/lib/assignments/types";

export type SourceKind = "canvas" | "gradescope" | "ed";

export type SourceAssignment = {
  externalId: string;
  courseId: string | null;
  courseName: string;
  title: string;
  releaseAt?: string | null;
  dueAt: string | null;
  lateDueAt?: string | null;
  status: AssignmentStatus;
  sourceStatusText?: string | null;
  gradeScore?: string | null;
  gradeMax?: string | null;
  gradeDisplay?: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
};

export type SourceCourse = {
  id: string;
  sourceConnectionId: string;
  externalCourseId: string;
  shortName: string | null;
  fullName: string;
  term: string | null;
  year: string | null;
  enabled: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type DiscoveredSourceCourse = {
  externalCourseId: string;
  shortName: string | null;
  fullName: string;
  term: string | null;
  year: string | null;
};

export type ConnectionResult =
  | { ok: true; itemCount: number }
  | { ok: false; code: string; message: string };

export interface AssignmentSource {
  readonly kind: SourceKind;
  testConnection(): Promise<ConnectionResult>;
  sync(): Promise<SourceAssignment[]>;
}
