import ICAL from "ical.js";
import { fromZonedTime } from "date-fns-tz";
import type { SourceAssignment } from "@/lib/sources/types";
import { CanvasSourceError } from "./errors";

type ParseReport = { assignments: SourceAssignment[]; skipped: number; errors: string[] };
const ASSIGNMENT_UID = /^event-(?:assignment|assignment-override|sub-assignment)-/i;

/** A null record accounts for one unreadable event without retaining its fields. */
export function* splitCanvasEvents(input:string): Generator<string|null> {
  const boundaries=/^(BEGIN|END):([A-Z0-9-]+)\r?$/gm;
  let start=-1; let abandoned=0; let malformed=false;
  const children:string[]=[];
  for(const boundary of input.matchAll(boundaries)) {
    const [,direction,component]=boundary;
    if(component==="VEVENT") {
      if(direction==="BEGIN") {
        // Resynchronize at the next event so a truncated sibling cannot consume it.
        if(start!==-1) { yield null; abandoned++; }
        start=boundary.index; children.length=0; malformed=false;
      } else if(start!==-1) {
        yield malformed||children.length>0 ? null : input.slice(start,boundary.index+boundary[0].length);
        start=-1; children.length=0;
      } else if(abandoned>0) {
        // Its abandoned BEGIN was already counted; do not count the outer END twice.
        abandoned--;
      } else {
        yield null;
      }
    } else if(component==="VCALENDAR") {
      if(start!==-1) { yield null; start=-1; children.length=0; }
      abandoned=0;
    } else if(start!==-1) {
      if(direction==="BEGIN") children.push(component);
      else if(children.pop()!==component) malformed=true;
    }
  }
  if(start!==-1) yield null;
}
function assignmentLike(uid:string, rawUrl:string|null): boolean { return ASSIGNMENT_UID.test(uid) || /#assignment_\d+/i.test(rawUrl ?? ""); }

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
function parseOne(block:string, guestUtc:boolean): {row:SourceAssignment; fallback:string[]|null} | "ignored" {
  const wrapped=`BEGIN:VCALENDAR\nVERSION:2.0\n${block}\nEND:VCALENDAR`;
  const root=new ICAL.Component(ICAL.parse(wrapped)); const vevent=root.getFirstSubcomponent("vevent"); if(!vevent) throw new Error("missing VEVENT");
  const event=new ICAL.Event(vevent); const rawUrl=(vevent.getFirstPropertyValue("url") as string | null) ?? null; const uid=event.uid ?? "";
  if(!assignmentLike(uid,rawUrl)) return "ignored";
  const summary=(event.summary ?? "").trim(); if(!summary) throw new Error("missing summary");
  const suffix=summary.match(/^(.*?)\s+\[([^\]]+)\]\s*$/); const title=(suffix?.[1] ?? summary).trim(); const courseName=(suffix?.[2] ?? "Canvas").trim();
  let dueAt:string|null=null; const start=event.startDate;
  if(start) {
    if(start.isDate) { const local=`${String(start.year).padStart(4,"0")}-${String(start.month).padStart(2,"0")}-${String(start.day).padStart(2,"0")}T23:59:00`; dueAt=fromZonedTime(local,"America/Los_Angeles").toISOString(); }
    else { const date=toDate(start,guestUtc); if(Number.isNaN(date.getTime())) throw new Error("invalid DTSTART"); dueAt=date.toISOString(); }
  }
  const direct=directCanvasUrl(rawUrl); const stamp=vevent.getFirstPropertyValue("dtstamp") as ICAL.Time | null;
  const sourceUpdatedAt=stamp ? toDate(stamp,guestUtc).toISOString() : null;
  const fallback=uid ? null : [summary,dueAt ?? "",rawUrl ?? ""];
  return {row:{externalId:uid,courseId:direct.courseId,courseName,title,dueAt,status:"unknown",sourceUrl:direct.url,sourceUpdatedAt},fallback};
}
function toDate(value:ICAL.Time, guestUtc:boolean):Date {
  if(guestUtc && value.zone.tzid === "floating") return new Date(Date.UTC(value.year,value.month-1,value.day,value.hour,value.minute,value.second));
  return value.toJSDate();
}
export function parseCanvasCore(input:string, guestUtc=false, check:()=>void=()=>{}): ParseReport & {fallbacks:Map<number,string[]>} {
  if(!input.trim()) throw new CanvasSourceError("EMPTY_FEED","The Canvas calendar feed is empty.");
  if(!/BEGIN:VCALENDAR/i.test(input)) throw new CanvasSourceError("INVALID_ICAL","Canvas returned an invalid calendar feed.");
  const assignments:SourceAssignment[]=[]; const errors:string[]=[]; let skipped=0; let eventCount=0; const fallbacks=new Map<number,string[]>();
  for(const block of splitCanvasEvents(input)) {
    check();
    eventCount++;
    try {
      if(block===null) throw new Error("malformed VEVENT boundaries");
      const parsed=parseOne(block,guestUtc); if(parsed==="ignored") skipped++; else {if(parsed.fallback)fallbacks.set(assignments.length,parsed.fallback); assignments.push(parsed.row);}
    } catch { skipped++; errors.push("Skipped one malformed Canvas assignment event."); }
    check();
  }
  if(eventCount===0) throw new CanvasSourceError("EMPTY_FEED","The Canvas calendar feed has no events.");
  return {assignments,skipped,errors,fallbacks};
}
