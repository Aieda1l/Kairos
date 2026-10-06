import {describe,expect,it} from "vitest";
import type {Assignment} from "@/lib/assignments/types";
import {hashCalendarProjection,projectAssignment} from "@/lib/calendar/projection";

function assignment(overrides:Partial<Assignment>={}):Assignment{
  return {
    id:"local-assignment-1",
    source:"canvas",
    externalId:"987",
    courseId:"123",
    courseName:"CSE 331",
    title:"Homework 3",
    releaseAt:null,
    dueAt:"2026-10-09T06:59:00.000Z",
    lateDueAt:null,
    status:"pending",
    sourceStatusText:"Not submitted",
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:"https://canvas.uw.edu/courses/123/assignments/987",
    sourceUpdatedAt:null,
    firstSeenAt:"2026-10-06T00:00:00.000Z",
    lastSeenAt:"2026-10-06T00:00:00.000Z",
    submissionStatus:null,
    ...overrides,
  };
}

describe("calendar assignment projection",()=>{
  it("omits undated assignments",()=>{
    expect(projectAssignment(assignment({dueAt:null}))).toBeNull();
  });

  it("creates an exact 15 minute deadline projection",()=>{
    expect(projectAssignment(assignment())).toEqual({
      assignmentId:"local-assignment-1",
      title:"[CSE 331] Homework 3",
      description:[
        "Course: CSE 331",
        "Source: Canvas",
        "Status: Not submitted",
        "Due: 2026-10-09T06:59:00.000Z",
        "",
        "Open in source:",
        "https://canvas.uw.edu/courses/123/assignments/987",
      ].join("\n"),
      startsAt:"2026-10-09T06:59:00.000Z",
      endsAt:"2026-10-09T07:14:00.000Z",
      sourceUrl:"https://canvas.uw.edu/courses/123/assignments/987",
    });
  });

  it("removes credential-bearing URL components from descriptions",()=>{
    const secret="fixture-calendar-secret-never-echo";
    const projection=projectAssignment(assignment({
      sourceUrl:`https://user:${secret}@canvas.uw.edu/courses/123/assignments/987?token=${secret}#fragment`,
    }))!;
    expect(projection.description).not.toContain(secret);
    expect(projection.sourceUrl).toBe("https://canvas.uw.edu/courses/123/assignments/987");
  });

  it("hashes the exact owned projection deterministically",()=>{
    const base=projectAssignment(assignment())!;
    expect(hashCalendarProjection(base)).toBe(hashCalendarProjection({...base}));
    expect(hashCalendarProjection({...base,title:"[CSE 331] Homework 4"})).not.toBe(hashCalendarProjection(base));
    expect(hashCalendarProjection({...base,startsAt:"2026-10-10T06:59:00.000Z"})).not.toBe(hashCalendarProjection(base));
    expect(hashCalendarProjection({...base,description:base.description.replace("Not submitted","Submitted")})).not.toBe(hashCalendarProjection(base));
  });
});
