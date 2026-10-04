// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractCanvasSubmissionStatus } from "../src/canvas/extract-status";

const checkedAt="2026-10-04T06:00:00.000Z";
const url="https://canvas.uw.edu/courses/999/assignments/4242";
const fixture=(name:string)=>fs.readFileSync(path.join(process.cwd(),"tests/fixtures/canvas-submission-pages",name),"utf8");

describe("extractCanvasSubmissionStatus",()=>{
  it.each([
    ["submitted.html","submitted",false,false],
    ["not-submitted.html","not_submitted",false,false],
    ["graded.html","graded",false,false],
    ["excused.html","excused",false,false],
    ["late.html","submitted",true,false],
    ["missing.html","not_submitted",false,true],
  ] as const)("extracts %s", (name,state,isLate,isMissing)=>{
    expect(extractCanvasSubmissionStatus(fixture(name),url,checkedAt)).toMatchObject({
      state,isLate,isMissing,checkedAt,extractorVersion:"canvas-html-v1",
    });
  });

  it("extracts a clearly marked submission timestamp",()=>{
    expect(extractCanvasSubmissionStatus(fixture("submitted.html"),url,checkedAt).submittedAt)
      .toBe("2026-10-04T05:00:00.000Z");
  });

  it("returns unknown instead of guessing when explicit state signals conflict",()=>{
    expect(extractCanvasSubmissionStatus(fixture("ambiguous.html"),url,checkedAt)).toMatchObject({
      state:"unknown",errorCode:"UNRECOGNIZED_STATUS",
    });
  });

  it("recognizes a Canvas login page as signed out",()=>{
    expect(extractCanvasSubmissionStatus(fixture("signed-out.html"),"https://canvas.uw.edu/login/canvas",checkedAt)).toMatchObject({
      state:"unknown",errorCode:"CANVAS_SIGNED_OUT",
    });
  });
});
