import { describe, expect, it } from "vitest";
import { extractCanvasApiSubmissionStatus } from "../src/canvas/extract-api-status";

const locator={assignmentLocalId:"local-1",courseId:"999",assignmentId:"4242"};

describe("extractCanvasApiSubmissionStatus",()=>{
  const checkedAt="2026-10-04T06:00:00.000Z";

  it("normalizes explicit Canvas submission workflow states",()=>{
    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{workflow_state:"unsubmitted",submitted_at:null,late:false,missing:true,excused:false},
    },locator,checkedAt)).toMatchObject({
      state:"not_submitted",isLate:false,isMissing:true,submittedAt:null,extractorVersion:"canvas-api-v1",
    });

    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{workflow_state:"pending_review",submitted_at:"2026-10-04T05:00:00.000Z",late:true,missing:false,excused:false},
    },locator,checkedAt)).toMatchObject({
      state:"submitted",isLate:true,isMissing:false,submittedAt:"2026-10-04T05:00:00.000Z",
    });

    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{
        workflow_state:"graded",
        submitted_at:"2026-10-04T05:00:00.000Z",
        posted_at:null,
        late:false,
        missing:false,
        excused:false,
      },
    },locator,checkedAt)).toMatchObject({state:"submitted"});

    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{
        workflow_state:"graded",
        submitted_at:"2026-10-04T05:00:00.000Z",
        posted_at:"2026-10-04T05:30:00.000Z",
        late:false,
        missing:false,
        excused:false,
      },
    },locator,checkedAt)).toMatchObject({state:"graded"});

    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{workflow_state:"graded",submitted_at:null,late:false,missing:false,excused:true},
    },locator,checkedAt)).toMatchObject({state:"excused"});
  });

  it("does not invent not-submitted state when Canvas omits the current-user submission",()=>{
    const result=extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
    },locator,checkedAt);
    expect(result).toMatchObject({state:"unknown"});
    expect(result).not.toHaveProperty("errorCode");
  });

  it("rejects mismatched assignment identity and unknown workflow states",()=>{
    expect(extractCanvasApiSubmissionStatus({
      id:9999,course_id:999,
      submission:{workflow_state:"submitted"},
    },locator,checkedAt)).toMatchObject({state:"unknown",errorCode:"UNRECOGNIZED_STATUS"});

    expect(extractCanvasApiSubmissionStatus({
      id:4242,course_id:999,
      submission:{workflow_state:"mystery"},
    },locator,checkedAt)).toMatchObject({state:"unknown",errorCode:"UNRECOGNIZED_STATUS"});
  });
});
