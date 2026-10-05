// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssignmentTable } from "@/features/assignments/assignment-table";
import { AssignmentRow } from "@/features/assignments/assignment-row";
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
  });

  it("shows release and Ed progress in detail without inventing a source link",async()=>{
    const user=userEvent.setup();
    render(<AssignmentRow assignment={ed()} timeZone="America/Los_Angeles"/>);
    await user.click(screen.getByRole("button",{name:"View Ed Lesson details"}));
    const dialog=screen.getByRole("dialog");
    expect(within(dialog).getByText("Released")).toBeInTheDocument();
    expect(within(dialog).getByText("No due date")).toBeInTheDocument();
    const sourceStatus=within(dialog).getByText("Source status");
    expect(sourceStatus.parentElement).toHaveTextContent("attempted");
    expect(within(dialog).queryByRole("link",{name:/Open in Ed/i})).not.toBeInTheDocument();
  });
});
