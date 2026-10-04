import { describe, expect, it } from "vitest";
import { parseCanvasAssignmentLocator } from "@/lib/submission-status/canvas-locator";

describe("parseCanvasAssignmentLocator", () => {
  it("derives numeric Canvas course and assignment identifiers from a known Canvas assignment", () => {
    expect(parseCanvasAssignmentLocator({
      id: "local-1",
      source: "canvas",
      courseId: "999",
      sourceUrl: "http://127.0.0.1:3000/courses/999/assignments/4242",
    })).toEqual({
      assignmentLocalId: "local-1",
      courseId: "999",
      assignmentId: "4242",
    });
  });

  it("supports the Canvas calendar assignment fragment without forwarding its URL", () => {
    expect(parseCanvasAssignmentLocator({
      id: "local-2",
      source: "canvas",
      courseId: "999",
      sourceUrl: "https://canvas.uw.edu/calendar?include_contexts=course_999#assignment_4242",
    })).toEqual({
      assignmentLocalId: "local-2",
      courseId: "999",
      assignmentId: "4242",
    });
  });

  it("rejects non-numeric, mismatched, non-Canvas, and assignment-less locators", () => {
    expect(parseCanvasAssignmentLocator({
      id: "bad-course",
      source: "canvas",
      courseId: "abc",
      sourceUrl: "https://canvas.uw.edu/courses/abc/assignments/1",
    })).toBeNull();

    expect(parseCanvasAssignmentLocator({
      id: "mismatch",
      source: "canvas",
      courseId: "999",
      sourceUrl: "https://canvas.uw.edu/courses/1000/assignments/4242",
    })).toBeNull();

    expect(parseCanvasAssignmentLocator({
      id: "not-canvas",
      source: "gradescope",
      courseId: "999",
      sourceUrl: "https://canvas.uw.edu/courses/999/assignments/4242",
    })).toBeNull();

    expect(parseCanvasAssignmentLocator({
      id: "missing-assignment",
      source: "canvas",
      courseId: "999",
      sourceUrl: "https://canvas.uw.edu/calendar?include_contexts=course_999",
    })).toBeNull();
  });
});
