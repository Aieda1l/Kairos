// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SubmissionStatusBadge } from "@/features/submission-status/submission-status-badge";
import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

function status(state:AssignmentSubmissionStatus["state"]):AssignmentSubmissionStatus{
  return {
    state,
    isLate:false,
    isMissing:false,
    submittedAt:null,
    checkedAt:"2026-10-04T23:00:00.000Z",
    extractorVersion:"canvas-api-v1",
  };
}

describe("submission status visual treatment",()=>{
  it.each([
    ["not_submitted","Not submitted","--status-not-submitted"],
    ["submitted","Submitted","--status-submitted"],
    ["graded","Graded","--status-graded"],
    ["excused","Excused","--status-excused"],
    ["unknown","Status unavailable","--status-unavailable"],
  ] as const)("color-codes %s consistently",(state,label,colorToken)=>{
    render(<SubmissionStatusBadge status={status(state)}/>);
    const badge=screen.getByText(label);
    expect(badge).toHaveAttribute("data-submission-state",state);
    expect(badge.className).toContain(colorToken);
  });

  it("uses the unavailable visual treatment when no status exists",()=>{
    render(<SubmissionStatusBadge status={null}/>);
    const badge=screen.getByText("Status unavailable");
    expect(badge).toHaveAttribute("data-submission-state","unknown");
    expect(badge.className).toContain("--status-unavailable");
  });
});
