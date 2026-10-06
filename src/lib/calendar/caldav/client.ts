import "server-only";
import type {RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
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
const CREATE_BODY=`<?xml version="1.0" encoding="UTF-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>Kairos</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;

function mapHttp(status:number):CalendarSyncError{
  if(status===401)return new CalendarSyncError(
    "CALENDAR_AUTH_REQUIRED",
    "Apple rejected the Apple Account email or app-specific password. Generate a new app-specific password and reconnect.",
  );
  if(status===403)return new CalendarSyncError("CALDAV_NOT_WRITABLE","Apple Calendar is not writable with this credential.");
  if(status===429)return new CalendarSyncError("CALENDAR_RATE_LIMITED","Apple Calendar is rate limiting requests.");
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
    for(let redirectCount=0;redirectCount<4;redirectCount++){
      let response:Response;
      try{
        response=await this.fetchImpl(url,{
          ...init,
          redirect:"manual",
          headers:{
            authorization:this.authorization,
            ...(init.headers??{}),
          },
        });
      }catch{
        throw new CalendarSyncError("CALENDAR_NETWORK_ERROR","Apple Calendar could not be reached.");
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
    const target=resolveAppleDavUrl(context.home,"kairos/");
    try{
      await this.request(target,{
        method:"MKCALENDAR",
        headers:{"content-type":"application/xml; charset=utf-8"},
        body:CREATE_BODY,
      });
    }catch(error){
      if(error instanceof CalendarSyncError&&error.code==="CALDAV_NOT_WRITABLE"){
        throw new CalendarSyncError(
          "CALDAV_NOT_WRITABLE",
          "Apple accepted the credentials but would not create a new calendar through CalDAV. Create a calendar named Kairos in iCloud Calendar, then reconnect.",
        );
      }
      throw error;
    }
    return {remoteCalendarId:target.href,name};
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
    const response=await this.request(target,{method:"HEAD"},{allowNotFound:true});
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
    const response=await this.request(target,{
      method:"PUT",
      headers:{"content-type":"text/calendar; charset=utf-8","if-none-match":"*"},
      body:serializeCalendarEvent(projection,syncKey),
    },{allowPrecondition:true});
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
    const response=await this.request(target,{
      method:"PUT",
      headers,
      body:serializeCalendarEvent(
        projection,
        eventId,
        eventId.replace(/\.ics$/,""),
      ),
    });
    return {remoteEventId:eventId,etag:response?.headers.get("etag")??null};
  }

  async deleteEvent(calendarId:string,eventId:string):Promise<void>{
    const calendar=resolveAppleDavUrl(new URL(ICLOUD_CALDAV_ORIGIN),calendarId);
    const target=resolveAppleDavUrl(calendar,eventId);
    await this.request(target,{method:"DELETE"},{allowNotFound:true});
  }
}
