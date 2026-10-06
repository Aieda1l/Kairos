import "server-only";
import type {CalendarConnection,CalendarProvider} from "@/lib/calendar/types";
import type {CalendarEventProjection} from "@/lib/calendar/projection";

export type RemoteCalendarEvent={
  remoteEventId:string;
  etag:string|null;
  managedAssignmentId?:string|null;
};

export interface CalendarDestinationAdapter{
  readonly provider:CalendarProvider;
  testConnection():Promise<void>;
  ensureCalendar():Promise<{remoteCalendarId:string;name:string}>;
  getEvent(remoteCalendarId:string,remoteEventId:string):Promise<RemoteCalendarEvent|null>;
  findEventByAssignment?(
    remoteCalendarId:string,
    assignmentId:string,
  ):Promise<RemoteCalendarEvent|null>;
  createEvent(
    remoteCalendarId:string,
    projection:CalendarEventProjection,
    syncKey:string,
  ):Promise<RemoteCalendarEvent>;
  updateEvent(
    remoteCalendarId:string,
    remoteEventId:string,
    projection:CalendarEventProjection,
    remoteEtag?:string|null,
  ):Promise<RemoteCalendarEvent>;
  deleteEvent(remoteCalendarId:string,remoteEventId:string):Promise<void>;
}

export type CalendarAdapterFactory=(
  connection:CalendarConnection,
)=>Promise<CalendarDestinationAdapter>;
