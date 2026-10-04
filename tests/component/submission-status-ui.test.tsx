// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

const harness=vi.hoisted(()=>({
  syncNow:vi.fn(),
  current:{
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"0.2.0",
    canvasTabDetected:true,
    message:"",
    lastAttemptedAt:"2026-10-04T06:00:00.000Z",
    lastSuccessfulAt:"2026-10-04T06:00:00.000Z",
    lastErrorCode:null,
    updatedCount:20,
    failedCount:0,
  },
}));

vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({...harness.current,syncNow:harness.syncNow}),
}));

import { SubmissionStatusBadge } from "@/features/submission-status/submission-status-badge";
import { SubmissionStatusControl } from "@/features/submission-status/submission-status-control";

const base:Omit<AssignmentSubmissionStatus,"state">={
  isLate:false,
  isMissing:false,
  submittedAt:null,
  checkedAt:"2026-10-04T06:00:00.000Z",
  extractorVersion:"canvas-html-v1",
};

afterEach(()=>cleanup());

beforeEach(()=>{
  harness.syncNow.mockReset();
  Object.assign(harness.current,{
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"0.2.0",
    canvasTabDetected:true,
    message:"",
    lastAttemptedAt:"2026-10-04T06:00:00.000Z",
    lastSuccessfulAt:"2026-10-04T06:00:00.000Z",
    lastErrorCode:null,
    updatedCount:20,
    failedCount:0,
  });
});

describe("SubmissionStatusBadge",()=>{
  it.each([
    [null,"Status unavailable"],
    [{...base,state:"unknown"} as AssignmentSubmissionStatus,"Status unavailable"],
    [{...base,state:"not_submitted"} as AssignmentSubmissionStatus,"Not submitted"],
    [{...base,state:"submitted"} as AssignmentSubmissionStatus,"Submitted"],
    [{...base,state:"graded"} as AssignmentSubmissionStatus,"Graded"],
    [{...base,state:"excused"} as AssignmentSubmissionStatus,"Excused"],
    [{...base,state:"submitted",isLate:true} as AssignmentSubmissionStatus,"Submitted · Late"],
    [{...base,state:"not_submitted",isMissing:true} as AssignmentSubmissionStatus,"Not submitted · Missing"],
  ])("renders the normalized status label %#",(status,label)=>{
    render(<SubmissionStatusBadge status={status}/>);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
  });
});

describe("SubmissionStatusControl",()=>{
  it("shows last update and lets the website start a manual submission sync",async()=>{
    const user=userEvent.setup();
    render(<SubmissionStatusControl/>);
    expect(screen.getByText(/Canvas submissions · Updated/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Sync submission status"}));
    expect(harness.syncNow).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{phase:"syncing",message:""},"Syncing submission status…"],
    [{phase:"error",message:"Firefox extension not detected"},"Firefox extension not detected"],
    [{phase:"error",message:"Open Canvas in Firefox, then try again."},"Open Canvas in Firefox, then try again."],
    [{phase:"error",message:"Sign in to Canvas, then retry."},"Sign in to Canvas, then retry."],
    [{phase:"partial",message:"18 of 20 submission statuses updated"},"18 of 20 submission statuses updated"],
  ])("surfaces actionable sync state %#",(patch,label)=>{
    Object.assign(harness.current,patch);
    render(<SubmissionStatusControl/>);
    expect(screen.getByText(label)).toBeInTheDocument();
    if(patch.phase==="syncing"){
      expect(screen.getByRole("button",{name:"Syncing submission status…"})).toBeDisabled();
    }
  });
});
