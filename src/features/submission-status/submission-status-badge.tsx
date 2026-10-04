import { Badge } from "@/components/ui/badge";
import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";

const primaryLabels={
  unknown:"Status unavailable",
  not_submitted:"Not submitted",
  submitted:"Submitted",
  graded:"Graded",
  excused:"Excused",
} as const;

export function getSubmissionStatusLabel(status:AssignmentSubmissionStatus|null):string {
  if(!status) return "Status unavailable";
  const parts:string[]=[primaryLabels[status.state]];
  if(status.isLate) parts.push("Late");
  if(status.isMissing) parts.push("Missing");
  return parts.join(" · ");
}

export function SubmissionStatusBadge({status}:{status:AssignmentSubmissionStatus|null}){
  const unavailable=!status||status.state==="unknown";
  return (
    <Badge
      className={unavailable?"text-[var(--muted)]":undefined}
      title={status?.checkedAt?"Checked "+new Date(status.checkedAt).toLocaleString():undefined}
    >
      {getSubmissionStatusLabel(status)}
    </Badge>
  );
}
