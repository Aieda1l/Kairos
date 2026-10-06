import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";

const GRAPH_API="https://graph.microsoft.com/v1.0";

export const MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID=
  "String {2f7d7a8c-8936-4e44-a436-9d7878afc0b1} Name KairosAssignmentId";

const calendarSchema=z.object({
  id:z.string().min(1),
  name:z.string().optional(),
  canEdit:z.boolean().optional(),
}).passthrough();

const calendarListSchema=z.object({
  value:z.array(calendarSchema),
}).passthrough();

const extendedPropertySchema=z.object({
  id:z.string().min(1),
  value:z.string(),
}).passthrough();

const eventSchema=z.object({
  id:z.string().min(1),
  "@odata.etag":z.string().optional(),
  singleValueExtendedProperties:z.array(extendedPropertySchema).optional(),
}).passthrough();

const eventListSchema=z.object({
  value:z.array(eventSchema),
}).passthrough();

function odataString(value:string):string{
  return value.replaceAll("'","''");
}

function assignmentPropertyExpand():string{
  return `singleValueExtendedProperties($filter=id eq '${odataString(MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID)}')`;
}

function eventQuery(params:Record<string,string>):string{
  return new URLSearchParams(params).toString();
}

export function microsoftTransactionId(syncKey:string):string{
  const hex=createHash("sha256").update(syncKey).digest("hex").slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

function safeProviderCode(body:unknown):string|null{
  if(!body||typeof body!=="object"||Array.isArray(body))return null;
  const error="error" in body?body.error:null;
  if(!error||typeof error!=="object"||Array.isArray(error)||!("code" in error))return null;
  const code=error.code;
  return typeof code==="string"&&/^[A-Za-z0-9_.-]{1,80}$/.test(code)?code:null;
}

function mapHttpError(status:number,providerCode:string|null):CalendarSyncError{
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
  const suffix=providerCode?" (Microsoft Graph: "+providerCode+")":"";
  return new CalendarSyncError(
    "CALENDAR_UPSTREAM_ERROR",
    "Microsoft Calendar request failed"+suffix+".",
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
    if(!response.ok){
      let body:unknown=null;
      try{body=await response.json();}catch{}
      throw mapHttpError(response.status,safeProviderCode(body));
    }
    if(response.status===204)return null;
    try{return await response.json();}catch{
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected response.",
      );
    }
  }

  async findCalendarByName(name:string):Promise<{remoteCalendarId:string;name:string}|null>{
    const body=await this.request("/me/calendars",{method:"GET"});
    const parsed=calendarListSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected calendar list response.",
      );
    }
    const match=parsed.data.value.find(calendar=>
      calendar.name===name&&calendar.canEdit!==false
    );
    return match
      ?{remoteCalendarId:match.id,name:match.name??name}
      :null;
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
    const query=eventQuery({"$expand":assignmentPropertyExpand()});
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${query}`,
      {method:"GET"},
      {allowNotFound:true},
    );
    if(body===null)return null;
    return this.parseEvent(body);
  }

  async findEventByAssignment(
    calendarId:string,
    assignmentId:string,
  ):Promise<RemoteCalendarEvent|null>{
    const filter=
      `singleValueExtendedProperties/Any(ep: ep/id eq '${odataString(MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID)}' and ep/value eq '${odataString(assignmentId)}')`;
    const query=eventQuery({
      "$filter":filter,
      "$expand":assignmentPropertyExpand(),
      "$top":"2",
    });
    const body=await this.request(
      `/me/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      {method:"GET"},
    );
    const parsed=eventListSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected event list response.",
      );
    }
    const event=parsed.data.value[0];
    return event?this.parseEvent(event):null;
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
    return this.parseEvent(body,projection.assignmentId);
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
    return this.parseEvent(body,projection.assignmentId);
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
      singleValueExtendedProperties:[{
        id:MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
        value:projection.assignmentId,
      }],
    };
  }

  private parseEvent(body:unknown,fallbackAssignmentId?:string):RemoteCalendarEvent{
    const parsed=eventSchema.safeParse(body);
    if(!parsed.success){
      throw new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar returned an unexpected event response.",
      );
    }
    const property=parsed.data.singleValueExtendedProperties?.find(
      item=>item.id===MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
    );
    const managedAssignmentId=property?.value??fallbackAssignmentId;
    return {
      remoteEventId:parsed.data.id,
      etag:parsed.data["@odata.etag"]??null,
      ...(managedAssignmentId!==undefined?{managedAssignmentId}:{}),
    };
  }
}
