// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GradescopeParseError,
  extractGradescopeStudentAssignments,
} from "../src/gradescope/extract-assignments";

const checkedAt="2026-10-04T20:00:00.000Z";
const fixture=(name:string)=>fs.readFileSync(
  path.join(process.cwd(),"extension/firefox/tests/fixtures",name),
  "utf8",
);

describe("extractGradescopeStudentAssignments",()=>{
  it("parses link and submit-button identifiers, dates, statuses, and grades",()=>{
    const result=extractGradescopeStudentAssignments(
      fixture("gradescope-course-student.html"),
      "123",
      checkedAt,
    );

    expect(result.assignments).toHaveLength(6);

    expect(result.assignments.find(a=>a.assignmentId==="456")).toMatchObject({
      courseId:"123",
      title:"Homework 3",
      releaseAt:"2026-10-01T17:00:00.000Z",
      dueAt:"2026-10-08T06:59:00.000Z",
      lateDueAt:"2026-10-10T06:59:00.000Z",
      sourceStatusText:"Submitted",
      state:"submitted",
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
      submittedAt:null,
      checkedAt,
    });

    expect(result.assignments.find(a=>a.assignmentId==="457")).toMatchObject({
      title:"Quiz 2",
      state:"graded",
      gradeScore:"8.5",
      gradeMax:"10",
      gradeDisplay:"8.5 / 10",
      sourceStatusText:"8.5 / 10",
      dueAt:"2026-10-09T00:00:00.000Z",
      lateDueAt:null,
    });

    expect(result.assignments.find(a=>a.assignmentId==="458")).toMatchObject({
      title:"Lab 1",
      state:"not_submitted",
      sourceStatusText:"No Submission",
    });
    expect(result.assignments.find(a=>a.assignmentId==="461")).toMatchObject({
      state:"not_submitted",
      sourceStatusText:"Not Submitted",
    });
    expect(result.assignments.find(a=>a.assignmentId==="459")).toMatchObject({
      state:"unknown",
      sourceStatusText:"Processing",
      releaseAt:null,
      dueAt:null,
      lateDueAt:null,
    });
  });

  it("does not coerce decorated feedback text into a numeric grade",()=>{
    const {assignments}=extractGradescopeStudentAssignments(
      fixture("gradescope-course-student.html"),
      "123",
      checkedAt,
    );
    expect(assignments.find(a=>a.assignmentId==="460")).toMatchObject({
      state:"unknown",
      sourceStatusText:"Excellent work",
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
    });
  });

  it("ignores section rows and reports visible assignment-like rows without stable ids",()=>{
    const result=extractGradescopeStudentAssignments(
      fixture("gradescope-course-student.html"),
      "123",
      checkedAt,
    );
    expect(result.assignments.some(a=>a.title==="Section A")).toBe(false);
    expect(result.assignments.some(a=>a.title==="Visible row without stable id")).toBe(false);
    expect(result.diagnostics).toEqual([{code:"MISSING_STABLE_ID",count:1}]);
  });

  it("treats the Gradescope two-role-row empty student course signature as a valid empty course",()=>{
    const html=`
      <html><body>
        <table><tbody><tr><td>Unrelated course metadata</td></tr></tbody></table>
        <table>
          <tbody>
            <tr role="row"><th>Assignments</th><th>Status</th><th>Due</th></tr>
            <tr role="row"><td></td><td></td><td></td></tr>
          </tbody>
        </table>
      </body></html>
    `;
    expect(extractGradescopeStudentAssignments(html,"123",checkedAt)).toEqual({
      assignments:[],
      diagnostics:[],
    });
  });

  it("treats two global role rows across separate tables as an empty student course",()=>{
    const html=`
      <html><body>
        <table>
          <tbody><tr role="row"><th>Assignments</th><th>Status</th><th>Due</th></tr></tbody>
        </table>
        <table>
          <tbody><tr role="row"><td></td><td></td><td></td></tr></tbody>
        </table>
      </body></html>
    `;
    expect(extractGradescopeStudentAssignments(html,"123",checkedAt)).toEqual({
      assignments:[],
      diagnostics:[],
    });
  });

  it("treats two role rows split across two tables as a valid empty course",()=>{
    const html=`
      <html><body>
        <table><tbody>
          <tr role="row"><th>Assignments</th><th>Status</th><th>Due</th></tr>
        </tbody></table>
        <table><tbody>
          <tr role="row"><td></td><td></td><td></td></tr>
        </tbody></table>
      </body></html>
    `;
    expect(extractGradescopeStudentAssignments(html,"123",checkedAt)).toEqual({
      assignments:[],
      diagnostics:[],
    });
  });

  it("throws a parse error when the authenticated course page shape is unrecognized",()=>{
    expect(()=>extractGradescopeStudentAssignments(
      fixture("gradescope-course-malformed.html"),
      "123",
      checkedAt,
    )).toThrow(GradescopeParseError);
  });

  it("does not accept an unrelated table outside the Gradescope course root",()=>{
    expect(()=>extractGradescopeStudentAssignments(
      "<html><body><table><tbody><tr role=\"row\"><th>Unrelated</th><td>Submitted</td></tr></tbody></table></body></html>",
      "123",
      checkedAt,
    )).toThrow(GradescopeParseError);
  });
});
