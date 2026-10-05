// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssignmentTable } from "@/features/assignments/assignment-table";
import { AssignmentRow } from "@/features/assignments/assignment-row";
import { AssignmentCalendar } from "@/features/assignments/assignment-calendar";
import { groupUpcoming } from "@/lib/assignments/queries";
import type { Assignment } from "@/lib/assignments/types";

function gradescope(overrides:Partial<Assignment>={}):Assignment{
  return {
    id:"gs-1",
    source:"gradescope",
    externalId:"457",
    courseId:"123",
    courseName:"CSE 331",
    title:"Homework 4",
    releaseAt:"2026-10-01T17:00:00.000Z",
    dueAt:"2026-10-08T06:59:00.000Z",
    lateDueAt:"2026-10-10T06:59:00.000Z",
    status:"graded",
    sourceStatusText:"8.5 / 10",
    gradeScore:"8.5",
    gradeMax:"10",
    gradeDisplay:"8.5 / 10",
    sourceUrl:"https://www.gradescope.com/courses/123/assignments/457",
    sourceUpdatedAt:null,
    firstSeenAt:"",
    lastSeenAt:"",
    submissionStatus:{
      state:"graded",
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-05T05:00:00.000Z",
      extractorVersion:"gradescope-html-v1",
    },
    ...overrides,
  };
}

function canvas():Assignment{
  return {
    ...gradescope({
      id:"canvas-1",
      source:"canvas",
      externalId:"canvas-1",
      title:"Canvas Homework",
      releaseAt:null,
      lateDueAt:null,
      sourceStatusText:null,
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
      sourceUrl:"https://canvas.uw.edu/courses/123/assignments/1",
      status:"unknown",
      submissionStatus:null,
    }),
  };
}

describe("Gradescope assignment presentation",()=>{
  it("shows published Gradescope score in All Assignments while Canvas remains blank",()=>{
    render(<AssignmentTable assignments={[gradescope(),canvas()]} timeZone="America/Los_Angeles"/>);
    expect(screen.getByRole("columnheader",{name:"Grade"})).toBeInTheDocument();
    const rows=within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.find(row=>row.textContent?.includes("Homework 4"))).toHaveTextContent("8.5 / 10");
    expect(rows.find(row=>row.textContent?.includes("Canvas Homework"))).toHaveTextContent("—");
  });

  it("shows complete Gradescope source metadata in assignment detail",async()=>{
    const user=userEvent.setup();
    render(<AssignmentRow assignment={gradescope()} timeZone="America/Los_Angeles"/>);
    await user.click(screen.getByRole("button",{name:"View Homework 4 details"}));

    const dialog=screen.getByRole("dialog");
    expect(within(dialog).getByText("Released")).toBeInTheDocument();
    expect(within(dialog).getByText("Late due")).toBeInTheDocument();
    const sourceStatusLabel=within(dialog).getByText("Source status");
    expect(sourceStatusLabel.parentElement).toHaveTextContent("8.5 / 10");
    const gradeLabel=within(dialog).getByText("Grade");
    expect(gradeLabel.parentElement).toHaveTextContent("8.5 / 10");
    expect(within(dialog).getByText("Graded")).toBeInTheDocument();
    expect(within(dialog).getByRole("link",{name:"Open in Gradescope"})).toHaveAttribute(
      "href",
      "https://www.gradescope.com/courses/123/assignments/457",
    );
  });

  it("keeps submitted and graded Gradescope work out of Upcoming",()=>{
    const items=[
      gradescope({id:"graded",submissionStatus:{...gradescope().submissionStatus!,state:"graded"}}),
      gradescope({id:"submitted",submissionStatus:{...gradescope().submissionStatus!,state:"submitted"}}),
      gradescope({id:"open",status:"pending",gradeDisplay:null,gradeScore:null,gradeMax:null,sourceStatusText:"No Submission",submissionStatus:{...gradescope().submissionStatus!,state:"not_submitted"}}),
      gradescope({id:"unknown",status:"unknown",gradeDisplay:null,gradeScore:null,gradeMax:null,sourceStatusText:"Released",submissionStatus:{...gradescope().submissionStatus!,state:"unknown"}}),
    ];
    const groups=groupUpcoming(items,new Date("2026-10-05T05:00:00.000Z"),"America/Los_Angeles");
    const visible=Object.values(groups).flat().map(item=>item.id);
    expect(visible).not.toContain("graded");
    expect(visible).not.toContain("submitted");
    expect(visible).toEqual(expect.arrayContaining(["open","unknown"]));
  });

  it("renders one calendar event on the normal due date and keeps graded completion styling",()=>{
    render(<AssignmentCalendar assignments={[gradescope()]} timeZone="America/Los_Angeles" initialMonth={new Date("2026-10-01T12:00:00Z")}/>);
    const events=screen.getAllByRole("button",{name:/Homework 4.*Graded/i});
    expect(events).toHaveLength(1);
    expect(events[0].className).toContain("line-through");
    expect(events[0].getAttribute("aria-label")).toContain("2026-10-07");
    expect(screen.queryByRole("button",{name:/Homework 4 due 2026-10-09/i})).not.toBeInTheDocument();
  });
});
