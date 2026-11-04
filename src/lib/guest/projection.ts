import type { Assignment } from "@/lib/assignments/types";
import type { GuestSnapshot } from "./types";

export function projectGuestAssignments(snapshot:GuestSnapshot):Assignment[] {
  const statuses=new Map(snapshot.statuses.map(({assignmentId,...status})=>[assignmentId,status]));
  return snapshot.assignments.map(({sourceConnectionId,metadataCheckedAt,...assignment})=>{
    // Guest provenance stays in storage; the assignment view consumes its existing domain shape.
    void sourceConnectionId;void metadataCheckedAt;
    return {...assignment,submissionStatus:statuses.get(assignment.id)??null};
  });
}
