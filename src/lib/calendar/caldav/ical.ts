import "server-only";
import {createHash} from "node:crypto";
import type {CalendarEventProjection} from "@/lib/calendar/projection";

function hash(syncKey:string):string{
  return createHash("sha256").update(syncKey).digest("hex");
}

function escapeText(value:string):string{
  return value
    .replace(/\\/g,"\\\\")
    .replace(/\r?\n/g,"\\n")
    .replace(/,/g,"\\,")
    .replace(/;/g,"\\;");
}

function utcStamp(value:string):string{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new Error("Invalid calendar timestamp.");
  const iso=date.toISOString();
  return iso.replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
}

export function caldavResourceName(syncKey:string):string{
  return hash(syncKey)+".ics";
}

export function serializeCalendarEvent(
  projection:CalendarEventProjection,
  syncKey:string,
  uidStem:string=hash(syncKey),
):string{
  const uid=uidStem+"@kairos.local";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kairos//Calendar Sync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${utcStamp(projection.startsAt)}`,
    `DTEND:${utcStamp(projection.endsAt)}`,
    `SUMMARY:${escapeText(projection.title)}`,
    `DESCRIPTION:${escapeText(projection.description)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
