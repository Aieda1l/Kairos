import {describe,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {CalDavCalendarAdapter} from "@/lib/calendar/caldav/adapter";
import {
  CalDavClient,
  ICLOUD_CALDAV_ORIGIN,
} from "@/lib/calendar/caldav/client";
import {
  caldavResourceName,
  serializeCalendarEvent,
} from "@/lib/calendar/caldav/ical";

const projection:CalendarEventProjection={
  assignmentId:"assignment-1",
  title:"[CSE 331] Homework 3",
  description:"Course: CSE 331\nSource: Canvas",
  startsAt:"2026-10-09T06:59:00.000Z",
  endsAt:"2026-10-09T07:14:00.000Z",
  sourceUrl:"https://canvas.uw.edu/courses/123/assignments/987",
};

function connection(overrides:Partial<CalendarConnection>={}):CalendarConnection{
  return {
    id:"caldav-connection",
    provider:"caldav",
    label:"Apple iCloud Calendar",
    accountLabel:"student@example.com",
    remoteCalendarId:"https://p12-caldav.icloud.com/123/calendars/kairos/",
    remoteCalendarName:"Kairos",
    enabled:true,
    lastSyncStartedAt:null,
    lastSyncCompletedAt:null,
    lastSyncStatus:"never",
    lastErrorCode:null,
    ...overrides,
  };
}

describe("CalDAV event serialization",()=>{
  it("uses stable resource names and UIDs without reminders",()=>{
    const syncKey="fixture-sync-key";
    const resource=caldavResourceName(syncKey);
    expect(resource).toMatch(/^[a-f0-9]{64}\.ics$/);
    expect(caldavResourceName(syncKey)).toBe(resource);
    const ics=serializeCalendarEvent(projection,syncKey);
    expect(ics).toContain("UID:"+resource.replace(/\.ics$/,"")+"@kairos.local");
    expect(ics).toContain("DTSTART:20261009T065900Z");
    expect(ics).toContain("DTEND:20261009T071400Z");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics).toContain("SUMMARY:[CSE 331] Homework 3");
    expect(ics).not.toContain("VALARM");
  });
});

describe("Apple iCloud CalDAV client",()=>{
  it("discovers a writable Kairos calendar through Apple partition URLs",async()=>{
    const calls:Array<{url:string;method:string;authorization:string|null}>=[];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      calls.push({
        url,
        method:init?.method??"GET",
        authorization:new Headers(init?.headers).get("authorization"),
      });
      if(url===ICLOUD_CALDAV_ORIGIN){
        return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>https://p12-caldav.icloud.com/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
      }
      if(url==="https://p12-caldav.icloud.com/123/principal/"){
        return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>https://p12-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
      }
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/kairos/</d:href><d:propstat><d:prop><d:displayname>Kairos</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
    });
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as typeof fetch);
    await expect(client.discoverCalendars()).resolves.toEqual([
      {
        remoteCalendarId:"https://p12-caldav.icloud.com/123/calendars/kairos/",
        name:"Kairos",
        writable:true,
      },
    ]);
    expect(calls.every(call=>call.authorization?.startsWith("Basic "))).toBe(true);
    expect(calls.map(call=>call.url)).toEqual([
      "https://caldav.icloud.com/",
      "https://p12-caldav.icloud.com/123/principal/",
      "https://p12-caldav.icloud.com/123/calendars/",
    ]);
  });

  it("refuses foreign discovery URLs before sending credentials",async()=>{
    const authValues:string[]=[];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      authValues.push(new Headers(init?.headers).get("authorization")??"");
      expect(String(input)).toBe(ICLOUD_CALDAV_ORIGIN);
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>https://evil.example/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
    });
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as typeof fetch);
    await expect(client.discoverCalendars()).rejects.toMatchObject({code:"CALDAV_DISCOVERY_FAILED"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authValues).toHaveLength(1);
  });

  it("validates authenticated redirects manually before retrying",async()=>{
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status:302,headers:{location:"https://evil.example/redirect"}}));
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as unknown as typeof fetch);
    await expect(client.discoverCalendars()).rejects.toMatchObject({code:"CALDAV_DISCOVERY_FAILED"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({redirect:"manual"});
  });

  it("creates, reads, updates, and deletes one deterministic DAV resource",async()=>{
    const calls:Array<{url:string;method:string;headers:Headers;body:string}>= [];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      calls.push({
        url:String(input),
        method:init?.method??"GET",
        headers:new Headers(init?.headers),
        body:String(init?.body??""),
      });
      if((init?.method??"GET")==="HEAD")return new Response(null,{status:200,headers:{etag:"etag-current"}});
      if(init?.method==="DELETE")return new Response(null,{status:204});
      return new Response(null,{status:201,headers:{etag:"etag-next"}});
    });
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as typeof fetch);
    const calendarId="https://p12-caldav.icloud.com/123/calendars/kairos/";
    const syncKey="stable-sync-key";
    const created=await client.createEvent(calendarId,projection,syncKey);
    expect(created.remoteEventId).toBe(caldavResourceName(syncKey));
    expect(calls[0]!.url).toBe(calendarId+caldavResourceName(syncKey));
    expect(calls[0]!.headers.get("if-none-match")).toBe("*");
    expect(calls[0]!.body).not.toContain("VALARM");

    await expect(client.getEvent(calendarId,created.remoteEventId)).resolves.toEqual({
      remoteEventId:created.remoteEventId,
      etag:"etag-current",
    });
    await client.updateEvent(calendarId,created.remoteEventId,projection,"etag-current");
    expect(calls[2]!.headers.get("if-match")).toBe("etag-current");
    const uid=created.remoteEventId.replace(/\.ics$/,"")+"@kairos.local";
    expect(calls[2]!.body).toContain("UID:"+uid);
    await client.deleteEvent(calendarId,created.remoteEventId);
    expect(calls[3]!.method).toBe("DELETE");
  });

  it("treats deleted remote events as absent and deleted calendars as missing",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const method=init?.method??"GET";
      if(method==="PROPFIND")return new Response("not found",{status:404});
      return new Response("not found",{status:404});
    });
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as typeof fetch);
    await expect(client.getEvent("https://p12-caldav.icloud.com/123/calendars/kairos/","event.ics")).resolves.toBeNull();
    const adapter=new CalDavCalendarAdapter(connection(),client);
    await expect(adapter.testConnection()).rejects.toMatchObject({code:"CALENDAR_REMOTE_CALENDAR_MISSING"});
  });

  it("creates a dedicated Kairos collection only during explicit ensureCalendar",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==="PROPFIND"){
        if(String(input)===ICLOUD_CALDAV_ORIGIN){
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>https://p12-caldav.icloud.com/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
        }
        if(String(input).endsWith("/principal/")){
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>https://p12-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
        }
        return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>`,{status:207});
      }
      expect(init?.method).toBe("MKCALENDAR");
      expect(String(input)).toBe("https://p12-caldav.icloud.com/123/calendars/kairos/");
      return new Response(null,{status:201});
    });
    const client=new CalDavClient("student@example.com","fixture-app-password",fetchMock as typeof fetch);
    const adapter=new CalDavCalendarAdapter(connection({remoteCalendarId:null,remoteCalendarName:null}),client);
    await expect(adapter.ensureCalendar()).resolves.toEqual({
      remoteCalendarId:"https://p12-caldav.icloud.com/123/calendars/kairos/",
      name:"Kairos",
    });
  });

  it.each([
    [403,"CALDAV_NOT_WRITABLE"],
    [429,"CALENDAR_RATE_LIMITED"],
    [500,"CALENDAR_UPSTREAM_ERROR"],
  ] as const)("maps DAV HTTP %s failures",async(status,code)=>{
    const client=new CalDavClient(
      "student@example.com",
      "fixture-app-password",
      vi.fn(async()=>new Response("failure",{status})) as unknown as typeof fetch,
    );
    await expect(client.discoverCalendars()).rejects.toMatchObject({code});
  });

  it("maps network failures without leaking the app-specific password",async()=>{
    const secret="fixture-app-password-never-echo";
    const client=new CalDavClient(
      "student@example.com",
      secret,
      vi.fn(async()=>{throw new Error("network "+secret);}) as unknown as typeof fetch,
    );
    try{
      await client.discoverCalendars();
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code:"CALENDAR_NETWORK_ERROR"});
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
