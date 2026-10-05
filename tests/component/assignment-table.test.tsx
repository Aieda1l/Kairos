// @vitest-environment jsdom
import {render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it} from "vitest";
import {AssignmentTable} from "@/features/assignments/assignment-table";
import type {Assignment} from "@/lib/assignments/types";

const items:Assignment[]=[
  {id:"2",source:"canvas",externalId:"2",courseId:null,courseName:"MATH",title:"Later",releaseAt:null,dueAt:"2026-10-10T07:00:00Z",lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"graded",isLate:false,isMissing:false,submittedAt:"2026-10-02T18:00:00Z",checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
  {id:"1",source:"canvas",externalId:"1",courseId:null,courseName:"CSE",title:"Soon",releaseAt:null,dueAt:"2026-10-05T07:00:00Z",lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"submitted",isLate:false,isMissing:false,submittedAt:"2026-10-03T18:00:00Z",checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
];

it("renders submission status and sorts the status column by the nested Canvas state",async()=>{
  const user=userEvent.setup();
  render(<AssignmentTable assignments={items} timeZone="America/Los_Angeles"/>);
  for(const name of ["Assignment","Course","Due","Source","Status"]) expect(screen.getByRole("columnheader",{name})).toBeInTheDocument();
  expect(screen.getByText("Submitted")).toBeInTheDocument();
  expect(screen.getByText("Graded")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Sort by"),"status");
  const rows=within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(rows[0]).toHaveTextContent("Later");
  expect(rows[0]).toHaveTextContent("Graded");

  await user.click(screen.getAllByRole("button",{name:/View .* details/})[0]);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
