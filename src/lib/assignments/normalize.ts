import type { Assignment } from "./types";
import type { SourceAssignment, SourceKind } from "@/lib/sources/types";

export type NormalizedAssignment = Omit<Assignment, "id" | "firstSeenAt" | "lastSeenAt" | "submissionStatus">;

export function normalizeSourceAssignment(source: SourceKind, input: SourceAssignment): NormalizedAssignment {
  return {
    source,
    externalId: input.externalId,
    courseId: input.courseId,
    courseName: input.courseName || (source === "canvas" ? "Canvas" : source),
    title: input.title,
    releaseAt: input.releaseAt ?? null,
    dueAt: input.dueAt,
    lateDueAt: input.lateDueAt ?? null,
    status: input.status,
    sourceStatusText: input.sourceStatusText ?? null,
    gradeScore: input.gradeScore ?? null,
    gradeMax: input.gradeMax ?? null,
    gradeDisplay: input.gradeDisplay ?? null,
    sourceUrl: input.sourceUrl,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };
}
