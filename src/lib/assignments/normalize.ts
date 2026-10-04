import type { Assignment } from "./types";
import type { SourceAssignment, SourceKind } from "@/lib/sources/types";

export type NormalizedAssignment = Omit<Assignment, "id" | "firstSeenAt" | "lastSeenAt">;

export function normalizeSourceAssignment(source: SourceKind, input: SourceAssignment): NormalizedAssignment {
  return {
    source,
    externalId: input.externalId,
    courseId: input.courseId,
    courseName: input.courseName || "Canvas",
    title: input.title,
    dueAt: input.dueAt,
    status: input.status,
    sourceUrl: input.sourceUrl,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };
}
