// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractGradescopeStudentCourses } from "../src/gradescope/extract-courses";

const fixture=(name:string)=>fs.readFileSync(
  path.join(process.cwd(),"extension/firefox/tests/fixtures",name),
  "utf8",
);

describe("extractGradescopeStudentCourses",()=>{
  it("returns only student courses with term metadata",()=>{
    expect(extractGradescopeStudentCourses(fixture("gradescope-account-student.html"))).toEqual([
      {
        courseId:"123",
        shortName:"CSE 331",
        fullName:"Software Design and Implementation",
        term:"Autumn",
        year:"2026",
      },
      {
        courseId:"124",
        shortName:"MATH 308",
        fullName:"Linear Algebra",
        term:"Autumn",
        year:"2026",
      },
    ]);
  });

  it("rejects an authenticated page without the expected account structure",()=>{
    expect(()=>extractGradescopeStudentCourses("<html><body><main>Unexpected</main></body></html>"))
      .toThrow(/Gradescope account page/i);
  });
});
