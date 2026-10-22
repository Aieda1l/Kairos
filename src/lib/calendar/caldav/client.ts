import "server-only";
import type {RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {calendarTransportError} from '@/lib/calendar/transport-error';
import {withCaldavPutConfirmation} from '@/lib/abuse/operation-lock';
import {conditionalCaldavPut} from './conditional-put';
import ICAL from 'ical.js';
import {
  parseCalendarCollections,
  parseCalendarHomeSet,
  parseCurrentUserPrincipal,
  resolveAppleDavUrl,
} from "@/lib/calendar/caldav/xml";
import {caldavResourceName,serializeCalendarEvent} from "@/lib/calendar/caldav/ical";

export const ICLOUD_CALDAV_ORIGIN="https://caldav.icloud.com/";

const PRINCIPAL_BODY=`<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const HOME_BODY=`<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const CALENDARS_BODY=`<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><d:current-user-privilege-set/></d:prop></d:propfind>`;

class CalDavServerError extends CalendarSyncError{}
function ambiguousResponse(error:unknown):error is CalendarSyncError{
  return error instanceof CalDavServerError||error instanceof CalendarSyncError&&error.code==='CALENDAR_NETWORK_ERROR';
}
function mapHttp(status:number):CalendarSyncError{
  if(status===401)return new CalendarSyncError(
    "CALENDAR_AUTH_REQUIRED",
    "Apple rejected the Apple Account email or app-specific password. Generate a new app-specific password and reconnect.",
  );
  if(status===403)return new CalendarSyncError("CALDAV_NOT_WRITABLE","Apple Calendar is not writable with this credential.");
  if(status===429)return new CalendarSyncError("CALENDAR_RATE_LIMITED","Apple Calendar is rate limiting requests.");
  if(status>=500)return new CalDavServerError("CALENDAR_UPSTREAM_ERROR","Apple Calendar request failed.");
  return new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","Apple Calendar request failed.");
}

export class CalDavClient{
  private readonly authorization:string;
  constructor(
    private readonly username:string,
    private readonly secret:string,
    private readonly fetchImpl:typeof fetch=fetch,
  ){
    this.authorization="Basic "+Buffer.from(`${username}:${secret}`).toString("base64");
  }

  private async request(
    input:URL|string,
    init:RequestInit={},
    options:{allowNotFound?:boolean;allowPrecondition?:boolean}={},
  ):Promise<Response|null>{
    let url=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),String(input));
    const fetchImpl=this.fetchImpl;
    for(let redirectCount=0;redirectCount<4;redirectCount++){
      let response:Response;
      try{
        response=await fetchImpl(url,{
          ...init,
          redirect:"manual",
          headers:{
            authorization:this.authorization,
            ...(init.headers??{}),
          },
        });
      }catch(error){
        throw calendarTransportError(error,'Apple Calendar could not be reached.');
      }
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get("location");
        if(!location)throw new CalendarSyncError("CALDAV_DISCOVERY_FAILED","Apple Calendar returned an invalid redirect.");
        url=resolveAppleDavUrl(url,location);
        continue;
      }
      if(options.allowNotFound&&response.status===404)return null;
      if(options.allowPrecondition&&response.status===412)return response;
      if(!response.ok)throw mapHttp(response.status);
      return response;
    }
    throw new CalendarSyncError("CALDAV_DISCOVERY_FAILED","Apple Calendar returned too many redirects.");
  }

  private async confirmEvent(target:URL,body:string):Promise<RemoteCalendarEvent|null>{
    const response=await this.request(target,{method:'GET'},{allowNotFound:true});
    if(!response)return null;
    if(!response.body)throw new Error('Calendar confirmation unavailable.');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>65536)throw new Error('Calendar confirmation exceeded its bound.');chunks.push(next.value);}
    }finally{void reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const expected=new ICAL.Component(ICAL.parse(body)),actual=new ICAL.Component(ICAL.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    const a=actual.getAllSubcomponents('vevent'),e=expected.getFirstSubcomponent('vevent');
    if(a.length!==1||!e||actual.getFirstPropertyValue('prodid')!==expected.getFirstPropertyValue('prodid')
      ||['rrule','rdate','recurrence-id'].some(name=>a[0]!.hasProperty(name)))return null;
    const event=new ICAL.Event(a[0]!),wanted=new ICAL.Event(e);
    if(event.uid!==wanted.uid||event.summary!==wanted.summary||event.description!==wanted.description
      ||event.startDate.isDate||event.endDate.isDate
      ||event.startDate.zone.tzid!=='UTC'||event.endDate.zone.tzid!=='UTC'
      ||event.startDate.toJSDate().toISOString()!==wanted.startDate.toJSDate().toISOString()
      ||event.endDate.toJSDate().toISOString()!==wanted.endDate.toJSDate().toISOString())return null;
    return {remoteEventId:target.pathname.split('/').at(-1)!,etag:response.headers.get('etag')};
  }

  private async putEvent(target:URL,init:RequestInit):Promise<Response|null|RemoteCalendarEvent>{
    return withCaldavPutConfirmation(target,init,async confirm=>{
      let ambiguity:CalendarSyncError;
      try{return await this.request(target,init,{allowPrecondition:true});}
      catch(error){
        if(!conditionalCaldavPut(target,init)||!ambiguousResponse(error))throw error;
        ambiguity=error;
      }
      // No second write until readback has checked the exact deterministic URL.
      // One retry reuses its original body and If-None-Match/strong If-Match.
      for(let attempt=0;attempt<2;attempt++){
        try{const existing=await this.confirmEvent(target,init.body as string);if(existing){confirm();return existing;}}
        catch{throw ambiguity;}
        if(attempt===1)break;
        try{
          const response=await this.request(target,init,{allowPrecondition:true});
          if(response?.status!==412){confirm();return response;}
        }catch(error){
          if(!ambiguousResponse(error))throw ambiguity;
        }
      }
      throw ambiguity;
    });
  }

  private async discoveryContext():Promise<{
    home:URL;
    calendars:Array<{remoteCalendarId:string;name:string;writable:boolean}>;
  }>{
    const root=new URL(ICLOUD_CALDAV_ORIGIN);
    const principalResponse=await this.request(root,{
      method:"PROPFIND",
      headers:{depth:"0","content-type":"application/xml; charset=utf-8"},
      body:PRINCIPAL_BODY,
    });
    const principalXml=await principalResponse!.text();
    const principal=resolveAppleDavUrl(root,parseCurrentUserPrincipal(principalXml));

    const homeResponse=await this.request(principal,{
      method:"PROPFIND",
      headers:{depth:"0","content-type":"application/xml; charset=utf-8"},
      body:HOME_BODY,
    });
    const homeXml=await homeResponse!.text();
    const home=resolveAppleDavUrl(principal,parseCalendarHomeSet(homeXml));

    const calendarsResponse=await this.request(home,{
      method:"PROPFIND",
      headers:{depth:"1","content-type":"application/xml; charset=utf-8"},
      body:CALENDARS_BODY,
    });
    const collections=parseCalendarCollections(await calendarsResponse!.text());
    return {
      home,
      calendars:collections.map(item=>({
        remoteCalendarId:resolveAppleDavUrl(home,item.href).href,
        name:item.name,
        writable:item.writable,
      })),
    };
  }

  async discoverCalendars():Promise<Array<{remoteCalendarId:string;name:string;writable:boolean}>>{
    return (await this.discoveryContext()).calendars;
  }

  async createCalendar(name:string):Promise<{remoteCalendarId:string;name:string}>{
    const context=await this.discoveryContext();
    const existing=context.calendars.find(item=>item.name===name&&item.writable);
    if(existing)return {remoteCalendarId:existing.remoteCalendarId,name:existing.name};
    // Workers fetch cannot issue MKCALENDAR, so use a calendar created in iCloud itself.
    throw new CalendarSyncError(
      "CALDAV_NOT_WRITABLE",
      "Kairos cannot create an iCloud calendar from this environment. Create a calendar named Kairos in iCloud Calendar, then reconnect.",
    );
  }

  async getCalendar(calendarId:string):Promise<{remoteCalendarId:string;name:string}|null>{
    const target=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const response=await this.request(target,{
      method:"PROPFIND",
      headers:{depth:"0","content-type":"application/xml; charset=utf-8"},
      body:CALENDARS_BODY,
    },{allowNotFound:true});
    if(!response)return null;
    const parsed=parseCalendarCollections(await response.text());
    const first=parsed[0];
    return {remoteCalendarId:target.href,name:first?.name??"Kairos"};
  }

  async getEvent(calendarId:string,eventId:string):Promise<RemoteCalendarEvent|null>{
    const calendar=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const target=resolveAppleDavUrl(calendar,eventId);
    const response=await this.request(target,{method:"GET"},{allowNotFound:true});
    if(!response)return null;
    return {remoteEventId:eventId,etag:response.headers.get("etag")};
  }

  async createEvent(
    calendarId:string,
    projection:CalendarEventProjection,
    syncKey:string,
  ):Promise<RemoteCalendarEvent>{
    const calendar=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const eventId=caldavResourceName(syncKey);
    const target=resolveAppleDavUrl(calendar,eventId);
    const response=await this.putEvent(target,{
      method:"PUT",
      headers:{"content-type":"text/calendar; charset=utf-8","if-none-match":"*"},
      body:serializeCalendarEvent(projection,syncKey),
    });
    if(response&&'remoteEventId' in response)return response;
    if(response?.status===412){
      const existing=await this.getEvent(calendar.href,eventId);
      if(existing)return existing;
      throw new CalendarSyncError("CALENDAR_EVENT_INVALID","Apple Calendar could not confirm an existing event.");
    }
    return {remoteEventId:eventId,etag:response?.headers.get("etag")??null};
  }

  async updateEvent(
    calendarId:string,
    eventId:string,
    projection:CalendarEventProjection,
    etag:string|null=null,
  ):Promise<RemoteCalendarEvent>{
    const calendar=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const target=resolveAppleDavUrl(calendar,eventId);
    const headers:Record<string,string>={"content-type":"text/calendar; charset=utf-8"};
    if(etag)headers["if-match"]=etag;
    const response=await this.putEvent(target,{
      method:"PUT",
      headers,
      body:serializeCalendarEvent(
        projection,
        eventId,
        eventId.replace(/\.ics$/,""),
      ),
    });
    if(response&&'remoteEventId' in response)return response;
    if(response?.status===412)throw new CalendarSyncError('CALENDAR_EVENT_INVALID','The iCloud event changed before this update. Refresh synchronization before retrying.');
    return {remoteEventId:eventId,etag:response?.headers.get("etag")??null};
  }

  async deleteEvent(calendarId:string,eventId:string):Promise<void>{
    const calendar=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const target=resolveAppleDavUrl(calendar,eventId);
    await this.request(target,{method:"DELETE"},{allowNotFound:true});
  }
}
