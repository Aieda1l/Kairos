import type { Assignment } from "@/lib/assignments/types";
import type { CanvasAssignmentLocator } from "./types";

const DECIMAL_ID = /^\d+$/;

export function parseCanvasAssignmentLocator(
  assignment: Pick<Assignment, "id" | "source" | "courseId" | "sourceUrl">,
): CanvasAssignmentLocator | null {
  if (
    assignment.source !== "canvas" ||
    !assignment.courseId ||
    !DECIMAL_ID.test(assignment.courseId) ||
    !assignment.sourceUrl
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(assignment.sourceUrl);
  } catch {
    return null;
  }

  const pathMatch = url.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
  if (pathMatch) {
    const [, pathCourseId, assignmentId] = pathMatch;
    if (pathCourseId !== assignment.courseId) return null;
    return {
      assignmentLocalId: assignment.id,
      courseId: assignment.courseId,
      assignmentId,
    };
  }

  const fragmentMatch = url.hash.match(/^#assignment_(\d+)$/);
  if (!fragmentMatch) return null;

  return {
    assignmentLocalId: assignment.id,
    courseId: assignment.courseId,
    assignmentId: fragmentMatch[1],
  };
}
