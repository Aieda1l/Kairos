import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";

const GRAPH_API="https://graph.microsoft.com/v1.0";

const calendarSchema=z.object({
  id:z.string().min(1),
  name:z.string().optional(),
}).passthrough();

const eventSchema=z.object({
  id:z.string().min(1),
  "@odata.etag":z.string().optional(),
}).passthrough();

export function microsoftTransactionId(syncKey:string):string{
  const hex=createHash("sha256").update(syncKey).digest("hex").slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

function mapHttpError(status:number):CalendarSyncError{
  if(status===401||status===403){
    return new CalendarSyncError(
      "CALENDAR_AUTH_EXPIRED",
      "Microsoft Calendar authorization is no longer valid.",
    );
  }
  if(status===429){
    return new CalendarSyncError(
      "CALENDAR_RATE_LIMITED",
      "Microsoft Calendar is rate limiting requests.",
    );
  }
  return new CalendarSyncError(
    "CALENDAR_UPSTREAM_ERROR",
    "Microsoft Calendar request failed.",
  );
}

export class MicrosoftCalendarClient{
  constructor(
    private readonly accessToken:string,
    private readonly fetchImpl:typeof fetch=fetch,
  ){}

  private async request(
    path:string,
    init:RequestInit={},
    options:{allowNotFound?:boolean;allowNoContent?:boolean}={},
  ):Promise<unknown|null>{
    let response:Response;
    try{
      response=await this.fetchImpl(GRAPH_API+path,{
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
        "Microsoft Calendar could not be reached.",
      );
    }

    if(options.allowNotFound&&response.status===404)return null;
    if(options.allowNoContent&&(response.status===204||response.status===404))return null;
    if(!response.ok)throw mapHttpError(response.status);
    if(response.status===204)return null;
    try{return await response.json();}catch{
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected response.",
      );
    }
  }

  async createCalendar(name:string):Promise<{remoteCalendarId:string;name:string}>{
    const body=await this.request("/me/calendars",{
      method:"POST",
      body:JSON.stringify({name}),
    });
    const parsed=calendarSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected calendar response.",
      );
    }
    return {
      remoteCalendarId:parsed.data.id,
      name:parsed.data.name??name,
    };
  }

  async getCalendar(calendarId:string):Promise<{remoteCalendarId:string;name:string}|null>{
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}`,
      {method:"GET"},
      {allowNotFound:true},
    );
    if(body===null)return null;
    const parsed=calendarSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected calendar response.",
      );
    }
    return {
      remoteCalendarId:parsed.data.id,
      name:parsed.data.name??"Kairos",
    };
  }

  async getEvent(calendarId:string,eventId:string):Promise<RemoteCalendarEvent|null>{
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
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
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method:"POST",
        body:JSON.stringify({
          ...this.eventBody(projection),
          transactionId:microsoftTransactionId(syncKey),
        }),
      },
    );
    return this.parseEvent(body);
  }

  async updateEvent(
    calendarId:string,
    eventId:string,
    projection:CalendarEventProjection,
  ):Promise<RemoteCalendarEvent>{
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method:"PATCH",
        body:JSON.stringify(this.eventBody(projection)),
      },
    );
    return this.parseEvent(body);
  }

  async deleteEvent(calendarId:string,eventId:string):Promise<void>{
    await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {method:"DELETE"},
      {allowNoContent:true},
    );
  }

  private eventBody(projection:CalendarEventProjection){
    const stripZ=(value:string)=>value.endsWith("Z")?value.slice(0,-1):value;
    return {
      subject:projection.title,
      body:{contentType:"text",content:projection.description},
      start:{dateTime:stripZ(projection.startsAt),timeZone:"UTC"},
      end:{dateTime:stripZ(projection.endsAt),timeZone:"UTC"},
      showAs:"free",
    };
  }

  private parseEvent(body:unknown):RemoteCalendarEvent{
    const parsed=eventSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected event response.",
      );
    }
    return {
      remoteEventId:parsed.data.id,
      etag:parsed.data["@odata.etag"]??null,
    };
  }
}
