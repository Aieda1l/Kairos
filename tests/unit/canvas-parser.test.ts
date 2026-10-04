import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCanvasIcal } from "@/lib/sources/canvas-ical/parser";
const fixture=(name:string)=>fs.readFileSync(path.join(process.cwd(),"tests/fixtures/canvas",name),"utf8");
describe("Canvas iCal parser",()=>{
 it("imports assignments, ignores ordinary calendar events, and derives reliable Canvas metadata",()=>{
  const report=parseCanvasIcal(fixture("valid.ics")); expect(report.assignments).toHaveLength(1); expect(report.skipped).toBe(1);
  expect(report.assignments[0]).toMatchObject({externalId:"event-assignment-987",title:"Homework 3",courseName:"CSE 331",courseId:"123",sourceUrl:"https://canvas.uw.edu/courses/123/assignments/987",status:"unknown"});
 });
 it("reconstructs Canvas date-only deadlines at 23:59 Pacific and skips malformed assignment events",()=>{
  const report=parseCanvasIcal(fixture("partial.ics")); expect(report.assignments).toHaveLength(1); expect(report.errors.length).toBeGreaterThan(0); expect(report.assignments[0].dueAt).toMatch(/T0[67]:59:00\.000Z$/);
 });
});
