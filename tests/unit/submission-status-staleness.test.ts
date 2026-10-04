import { describe, expect, it } from "vitest";
import { isSubmissionStatusStale } from "@/features/submission-status/submission-status-provider";

describe("isSubmissionStatusStale",()=>{
  const now=new Date("2026-10-04T06:00:00.000Z");

  it("treats never-synced status as stale",()=>{
    expect(isSubmissionStatusStale(null,now)).toBe(true);
  });

  it("keeps a status fresh until the full 15-minute threshold",()=>{
    expect(isSubmissionStatusStale("2026-10-04T05:45:01.000Z",now)).toBe(false);
  });

  it("refreshes at exactly 15 minutes old",()=>{
    expect(isSubmissionStatusStale("2026-10-04T05:45:00.000Z",now)).toBe(true);
  });
});
