import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCanvasIcal } from "@/lib/sources/canvas-ical/parser";
import {canvasEvent,canvasFeed} from "../helpers/guest-source-fixtures";
const fixture=(name:string)=>fs.readFileSync(path.join(process.cwd(),"tests/fixtures/canvas",name),"utf8");
describe("Canvas iCal parser",()=>{
 it.each(["\n","\r\n"])("recovers a sibling after a nested event and counts the broken outer event once with %j lines",newline=>{
  const report=parseCanvasIcal(canvasFeed([canvasEvent(1).replace("END:VEVENT",`${canvasEvent(2)}\nEND:VEVENT`),canvasEvent(3)]).replaceAll("\n",newline));
  expect(report.assignments.map(row=>row.externalId)).toEqual(["event-assignment-2","event-assignment-3"]);
  expect(report.skipped).toBe(1);
  expect(report.errors).toEqual(["Skipped one malformed Canvas assignment event."]);
 });
 it.each(["", "\nEND:VCALENDAR"])("reports an event truncated at the end of input or calendar (%j)",ending=>{
  const report=parseCanvasIcal(`BEGIN:VCALENDAR\n${canvasEvent(1).replace("\nEND:VEVENT","")}${ending}`);
  expect(report.assignments).toEqual([]);expect(report.skipped).toBe(1);expect(report.errors).toHaveLength(1);
 });
 it("reports a missing event start without leaking raw event content",()=>{
  const report=parseCanvasIcal(canvasFeed([canvasEvent(1).replace("BEGIN:VEVENT\n","").replace("Homework 1","private-never-echo"),canvasEvent(2)]));
  expect(report.assignments.map(row=>row.externalId)).toEqual(["event-assignment-2"]);
  expect(report.skipped).toBe(1);expect(report.errors).toEqual(["Skipped one malformed Canvas assignment event."]);
 });
 it.each(["BEGIN:VALARM\nACTION:DISPLAY", "END:VALARM"])("rejects an event with misnested child component %j while preserving siblings",component=>{
  const report=parseCanvasIcal(canvasFeed([canvasEvent(1),canvasEvent(2).replace("END:VEVENT",`${component}\nEND:VEVENT`),canvasEvent(3)]));
  expect(report.assignments.map(row=>row.externalId)).toEqual(["event-assignment-1","event-assignment-3"]);
  expect(report.skipped).toBe(1);expect(report.errors).toHaveLength(1);
 });
 it("preserves valid alarms and folded exact boundary text",()=>{
  const event=canvasEvent(1).replace("END:VEVENT","DESCRIPTION:literal END:VEVENT\n BEGIN:VEVENT\n\tEND:VEVENT\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Reminder\nEND:VALARM\nEND:VEVENT");
  const report=parseCanvasIcal(canvasFeed([event]));
  expect(report.assignments.map(row=>row.externalId)).toEqual(["event-assignment-1"]);expect(report.errors).toEqual([]);expect(report.skipped).toBe(0);
 });
 it.each(["\n","\r\n"])("ignores non-boundary markers and keeps folded values with %j line endings",newline=>{
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","X-NOTE:BEGIN:VEVENT", "BEGIN:VEVENT","UID:event-assignment-1","SUMMARY:Homework", "DESCRIPTION:folded literal", " BEGIN:VEVENT text", "END:VEVENT","END:VCALENDAR"];
  const report=parseCanvasIcal(lines.join(newline));
  expect(report.assignments).toHaveLength(1);expect(report.assignments[0].title).toBe("Homework");expect(report.errors).toEqual([]);
 });
 it.each(["javascript:alert(1)","data:text/html,test","https://user:password@canvas.uw.edu/calendar"])("discards non-web or credential-bearing assignment links",raw=>{
  const report=parseCanvasIcal(`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-assignment-1\nSUMMARY:Homework\nURL:${raw}\nEND:VEVENT\nEND:VCALENDAR`);
  expect(report.assignments).toHaveLength(1);
  expect(report.assignments[0].sourceUrl).toBeNull();
 });
 it("imports assignments, ignores ordinary calendar events, and derives reliable Canvas metadata",()=>{
  const report=parseCanvasIcal(fixture("valid.ics")); expect(report.assignments).toHaveLength(1); expect(report.skipped).toBe(1);
  expect(report.assignments[0]).toMatchObject({externalId:"event-assignment-987",title:"Homework 3",courseName:"CSE 331",courseId:"123",sourceUrl:"https://canvas.uw.edu/courses/123/assignments/987",status:"unknown"});
 });
 it("reconstructs Canvas date-only deadlines at 23:59 Pacific and skips malformed assignment events",()=>{
  const report=parseCanvasIcal(fixture("partial.ics")); expect(report.assignments).toHaveLength(1); expect(report.errors.length).toBeGreaterThan(0); expect(report.assignments[0].dueAt).toMatch(/T0[67]:59:00\.000Z$/);
 });
});
