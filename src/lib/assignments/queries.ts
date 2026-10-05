import type { Assignment } from "./types";
import type { AssignmentFilters,AssignmentRepository } from "@/lib/db/repositories/assignments";
import { classifyDueDate,type DueGroup } from "@/lib/dates/classify-due-date";

export function getAssignmentsView(repo:AssignmentRepository,filters:AssignmentFilters):Assignment[]{
  return repo.list(filters);
}

function isResolvedSubmission(assignment:Assignment):boolean{
  const state=assignment.submissionStatus?.state;
  return state==="submitted"||state==="graded"||state==="excused";
}

export function groupUpcoming(
  assignments:Assignment[],
  now:Date,
  timeZone:string,
):Record<DueGroup,Assignment[]>{
  const groups:Record<DueGroup,Assignment[]>={
    overdue:[],
    today:[],
    tomorrow:[],
    "this-week":[],
    later:[],
    "no-due-date":[],
  };

  for(const assignment of assignments){
    if(isResolvedSubmission(assignment))continue;
    if(assignment.source==="ed"&&assignment.dueAt===null)continue;
    groups[classifyDueDate(assignment.dueAt,now,timeZone)].push(assignment);
  }
  return groups;
}
