import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

export const submissionStatusLabels={
  unknown:"Status unavailable",
  not_submitted:"Not submitted",
  submitted:"Submitted",
  graded:"Graded",
  excused:"Excused",
} as const;

export type SubmissionVisualState=keyof typeof submissionStatusLabels;

const statusClasses:Record<SubmissionVisualState,string>={
  unknown:"border-[var(--status-unavailable-border)] bg-[var(--status-unavailable-bg)] text-[var(--status-unavailable-fg)]",
  not_submitted:"border-[var(--status-not-submitted-border)] bg-[var(--status-not-submitted-bg)] text-[var(--status-not-submitted-fg)]",
  submitted:"border-[var(--status-submitted-border)] bg-[var(--status-submitted-bg)] text-[var(--status-submitted-fg)]",
  graded:"border-[var(--status-graded-border)] bg-[var(--status-graded-bg)] text-[var(--status-graded-fg)]",
  excused:"border-[var(--status-excused-border)] bg-[var(--status-excused-bg)] text-[var(--status-excused-fg)]",
};

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

export function submissionStatusClassesForState(state:SubmissionVisualState):string{
  return statusClasses[state];
}

export function submissionStatusClasses(
  status:AssignmentSubmissionStatus|null,
):string{
  return submissionStatusClassesForState(submissionVisualState(status));
}

export function isResolvedSubmissionStatus(
  status:AssignmentSubmissionStatus|null,
):boolean{
  return status?.state==="submitted"||status?.state==="graded"||status?.state==="excused";
}
