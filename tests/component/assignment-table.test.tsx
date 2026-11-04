// @vitest-environment jsdom
import {render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {AssignmentTable} from "@/features/assignments/assignment-table";
import type {Assignment} from "@/lib/assignments/types";

const items:Assignment[]=[
  {id:"2",source:"canvas",externalId:"2",courseId:null,courseName:"MATH",title:"Later",releaseAt:null,dueAt:"2026-10-10T07:00:00Z",lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"graded",isLate:false,isMissing:false,submittedAt:"2026-10-02T18:00:00Z",checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
  {id:"1",source:"canvas",externalId:"1",courseId:null,courseName:"CSE",title:"Soon",releaseAt:null,dueAt:"2026-10-05T07:00:00Z",lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"submitted",isLate:false,isMissing:false,submittedAt:"2026-10-03T18:00:00Z",checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
];

it("uses supplied filters and sort, calls controlled callbacks, and accepts parent updates",async()=>{
  const onFiltersChange=vi.fn(),onSortChange=vi.fn();
  const props={assignments:items,timeZone:"Asia/Tokyo",onFiltersChange,onSortChange};
  const view=render(<AssignmentTable {...props} filters={{course:"CSE",source:"",search:""}} sort="status"/>);
  expect(screen.queryByText("Later")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Course"),"MATH");
  expect(onFiltersChange).toHaveBeenLastCalledWith({course:"MATH",source:"",search:""});
  expect(screen.getByLabelText("Course")).toHaveValue("CSE");
  await userEvent.selectOptions(screen.getByLabelText("Sort by"),"due");
  expect(onSortChange).toHaveBeenCalledWith("due");
  view.rerender(<AssignmentTable {...props} filters={{course:"MATH",source:"",search:""}} sort="due"/>);
  expect(screen.getAllByText("Later")).toHaveLength(2);
  expect(screen.queryByText("Soon")).not.toBeInTheDocument();
});

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

it("updates an open detail from current data and closes it when its assignment disappears",async()=>{
  const view=render(<AssignmentTable assignments={items} timeZone="UTC"/>);
  await userEvent.click(screen.getAllByRole("button",{name:"View Soon details"})[0]);
  view.rerender(<AssignmentTable assignments={[{...items[1],title:"Updated title"}]} timeZone="UTC"/>);
  expect(within(screen.getByRole("dialog")).getByText("Updated title")).toBeInTheDocument();
  view.rerender(<AssignmentTable assignments={[]} timeZone="UTC"/>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(<AssignmentTable assignments={items} timeZone="UTC"/>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
