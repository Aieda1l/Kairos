// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it} from "vitest";
import {AssignmentCalendar} from "@/features/assignments/assignment-calendar";
import type {Assignment} from "@/lib/assignments/types";

function item(
  id:string,
  title:string,
  state:NonNullable<Assignment["submissionStatus"]>["state"]|null,
):Assignment{
  return {
    id,
    source:"canvas",
    externalId:id,
    courseId:"999",
    courseName:"CSE",
    title,
    releaseAt:null,
    dueAt:"2026-10-05T06:59:00Z",
    lateDueAt:null,
    status:"unknown",
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:null,
    sourceUpdatedAt:null,
    firstSeenAt:"",
    lastSeenAt:"",
    submissionStatus:state?{
      state,
      isLate:false,
      isMissing:false,
      submittedAt:state==="submitted"?"2026-10-05T05:00:00Z":null,
      checkedAt:"2026-10-04T23:00:00Z",
      extractorVersion:"canvas-api-v1",
    }:null,
  };
}

const items:Assignment[]=[
  item("1","Submitted HW","submitted"),
  item("2","Graded HW","graded"),
  item("3","Excused HW","excused"),
  item("4","Missing HW","not_submitted"),
  item("5","Unknown HW",null),
  {...item("6","No date",null),dueAt:null},
];

it("places due assignments on the configured-timezone calendar day and excludes no-due items",async()=>{
  const user=userEvent.setup();
  render(<AssignmentCalendar assignments={items} timeZone="America/Los_Angeles" initialMonth={new Date("2026-10-01T12:00:00Z")}/>);
  expect(screen.getByRole("button",{name:/Submitted HW/})).toBeInTheDocument();
  expect(screen.queryByText("No date")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:/Submitted HW/}));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("color-codes calendar assignments and marks resolved work as complete",()=>{
  render(<AssignmentCalendar assignments={items} timeZone="America/Los_Angeles" initialMonth={new Date("2026-10-01T12:00:00Z")}/>);

  const submitted=screen.getByRole("button",{name:/Submitted HW.*Submitted/i});
  expect(submitted.className).toContain("--status-submitted");
  expect(submitted.className).toContain("line-through");

  const graded=screen.getByRole("button",{name:/Graded HW.*Graded/i});
  expect(graded.className).toContain("--status-graded");
  expect(graded.className).toContain("line-through");

  const excused=screen.getByRole("button",{name:/Excused HW.*Excused/i});
  expect(excused.className).toContain("--status-excused");
  expect(excused.className).toContain("line-through");

  const notSubmitted=screen.getByRole("button",{name:/Missing HW.*Not submitted/i});
  expect(notSubmitted.className).toContain("--status-not-submitted");
  expect(notSubmitted.className).not.toContain("line-through");

  const unavailable=screen.getByRole("button",{name:/Unknown HW.*Status unavailable/i});
  expect(unavailable.className).toContain("--status-unavailable");
});


it("uses Ed-native progress for calendar color and accessibility labels",()=>{
  const edBase:Assignment={
    ...item("ed-attempted","Ed attempted","unknown"),
    source:"ed",
    status:"pending",
    sourceStatusText:"attempted",
    submissionStatus:{
      state:"unknown",
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-04T23:00:00Z",
      extractorVersion:"ed-api-v1",
    },
  };
  const edCompleted:Assignment={
    ...edBase,
    id:"ed-completed",
    externalId:"ed-completed",
    title:"Ed completed",
    status:"submitted",
    sourceStatusText:"completed",
    submissionStatus:{...edBase.submissionStatus!,state:"submitted"},
  };

  render(<AssignmentCalendar assignments={[edBase,edCompleted]} timeZone="America/Los_Angeles" initialMonth={new Date("2026-10-01T12:00:00Z")}/>);

  const attempted=screen.getByRole("button",{name:/Ed attempted.*In progress/i});
  expect(attempted.className).toContain("--status-not-submitted");
  expect(attempted.className).not.toContain("--status-unavailable");
  expect(attempted.className).not.toContain("line-through");

  const completed=screen.getByRole("button",{name:/Ed completed.*Completed/i});
  expect(completed.className).toContain("--status-submitted");
  expect(completed.className).toContain("line-through");
});
