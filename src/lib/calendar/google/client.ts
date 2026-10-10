import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";

const GOOGLE_CALENDAR_API="https://www.googleapis.com/calendar/v3";

const calendarSchema=z.object({
  id:z.string().min(1),
  summary:z.string().optional(),
}).passthrough();

const eventSchema=z.object({
  id:z.string().min(1),
  etag:z.string().optional(),
}).passthrough();

export function googleEventId(syncKey:string):string{
  return createHash("sha256").update(syncKey).digest("hex");
}

function mapHttpError(status:number):CalendarSyncError{
  if(status===401||status===403){
    return new CalendarSyncError(
      "CALENDAR_AUTH_EXPIRED",
      "Google Calendar authorization is no longer valid.",
    );
  }
  if(status===429){
    return new CalendarSyncError(
      "CALENDAR_RATE_LIMITED",
      "Google Calendar is rate limiting requests.",
    );
  }
  return new CalendarSyncError(
    "CALENDAR_UPSTREAM_ERROR",
    "Google Calendar request failed.",
  );
}

export class GoogleCalendarClient{
  constructor(
    private readonly accessToken:string,
    private readonly fetchImpl:typeof fetch=fetch,
  ){}

  private async request(
    path:string,
    init:RequestInit={},
    options:{allowNotFound?:boolean;allowNoContent?:boolean;allowConflict?:boolean}={},
  ):Promise<unknown|null>{
    let response:Response;
    const fetchImpl=this.fetchImpl;
    try{
      response=await fetchImpl(GOOGLE_CALENDAR_API+path,{
        ...init,
        headers:{
          authorization:`Bearer ${this.accessToken}`,
          ...(init.body?{"content-type":"application/json"}:{}),
          ...(init.headers??{}),
        },
      });
    }catch{
      throw new CalendarSyncError(
        "CALENDAR_NETWORK_ERROR",
        "Google Calendar could not be reached.",
      );
    }

    if(options.allowNotFound&&response.status===404)return null;
    if(options.allowNoContent&&(response.status===204||response.status===404))return null;
    if(options.allowConflict&&response.status===409)return null;
    if(!response.ok)throw mapHttpError(response.status);
    if(response.status===204)return null;
    try{return await response.json();}catch{
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar returned an unexpected response.",
      );
    }
  }

  async createCalendar(name:string):Promise<{remoteCalendarId:string;name:string}>{
    const body=await this.request("/calendars",{
      method:"POST",
      body:JSON.stringify({summary:name}),
    });
    const parsed=calendarSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar returned an unexpected calendar response.",
      );
    }
    return {
      remoteCalendarId:parsed.data.id,
      name:parsed.data.summary??name,
    };
  }

  async getCalendar(calendarId:string):Promise<{remoteCalendarId:string;name:string}|null>{
    const body=await this.request(
      `/calendars/${encodeURIComponent(calendarId)}`,
      {method:"GET"},
      {allowNotFound:true},
    );
    if(body===null)return null;
    const parsed=calendarSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar returned an unexpected calendar response.",
      );
    }
    return {
      remoteCalendarId:parsed.data.id,
      name:parsed.data.summary??"Kairos",
    };
  }

  async getEvent(calendarId:string,eventId:string):Promise<RemoteCalendarEvent|null>{
    const body=await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {method:"GET"},
      {allowNotFound:true},
    );
    if(body===null)return null;
    return this.parseEvent(body);
  }

  async createEvent(
    calendarId:string,
    projection:CalendarEventProjection,
    syncKey:string,
  ):Promise<RemoteCalendarEvent>{
    const eventId=googleEventId(syncKey);
    const body=await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method:"POST",
        body:JSON.stringify({
          id:eventId,
          ...this.eventBody(projection),
        }),
      },
      {allowConflict:true},
    );
    if(body===null){
      const existing=await this.getEvent(calendarId,eventId);
      if(existing)return existing;
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar could not confirm an existing event.",
      );
    }
    return this.parseEvent(body);
  }

  async updateEvent(
    calendarId:string,
    eventId:string,
    projection:CalendarEventProjection,
  ):Promise<RemoteCalendarEvent>{
    const body=await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method:"PATCH",
        body:JSON.stringify(this.eventBody(projection)),
      },
    );
    return this.parseEvent(body);
  }

  async deleteEvent(calendarId:string,eventId:string):Promise<void>{
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {method:"DELETE"},
      {allowNoContent:true},
    );
  }

  private eventBody(projection:CalendarEventProjection){
    return {
      summary:projection.title,
      description:projection.description,
      start:{dateTime:projection.startsAt,timeZone:"UTC"},
      end:{dateTime:projection.endsAt,timeZone:"UTC"},
      transparency:"transparent",
    };
  }

  private parseEvent(body:unknown):RemoteCalendarEvent{
    const parsed=eventSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar returned an unexpected event response.",
      );
    }
    return {
      remoteEventId:parsed.data.id,
      etag:parsed.data.etag??null,
    };
  }
}
