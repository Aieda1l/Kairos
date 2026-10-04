import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

export const submissionStatusLabels={
  unknown:"Status unavailable",
  not_submitted:"Not submitted",
  submitted:"Submitted",
  graded:"Graded",
  excused:"Excused",
} as const;

export type SubmissionVisualState=keyof typeof submissionStatusLabels;

export function submissionVisualState(
  status:AssignmentSubmissionStatus|null,
):SubmissionVisualState{
  return status?.state??"unknown";
}

export function getSubmissionStatusLabel(
  status:AssignmentSubmissionStatus|null,
):string{
  if(!status)return submissionStatusLabels.unknown;
  const parts:string[]=[submissionStatusLabels[status.state]];
  if(status.isLate)parts.push("Late");
  if(status.isMissing)parts.push("Missing");
  return parts.join(" · ");
}

export function submissionStatusClasses(
  status:AssignmentSubmissionStatus|null,
):string{
  const state=submissionVisualState(status);
  return [
    "border-[var(--status-"+state.replace("_","-")+"-border)]",
    "bg-[var(--status-"+state.replace("_","-")+"-bg)]",
    "text-[var(--status-"+state.replace("_","-")+"-fg)]",
  ].join(" ");
}

export function isResolvedSubmissionStatus(
  status:AssignmentSubmissionStatus|null,
):boolean{
  return status?.state==="submitted"||status?.state==="graded"||status?.state==="excused";
}
