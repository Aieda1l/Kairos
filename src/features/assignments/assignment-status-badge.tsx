import { Badge } from "@/components/ui/badge";
import type { Assignment } from "@/lib/assignments/types";
import { SubmissionStatusBadge } from "@/features/submission-status/submission-status-badge";
import { submissionStatusClassesForState, type SubmissionVisualState } from "@/features/submission-status/status-presentation";

function edProgressLabel(value:string):string{
  switch(value.trim().toLowerCase()){
    case "completed": return "Completed";
    case "attempted": return "In progress";
    case "unattempted": return "Not started";
    default:
      return value
        .trim()
        .replace(/[_-]+/g," ")
        .replace(/\b\w/g,letter=>letter.toUpperCase());
  }
}

function edVisualState(assignment:Assignment):SubmissionVisualState{
  if(assignment.status==="submitted")return "submitted";
  if(assignment.status==="pending")return "not_submitted";
  return "unknown";
}

export function AssignmentStatusBadge({assignment}:{assignment:Assignment}){
  if(assignment.source==="ed"&&assignment.sourceStatusText){
    const state=edVisualState(assignment);
    return <Badge
      data-submission-state={state}
      className={submissionStatusClassesForState(state)}
      title={assignment.submissionStatus?.checkedAt
        ?"Checked "+new Date(assignment.submissionStatus.checkedAt).toLocaleString()
        :undefined}
    >
      {edProgressLabel(assignment.sourceStatusText)}
    </Badge>;
  }
  return <SubmissionStatusBadge status={assignment.submissionStatus}/>;
}

export function assignmentStatusLabel(assignment:Assignment):string{
  if(assignment.source==="ed"&&assignment.sourceStatusText){
    return edProgressLabel(assignment.sourceStatusText);
  }
  switch(assignment.submissionStatus?.state){
    case "not_submitted": return "Not submitted";
    case "submitted": return "Submitted";
    case "graded": return "Graded";
    case "excused": return "Excused";
    default: return "Status unavailable";
  }
}
