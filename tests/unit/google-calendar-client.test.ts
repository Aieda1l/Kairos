import {describe,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {GoogleCalendarAdapter} from "@/lib/calendar/google/adapter";
import {GoogleCalendarClient,googleEventId} from "@/lib/calendar/google/client";

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
    id:"calendar-connection",
    provider:"google",
    label:"Google",
    accountLabel:null,
    remoteCalendarId:"kairos-calendar-id",
    remoteCalendarName:"Kairos",
    enabled:true,
    lastSyncStartedAt:null,
    lastSyncCompletedAt:null,
    lastSyncStatus:"never",
    lastErrorCode:null,
    ...overrides,
  };
}

describe("Google Calendar client",()=>{
  it("uses deterministic base32hex-compatible event IDs",()=>{
    const first=googleEventId("fixture-sync-key");
    expect(first).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(googleEventId("fixture-sync-key")).toBe(first);
    expect(googleEventId("another-key")).not.toBe(first);
  });

  it("creates a secondary Kairos calendar at the fixed API origin",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://www.googleapis.com/calendar/v3/calendars");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-access");
      expect(JSON.parse(String(init?.body))).toEqual({summary:"Kairos"});
      return Response.json({id:"remote-calendar",summary:"Kairos"});
    });
    const client=new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.createCalendar("Kairos")).resolves.toEqual({
      remoteCalendarId:"remote-calendar",
      name:"Kairos",
    });
  });

  it("writes transparent deadline events without reminder or meeting fields",async()=>{
    const calls:Array<{url:string;method:string;body:Record<string,unknown>}>= [];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      calls.push({
        url:String(input),
        method:init?.method??"GET",
        body:init?.body?JSON.parse(String(init.body)): {},
      });
      return Response.json({id:"event-1",etag:"etag-1"});
    });
    const client=new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch);
    const syncKey="stable-sync-key";
    await client.createEvent("calendar/id",projection,syncKey);
    await client.createEvent("calendar/id",projection,syncKey);
    const expectedId=googleEventId(syncKey);
    expect(calls).toHaveLength(2);
    for(const call of calls){
      expect(call.url).toBe("https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events");
      expect(call.method).toBe("POST");
      expect(call.body).toMatchObject({
        id:expectedId,
        summary:projection.title,
        description:projection.description,
        start:{dateTime:projection.startsAt,timeZone:"UTC"},
        end:{dateTime:projection.endsAt,timeZone:"UTC"},
        transparency:"transparent",
      });
      expect(call.body).not.toHaveProperty("attendees");
      expect(call.body).not.toHaveProperty("location");
      expect(call.body).not.toHaveProperty("conferenceData");
      expect(call.body).not.toHaveProperty("reminders");
    }
  });

  it("recovers an already-created deterministic event after a duplicate-ID retry",async()=>{
    const syncKey="lost-response-sync-key";
    const eventId=googleEventId(syncKey);
    const calls:Array<{url:string;method:string}>=[];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const method=init?.method??"GET";
      calls.push({url,method});
      if(method==="POST"){
        return new Response(JSON.stringify({
          error:{code:409,message:"The requested identifier already exists."},
        }),{status:409,headers:{"content-type":"application/json"}});
      }
      return Response.json({id:eventId,etag:"existing-etag"});
    });
    const client=new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.createEvent("calendar/id",projection,syncKey)).resolves.toEqual({
      remoteEventId:eventId,
      etag:"existing-etag",
    });
    expect(calls).toEqual([
      {
        method:"POST",
        url:"https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events",
      },
      {
        method:"GET",
        url:`https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events/${eventId}`,
      },
    ]);
  });

  it("gets, updates, and deletes only the stored calendar/event IDs",async()=>{
    const calls:Array<{url:string;method:string;body?:Record<string,unknown>}>= [];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const method=init?.method??"GET";
      calls.push({url:String(input),method,body:init?.body?JSON.parse(String(init.body)):undefined});
      if(method==="DELETE")return new Response(null,{status:204});
      return Response.json({id:"event/id",etag:"etag-next"});
    });
    const client=new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.getEvent("calendar/id","event/id")).resolves.toEqual({remoteEventId:"event/id",etag:"etag-next"});
    await client.updateEvent("calendar/id","event/id",projection);
    await client.deleteEvent("calendar/id","event/id");
    expect(calls.map(call=>[call.method,call.url])).toEqual([
      ["GET","https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events/event%2Fid"],
      ["PATCH","https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events/event%2Fid"],
      ["DELETE","https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events/event%2Fid"],
    ]);
    expect(calls[1]!.body).not.toHaveProperty("id");
  });

  it("maps missing calendars through the adapter without recreating them",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({error:{message:"not found"}}),{status:404}));
    const adapter=new GoogleCalendarAdapter(
      connection(),
      new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.testConnection()).rejects.toMatchObject({
      code:"CALENDAR_REMOTE_CALENDAR_MISSING",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/kairos-calendar-id",
      expect.objectContaining({method:"GET"}),
    );
  });

  it("lets explicit connect create the Kairos calendar",async()=>{
    const fetchMock=vi.fn(async()=>Response.json({id:"new-calendar",summary:"Kairos"}));
    const adapter=new GoogleCalendarAdapter(
      connection({remoteCalendarId:null,remoteCalendarName:null}),
      new GoogleCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.ensureCalendar()).resolves.toEqual({remoteCalendarId:"new-calendar",name:"Kairos"});
  });

  it.each([
    [429,"CALENDAR_RATE_LIMITED"],
    [500,"CALENDAR_UPSTREAM_ERROR"],
  ] as const)("maps Google HTTP %s failures",async(status,code)=>{
    const client=new GoogleCalendarClient("fixture-access",vi.fn(async()=>new Response("failure",{status})) as unknown as typeof fetch);
    await expect(client.createCalendar("Kairos")).rejects.toMatchObject({code});
  });

  it("maps network failures without leaking the access token",async()=>{
    const secret="fixture-access-token-never-echo";
    const client=new GoogleCalendarClient(secret,vi.fn(async()=>{throw new Error("network "+secret);}) as unknown as typeof fetch);
    try{
      await client.createCalendar("Kairos");
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code:"CALENDAR_NETWORK_ERROR"});
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
