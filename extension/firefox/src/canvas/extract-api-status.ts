import type { SubmissionStatusResultV1 } from "@/lib/extension-protocol/submission-status";
import type { CanvasAssignmentLocator } from "@/lib/submission-status/types";

export const CANVAS_API_EXTRACTOR_VERSION="canvas-api-v1";

function asRecord(value:unknown):Record<string,unknown>|null {
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ? value as Record<string,unknown>
    : null;
}

function idString(value:unknown):string|null {
  if(typeof value==="string"&&/^\d+$/.test(value))return value;
  if(typeof value==="number"&&Number.isInteger(value)&&value>=0)return String(value);
  return null;
}

function unavailable(
  assignment:CanvasAssignmentLocator,
  checkedAt:string,
  errorCode?:"UNRECOGNIZED_STATUS",
):SubmissionStatusResultV1 {
  return {
    ...assignment,
    state:"unknown",
    isLate:false,
    isMissing:false,
    submittedAt:null,
    checkedAt,
    extractorVersion:CANVAS_API_EXTRACTOR_VERSION,
    ...(errorCode?{errorCode}:{}),
  };
}

export function extractCanvasApiSubmissionStatus(
  payload:unknown,
  assignment:CanvasAssignmentLocator,
  checkedAt:string,
):SubmissionStatusResultV1 {
  const root=asRecord(payload);
  if(
    !root ||
    idString(root.id)!==assignment.assignmentId ||
    idString(root.course_id)!==assignment.courseId
  ){
    return unavailable(assignment,checkedAt,"UNRECOGNIZED_STATUS");
  }

  if(root.submission===undefined||root.submission===null){
    return unavailable(assignment,checkedAt);
  }

  const submission=asRecord(root.submission);
  if(!submission){
    return unavailable(assignment,checkedAt,"UNRECOGNIZED_STATUS");
  }

  const workflowState=typeof submission.workflow_state==="string"
    ? submission.workflow_state
    : null;
  const excused=submission.excused===true;
  const submittedValue=typeof submission.submitted_at==="string"
    ? submission.submitted_at
    : null;
  const submittedAt=submittedValue&&Number.isFinite(Date.parse(submittedValue))
    ? new Date(submittedValue).toISOString()
    : null;
  const postedValue=typeof submission.posted_at==="string"
    ? submission.posted_at
    : null;
  const gradePublished=Boolean(postedValue&&Number.isFinite(Date.parse(postedValue)));

  let state:SubmissionStatusResultV1["state"];
  if(excused){
    state="excused";
  }else if(workflowState==="graded"&&gradePublished){
    state="graded";
  }else if(workflowState==="graded"&&submittedAt){
    state="submitted";
  }else if(workflowState==="graded"){
    return unavailable(assignment,checkedAt);
  }else if(workflowState==="submitted"||workflowState==="pending_review"){
    state="submitted";
  }else if(workflowState==="unsubmitted"){
    state="not_submitted";
  }else{
    return unavailable(assignment,checkedAt,"UNRECOGNIZED_STATUS");
  }

  return {
    ...assignment,
    state,
    isLate:submission.late===true,
    isMissing:submission.missing===true,
    submittedAt,
    checkedAt,
    extractorVersion:CANVAS_API_EXTRACTOR_VERSION,
  };
}
