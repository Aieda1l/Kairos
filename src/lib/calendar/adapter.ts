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
  /** A complete result for these exact saved IDs; null means confirmed absence.
   * Omitted or failed resources must reject, never silently become a create. */
  getEvents?(remoteCalendarId:string,remoteEventIds:readonly string[]):Promise<ReadonlyMap<string,RemoteCalendarEvent|null>>;
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

const fencedTransports=new WeakSet<CalendarDestinationAdapter>();
/** Hosted factory only: every outbound request of this adapter must already use
 * ownedFetch. In-memory identity cannot be supplied by a request or provider. */
export function registerFencedCalendarAdapter<T extends CalendarDestinationAdapter>(adapter:T):T{
  fencedTransports.add(adapter);
  return adapter;
}

export function guardCalendarAdapter(adapter:CalendarDestinationAdapter):CalendarDestinationAdapter{
  const transportFenced=fencedTransports.has(adapter);
  const call=async<T>(work:()=>Promise<T>):Promise<T>=>{
    // Built-in hosted clients validate immediately before EVERY HTTP request,
    // including each request in a multi-request adapter method. Custom adapters
    // retain the boundary check because they may use a different transport.
    if(!transportFenced)await checkOwnedOperation();
    if(ownedWorkStopped())return Promise.reject(new CalendarSyncError("CALENDAR_RATE_LIMITED","Provider scheduling has stopped for this operation."));
    return work();
  };
  return {
    provider:adapter.provider,
    testConnection:()=>call(()=>adapter.testConnection()),
    ensureCalendar:()=>call(()=>adapter.ensureCalendar()),
    getEvent:(calendar,id)=>call(()=>adapter.getEvent(calendar,id)),
    ...(adapter.getEvents?{getEvents:(calendar:string,ids:readonly string[])=>call(()=>adapter.getEvents!(calendar,ids))}:{}),
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
