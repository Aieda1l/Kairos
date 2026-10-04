import type { AssignmentStatus } from "@/lib/assignments/types";

export type SourceKind = "canvas" | "gradescope" | "ed";

export type SourceAssignment = {
  externalId: string;
  courseId: string | null;
  courseName: string;
  title: string;
  dueAt: string | null;
  status: AssignmentStatus;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
};

export type ConnectionResult =
  | { ok: true; itemCount: number }
  | { ok: false; code: string; message: string };

export interface AssignmentSource {
  readonly kind: SourceKind;
  testConnection(): Promise<ConnectionResult>;
  sync(): Promise<SourceAssignment[]>;
}
