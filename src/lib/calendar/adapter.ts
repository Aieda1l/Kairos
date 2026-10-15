import {ownedWorkStopped,checkOwnedOperation,uncertainOwnedCalendarWrite} from "@/lib/abuse/operation-lock";
import {CalendarSyncError} from "@/lib/calendar/errors";
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

export function guardCalendarAdapter(adapter:CalendarDestinationAdapter):CalendarDestinationAdapter{
  const call=async<T>(work:()=>Promise<T>):Promise<T>=>{
    await checkOwnedOperation();
    if(ownedWorkStopped())return Promise.reject(new CalendarSyncError("CALENDAR_RATE_LIMITED","Provider scheduling has stopped for this operation."));
    return work();
  };
  return {
    provider:adapter.provider,
    testConnection:()=>call(()=>adapter.testConnection()),
    ensureCalendar:()=>call(()=>adapter.ensureCalendar()),
    getEvent:(calendar,id)=>call(()=>adapter.getEvent(calendar,id)),
    ...(adapter.findEventByAssignment?{findEventByAssignment:(calendar:string,id:string)=>call(()=>adapter.findEventByAssignment!(calendar,id))}:{}),
    createEvent:(calendar,projection,key)=>call(()=>adapter.createEvent(calendar,projection,key)),
    updateEvent:(calendar,id,projection,etag)=>call(()=>adapter.updateEvent(calendar,id,projection,etag)),
    deleteEvent:(calendar,id)=>call(()=>adapter.deleteEvent(calendar,id)),
  };
}

/** The caller has reached a credential/provisioning write, after local validation. */
export async function settleCalendarWrite<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){
    if((error instanceof CalendarSyncError&&["CALENDAR_NETWORK_ERROR","CALENDAR_UPSTREAM_ERROR"].includes(error.code))
      ||(error instanceof Error&&!(error instanceof CalendarSyncError)))uncertainOwnedCalendarWrite();
    throw error;
  }
}
