// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssignmentTable } from "@/features/assignments/assignment-table";
import { AssignmentRow } from "@/features/assignments/assignment-row";
import { AssignmentCalendar } from "@/features/assignments/assignment-calendar";
import type { Assignment } from "@/lib/assignments/types";

function ed(overrides:Partial<Assignment>={}):Assignment{
  return {
    id:"ed-1",
    source:"ed",
    externalId:"10",
    courseId:"123",
    courseName:"CSE 331",
    title:"Ed Lesson",
    releaseAt:"2026-10-01T17:00:00.000Z",
    dueAt:null,
    lateDueAt:null,
    status:"pending",
    sourceStatusText:"attempted",
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:null,
    sourceUpdatedAt:"2026-10-02T17:00:00.000Z",
    firstSeenAt:"",
    lastSeenAt:"",
    submissionStatus:{
      state:"unknown",
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-05T12:00:00.000Z",
      extractorVersion:"ed-api-v1",
    },
    ...overrides,
  };
}

describe("Ed assignment presentation",()=>{
  it("shows an undated Ed lesson in All Assignments with the Ed badge",()=>{
    render(<AssignmentTable assignments={[ed()]} timeZone="America/Los_Angeles"/>);
    const row=within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("Ed Lesson");
    expect(row).toHaveTextContent("No due date");
    expect(row).toHaveTextContent("Ed");
    expect(row).toHaveTextContent("In progress");
    expect(row).not.toHaveTextContent("Status unavailable");
    it("uses Ed-native progress styling in the calendar instead of unavailable grey",()=>{
    render(<AssignmentCalendar assignments={[
      ed({id:"attempted",externalId:"11",title:"Attempted Ed",dueAt:"2026-10-07T18:00:00.000Z",sourceStatusText:"attempted",status:"pending"}),
      ed({id:"unattempted",externalId:"12",title:"Unattempted Ed",dueAt:"2026-10-08T18:00:00.000Z",sourceStatusText:"unattempted",status:"pending"}),
      ed({id:"completed",externalId:"13",title:"Completed Ed",dueAt:"2026-10-09T18:00:00.000Z",sourceStatusText:"completed",status:"submitted",submissionStatus:{...ed().submissionStatus!,state:"submitted"}}),
    ]} timeZone="America/Los_Angeles" initialMonth={new Date("2026-10-01T12:00:00Z")}/>);

    const attempted=screen.getByRole("button",{name:/Attempted Ed.*In progress/i});
    expect(attempted.className).toContain("--status-not-submitted");
    expect(attempted.className).not.toContain("--status-unavailable");

    const unattempted=screen.getByRole("button",{name:/Unattempted Ed.*Not started/i});
    expect(unattempted.className).toContain("--status-not-submitted");

    const completed=screen.getByRole("button",{name:/Completed Ed.*Completed/i});
    expect(completed.className).toContain("--status-submitted");
    expect(completed.className).toContain("line-through");
  });
});

  it("shows release and Ed progress in detail without inventing a source link",async()=>{
    const user=userEvent.setup();
    render(<AssignmentRow assignment={ed()} timeZone="America/Los_Angeles"/>);
    await user.click(screen.getByRole("button",{name:"View Ed Lesson details"}));
    const dialog=screen.getByRole("dialog");
    expect(within(dialog).getByText("Released")).toBeInTheDocument();
    expect(within(dialog).getByText("No due date")).toBeInTheDocument();
    expect(within(dialog).getByText("Progress").parentElement).toHaveTextContent("In progress");
    const sourceStatus=within(dialog).getByText("Source status");
    expect(sourceStatus.parentElement).toHaveTextContent("attempted");
    expect(within(dialog).queryByRole("link",{name:/Open in Ed/i})).not.toBeInTheDocument();
  });
});
