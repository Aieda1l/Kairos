import "server-only";
import type {CalendarConnection} from "@/lib/calendar/types";
import type {
  CalendarDestinationAdapter,
  RemoteCalendarEvent,
} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {MicrosoftCalendarClient} from "@/lib/calendar/microsoft/client";

export class MicrosoftCalendarAdapter implements CalendarDestinationAdapter{
  readonly provider="microsoft" as const;

  constructor(
    private readonly connection:CalendarConnection,
    private readonly client:MicrosoftCalendarClient,
  ){}

  async testConnection():Promise<void>{
    const calendarId=this.connection.remoteCalendarId;
    if(!calendarId){
      throw new CalendarSyncError(
        "CALENDAR_CONFIG_MISSING",
        "Microsoft Calendar connection has no Kairos calendar.",
      );
    }
    const calendar=await this.client.getCalendar(calendarId);
    if(!calendar){
      throw new CalendarSyncError(
        "CALENDAR_REMOTE_CALENDAR_MISSING",
        "The Kairos Microsoft Calendar no longer exists.",
      );
    }
  }

  async ensureCalendar():Promise<{remoteCalendarId:string;name:string}>{
    const existing=await this.client.findCalendarByName("Kairos");
    return existing??this.client.createCalendar("Kairos");
  }

  getEvent(remoteCalendarId:string,remoteEventId:string):Promise<RemoteCalendarEvent|null>{
    return this.client.getEvent(remoteCalendarId,remoteEventId);
  }

  findEventByAssignment(
    remoteCalendarId:string,
    assignmentId:string,
  ):Promise<RemoteCalendarEvent|null>{
    return this.client.findEventByAssignment(remoteCalendarId,assignmentId);
  }

  createEvent(
    remoteCalendarId:string,
    projection:CalendarEventProjection,
    syncKey:string,
  ):Promise<RemoteCalendarEvent>{
    return this.client.createEvent(remoteCalendarId,projection,syncKey);
  }

  updateEvent(
    remoteCalendarId:string,
    remoteEventId:string,
    projection:CalendarEventProjection,
  ):Promise<RemoteCalendarEvent>{
    return this.client.updateEvent(remoteCalendarId,remoteEventId,projection);
  }

  deleteEvent(remoteCalendarId:string,remoteEventId:string):Promise<void>{
    return this.client.deleteEvent(remoteCalendarId,remoteEventId);
  }
}
