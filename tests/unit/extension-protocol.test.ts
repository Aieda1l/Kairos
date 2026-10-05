import { describe, expect, it } from "vitest";
import {
  canvasBatchResultV1Schema,
  kairosBridgeRequestV1Schema,
  submissionSyncRequestV1Schema,
  submissionStatusResultV1Schema,
} from "@/lib/extension-protocol/submission-status";
import { kairosBridgeRequestV1Schema } from "@/lib/extension-protocol/bridge";

const locator = {
  assignmentLocalId: "local-1",
  courseId: "999",
  assignmentId: "4242",
};

describe("submission status protocol", () => {
  it("accepts a protocol-v1 sync request with decimal Canvas identifiers", () => {
    const parsed = submissionSyncRequestV1Schema.parse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      assignments: [locator],
    });
    expect(parsed.assignments).toEqual([locator]);
  });

  it("rejects batches larger than 100 and non-decimal identifiers", () => {
    const tooLarge = Array.from({ length: 101 }, (_, index) => ({
      assignmentLocalId: `local-${index}`,
      courseId: "999",
      assignmentId: String(index + 1),
    }));
    expect(submissionSyncRequestV1Schema.safeParse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      assignments: tooLarge,
    }).success).toBe(false);

    expect(submissionSyncRequestV1Schema.safeParse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      assignments: [{ ...locator, assignmentId: "42x" }],
    }).success).toBe(false);
  });

  it("strictly rejects arbitrary URLs, cookies, headers, and page HTML", () => {
    const result = {
      assignmentLocalId: "local-1",
      courseId: "999",
      assignmentId: "4242",
      state: "submitted",
      isLate: false,
      isMissing: false,
      submittedAt: "2026-10-04T05:00:00.000Z",
      checkedAt: "2026-10-04T06:00:00.000Z",
      extractorVersion: "canvas-html-v1",
    };
    expect(submissionStatusResultV1Schema.safeParse({ ...result, url: "https://evil.example" }).success).toBe(false);
    expect(submissionStatusResultV1Schema.safeParse({ ...result, cookie: "secret" }).success).toBe(false);
    expect(submissionStatusResultV1Schema.safeParse({ ...result, headers: { authorization: "secret" } }).success).toBe(false);
    expect(submissionStatusResultV1Schema.safeParse({ ...result, html: "<html>private</html>" }).success).toBe(false);
  });

  it("accepts normalized batch results and rejects extra bridge request fields", () => {
    expect(canvasBatchResultV1Schema.safeParse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      results: [{
        assignmentLocalId: "local-1",
        courseId: "999",
        assignmentId: "4242",
        state: "graded",
        isLate: false,
        isMissing: false,
        submittedAt: null,
        checkedAt: "2026-10-04T06:00:00.000Z",
        extractorVersion: "canvas-html-v1",
      }],
      errorCode: null,
    }).success).toBe(true);

    expect(kairosBridgeRequestV1Schema.safeParse({
      source: "kairos-page",
      type: "PING",
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      url: "https://canvas.uw.edu",
    }).success).toBe(false);
  });
});
