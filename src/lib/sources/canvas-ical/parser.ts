import "server-only";
import crypto from "node:crypto";
import ICAL from "ical.js";
import { fromZonedTime } from "date-fns-tz";
import type { SourceAssignment } from "@/lib/sources/types";
import { CanvasSourceError } from "./errors";

type ParseReport = { assignments: SourceAssignment[]; skipped: number; errors: string[] };
const ASSIGNMENT_UID = /^event-(?:assignment|assignment-override|sub-assignment)-/i;

function splitEvents(input:string): string[] { return input.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []; }
function assignmentLike(uid:string, rawUrl:string|null): boolean { return ASSIGNMENT_UID.test(uid) || /#assignment_\d+/i.test(rawUrl ?? ""); }
function stableFallback(fields:string[]): string { return `fallback-${crypto.createHash("sha256").update(fields.join("\u001f")).digest("hex")}`; }
function directCanvasUrl(raw:string|null): {url:string|null; courseId:string|null} {
  if (!raw) return {url:null,courseId:null};
  try {
    const url=new URL(raw);
    if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return {url:null,courseId:null};
    const context=url.searchParams.get("include_contexts"); const course=context?.match(/^course_(\d+)$/)?.[1] ?? null; const assignment=url.hash.match(/^#assignment_(\d+)$/)?.[1] ?? null;
    if (course && assignment) return {url:`${url.protocol}//${url.host}/courses/${course}/assignments/${assignment}`,courseId:course};
    return {url:raw,courseId:course};
  } catch { return {url:null,courseId:null}; }
}
function parseOne(block:string): SourceAssignment | "ignored" {
  const wrapped=`BEGIN:VCALENDAR\nVERSION:2.0\n${block}\nEND:VCALENDAR`;
  const root=new ICAL.Component(ICAL.parse(wrapped)); const vevent=root.getFirstSubcomponent("vevent"); if(!vevent) throw new Error("missing VEVENT");
  const event=new ICAL.Event(vevent); const rawUrl=(vevent.getFirstPropertyValue("url") as string | null) ?? null; const uid=event.uid ?? "";
  if(!assignmentLike(uid,rawUrl)) return "ignored";
  const summary=(event.summary ?? "").trim(); if(!summary) throw new Error("missing summary");
  const suffix=summary.match(/^(.*?)\s+\[([^\]]+)\]\s*$/); const title=(suffix?.[1] ?? summary).trim(); const courseName=(suffix?.[2] ?? "Canvas").trim();
  let dueAt:string|null=null; const start=event.startDate;
  if(start) {
    if(start.isDate) { const local=`${String(start.year).padStart(4,"0")}-${String(start.month).padStart(2,"0")}-${String(start.day).padStart(2,"0")}T23:59:00`; dueAt=fromZonedTime(local,"America/Los_Angeles").toISOString(); }
    else { const date=start.toJSDate(); if(Number.isNaN(date.getTime())) throw new Error("invalid DTSTART"); dueAt=date.toISOString(); }
  }
  const direct=directCanvasUrl(rawUrl); const stamp=vevent.getFirstPropertyValue("dtstamp") as ICAL.Time | null;
  const sourceUpdatedAt=stamp ? stamp.toJSDate().toISOString() : null;
  const externalId=uid || stableFallback([summary,dueAt ?? "",rawUrl ?? ""]);
  return {externalId,courseId:direct.courseId,courseName,title,dueAt,status:"unknown",sourceUrl:direct.url,sourceUpdatedAt};
}
export function parseCanvasIcal(input:string): ParseReport {
  if(!input.trim()) throw new CanvasSourceError("EMPTY_FEED","The Canvas calendar feed is empty.");
  if(!/BEGIN:VCALENDAR/i.test(input)) throw new CanvasSourceError("INVALID_ICAL","Canvas returned an invalid calendar feed.");
  const blocks=splitEvents(input); if(blocks.length===0) throw new CanvasSourceError("EMPTY_FEED","The Canvas calendar feed has no events.");
  const assignments:SourceAssignment[]=[]; const errors:string[]=[]; let skipped=0;
  for(const block of blocks) { try { const parsed=parseOne(block); if(parsed==="ignored") skipped++; else assignments.push(parsed); } catch { skipped++; errors.push("Skipped one malformed Canvas assignment event."); } }
  return {assignments,skipped,errors};
}
