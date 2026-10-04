import { Badge } from "@/components/ui/badge";
import type { AssignmentSubmissionStatus } from "@/lib/submission-status/types";
import {
  getSubmissionStatusLabel,
  submissionStatusClasses,
  submissionVisualState,
} from "./status-presentation";

export { getSubmissionStatusLabel } from "./status-presentation";

export function SubmissionStatusBadge({status}:{status:AssignmentSubmissionStatus|null}){
  const state=submissionVisualState(status);
  return (
    <Badge
      data-submission-state={state}
      className={submissionStatusClasses(status)}
      title={status?.checkedAt?"Checked "+new Date(status.checkedAt).toLocaleString():undefined}
    >
      {getSubmissionStatusLabel(status)}
    </Badge>
  );
}
