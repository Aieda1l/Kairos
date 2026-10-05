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

  it("parses a student-only account whose heading is simply Courses",()=>{
    const html=`
      <div id="account-show">
        <h2 class="pageHeading">Courses</h2>
        <div class="courseList">
          <div class="courseList--term">
            <h3>Autumn 2026</h3>
            <a href="/courses/777">
              <h3 class="courseBox--shortname">CSE 351</h3>
              <div class="courseBox--name">Hardware Software Interface</div>
            </a>
          </div>
        </div>
      </div>
    `;
    expect(extractGradescopeStudentCourses(html)).toEqual([{
      courseId:"777",
      shortName:"CSE 351",
      fullName:"Hardware Software Interface",
      term:"Autumn",
      year:"2026",
    }]);
  });

  it("rejects an authenticated page without the expected account structure",()=>{
    expect(()=>extractGradescopeStudentCourses("<html><body><main>Unexpected</main></body></html>"))
      .toThrow(/Gradescope account page/i);
  });
});
