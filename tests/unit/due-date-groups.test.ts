import { expect,it } from "vitest";
import type { Assignment } from "@/lib/assignments/types";
import { groupUpcoming } from "@/lib/assignments/queries";
import { classifyDueDate } from "@/lib/dates/classify-due-date";

it("classifies Pacific date boundaries without machine-local drift",()=>{
  const now=new Date("2026-10-03T19:00:00Z");
  expect(classifyDueDate("2026-10-04T05:00:00Z",now)).toBe("today");
  expect(classifyDueDate("2026-10-04T19:00:00Z",now)).toBe("tomorrow");
  expect(classifyDueDate(null,now)).toBe("no-due-date");
});

function assignment(id:string,state:NonNullable<Assignment["submissionStatus"]>["state"]):Assignment{
  return {
    id,
    source:"canvas",
    externalId:id,
    courseId:"999",
    courseName:"CSE 999",
    title:id,
    releaseAt:null,
    dueAt:"2026-10-03T05:00:00.000Z",
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
    submissionStatus:{
      state,
      isLate:false,
      isMissing:false,
      submittedAt:state==="submitted"?"2026-10-03T04:00:00.000Z":null,
      checkedAt:"2026-10-04T23:00:00.000Z",
      extractorVersion:"canvas-api-v1",
    },
  };
}

it("keeps resolved Canvas work out of Upcoming regardless of due date",()=>{
  const groups=groupUpcoming([
    {...assignment("submitted","submitted"),dueAt:"2026-10-08T05:00:00.000Z"},
    {...assignment("graded","graded"),dueAt:"2026-10-09T05:00:00.000Z"},
    {...assignment("excused","excused"),dueAt:"2026-10-10T05:00:00.000Z"},
    assignment("not-submitted","not_submitted"),
    assignment("unknown","unknown"),
  ],new Date("2026-10-04T23:00:00.000Z"),"America/Los_Angeles");

  expect(groups.overdue.map(item=>item.id)).toEqual(["not-submitted","unknown"]);
  const visible=Object.values(groups).flat().map(item=>item.id);
  expect(visible).not.toContain("submitted");
  expect(visible).not.toContain("graded");
  expect(visible).not.toContain("excused");
});


it("keeps undated Ed lessons out of Upcoming without changing Canvas no-due-date behavior",()=>{
  const checkedAt="2026-10-05T12:00:00.000Z";
  const edDated:Assignment={
    ...assignment("ed-dated","unknown"),
    source:"ed",
    dueAt:"2026-10-08T05:00:00.000Z",
    submissionStatus:{state:"unknown",isLate:false,isMissing:false,submittedAt:null,checkedAt,extractorVersion:"ed-api-v1"},
  };
  const edUndated:Assignment={
    ...edDated,
    id:"ed-undated",
    externalId:"ed-undated",
    dueAt:null,
  };
  const edCompleted:Assignment={
    ...edDated,
    id:"ed-completed",
    externalId:"ed-completed",
    submissionStatus:{...edDated.submissionStatus!,state:"submitted"},
  };
  const canvasUndated:Assignment={
    ...assignment("canvas-undated","unknown"),
    dueAt:null,
  };

  const groups=groupUpcoming(
    [edDated,edUndated,edCompleted,canvasUndated],
    new Date("2026-10-05T12:00:00.000Z"),
    "America/Los_Angeles",
  );
  const visible=Object.values(groups).flat().map(item=>item.id);
  expect(visible).toContain("ed-dated");
  expect(visible).not.toContain("ed-undated");
  expect(visible).not.toContain("ed-completed");
  expect(groups["no-due-date"].map(item=>item.id)).toEqual(["canvas-undated"]);
});
