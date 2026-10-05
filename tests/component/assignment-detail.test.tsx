// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it} from "vitest";
import {AssignmentRow} from "@/features/assignments/assignment-row";
import type {Assignment} from "@/lib/assignments/types";

const item:Assignment={id:"1",source:"canvas",externalId:"1",courseId:null,courseName:"CSE 331",title:"Homework 3",releaseAt:null,dueAt:"2026-10-04T05:00:00Z",lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://example.com",sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"submitted",isLate:true,isMissing:false,submittedAt:"2026-10-03T22:00:00Z",checkedAt:"2026-10-03T22:05:00Z",extractorVersion:"canvas-html-v1"}};

it("opens assignment details with normalized Canvas submission status",async()=>{
  const user=userEvent.setup();
  render(<AssignmentRow assignment={item} timeZone="America/Los_Angeles"/>);
  expect(screen.getByText("Submitted · Late")).toBeInTheDocument();
  expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:/Homework 3/}));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getAllByText("Submitted · Late").length).toBeGreaterThan(0);
  expect(screen.getByText(/Submitted at/)).toBeInTheDocument();
  expect(screen.getByText(/Checked/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Close dialog"})).toHaveFocus();
  expect(screen.getByRole("link",{name:"Open in Canvas"})).toHaveAttribute("href","https://example.com");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
