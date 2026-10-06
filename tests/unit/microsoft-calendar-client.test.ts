import {describe,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {MicrosoftCalendarAdapter} from "@/lib/calendar/microsoft/adapter";
import {
  MicrosoftCalendarClient,
  MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
  microsoftTransactionId,
} from "@/lib/calendar/microsoft/client";

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
    provider:"microsoft",
    label:"Microsoft",
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

describe("Microsoft Calendar client",()=>{
  it("uses a stable UUID-like transaction id for create retries",()=>{
    const first=microsoftTransactionId("fixture-sync-key");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(microsoftTransactionId("fixture-sync-key")).toBe(first);
    expect(microsoftTransactionId("another-key")).not.toBe(first);
  });

  it("creates a secondary Kairos calendar at the fixed Graph origin",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://graph.microsoft.com/v1.0/me/calendars");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-access");
      expect(JSON.parse(String(init?.body))).toEqual({name:"Kairos"});
      return Response.json({id:"remote-calendar",name:"Kairos"});
    });
    const client=new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.createCalendar("Kairos")).resolves.toEqual({
      remoteCalendarId:"remote-calendar",
      name:"Kairos",
    });
  });

  it("writes free UTC deadline events with stable transaction IDs and no invitation/reminder fields",async()=>{
    const calls:Array<{url:string;method:string;body:Record<string,unknown>}>= [];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      calls.push({
        url:String(input),
        method:init?.method??"GET",
        body:init?.body?JSON.parse(String(init.body)): {},
      });
      return Response.json({id:"event-1","@odata.etag":"etag-1"});
    });
    const client=new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch);
    const syncKey="stable-sync-key";
    await client.createEvent("calendar/id",projection,syncKey);
    await client.createEvent("calendar/id",projection,syncKey);
    const expectedTransactionId=microsoftTransactionId(syncKey);
    expect(calls).toHaveLength(2);
    for(const call of calls){
      expect(call.url).toBe("https://graph.microsoft.com/v1.0/me/calendars/calendar%2Fid/events");
      expect(call.method).toBe("POST");
      expect(call.body).toMatchObject({
        subject:projection.title,
        body:{contentType:"text",content:projection.description},
        start:{dateTime:"2026-10-09T06:59:00.000",timeZone:"UTC"},
        end:{dateTime:"2026-10-09T07:14:00.000",timeZone:"UTC"},
        showAs:"free",
        transactionId:expectedTransactionId,
        singleValueExtendedProperties:[{
          id:MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
          value:projection.assignmentId,
        }],
      });
      expect(call.body).not.toHaveProperty("attendees");
      expect(call.body).not.toHaveProperty("location");
      expect(call.body).not.toHaveProperty("isOnlineMeeting");
      expect(call.body).not.toHaveProperty("onlineMeetingProvider");
      expect(call.body).not.toHaveProperty("isReminderOn");
      expect(call.body).not.toHaveProperty("reminderMinutesBeforeStart");
    }
  });

  it("gets, updates, and deletes only stored calendar/event IDs",async()=>{
    const calls:Array<{url:string;method:string;body?:Record<string,unknown>}>= [];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const method=init?.method??"GET";
      calls.push({url:String(input),method,body:init?.body?JSON.parse(String(init.body)):undefined});
      if(method==="DELETE")return new Response(null,{status:204});
      return Response.json({id:"event/id","@odata.etag":"etag-next"});
    });
    const client=new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.getEvent("calendar/id","event/id")).resolves.toEqual({remoteEventId:"event/id",etag:"etag-next"});
    await client.updateEvent("calendar/id","event/id",projection);
    await client.deleteEvent("calendar/id","event/id");
    expect(calls.map(call=>[call.method,call.url])).toEqual([
      ["GET",expect.stringContaining("https://graph.microsoft.com/v1.0/me/calendars/calendar%2Fid/events/event%2Fid?")],
      ["PATCH","https://graph.microsoft.com/v1.0/me/calendars/calendar%2Fid/events/event%2Fid"],
      ["DELETE","https://graph.microsoft.com/v1.0/me/calendars/calendar%2Fid/events/event%2Fid"],
    ]);
    expect(calls[1]!.body).not.toHaveProperty("transactionId");
    expect(calls[1]!.body).toMatchObject({
      singleValueExtendedProperties:[{
        id:MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
        value:projection.assignmentId,
      }],
    });
    expect(calls[1]!.body).not.toHaveProperty("isReminderOn");
  });

  it("reads and finds the hidden Kairos assignment identity on Microsoft events",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/events/event%2Fid?")){
        expect(url).toContain("%24expand=singleValueExtendedProperties");
        return Response.json({
          id:"event/id",
          "@odata.etag":"etag-existing",
          singleValueExtendedProperties:[{
            id:MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
            value:projection.assignmentId,
          }],
        });
      }
      expect(url).toContain("/me/calendars/calendar%2Fid/events?");
      expect(url).toContain("%24filter=singleValueExtendedProperties%2FAny");
      return Response.json({value:[{
        id:"event/id",
        "@odata.etag":"etag-existing",
        singleValueExtendedProperties:[{
          id:MICROSOFT_KAIROS_ASSIGNMENT_PROPERTY_ID,
          value:projection.assignmentId,
        }],
      }]});
    });
    const client=new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.getEvent("calendar/id","event/id")).resolves.toEqual({
      remoteEventId:"event/id",
      etag:"etag-existing",
      managedAssignmentId:projection.assignmentId,
    });
    await expect(client.findEventByAssignment("calendar/id",projection.assignmentId)).resolves.toEqual({
      remoteEventId:"event/id",
      etag:"etag-existing",
      managedAssignmentId:projection.assignmentId,
    });
  });

  it("maps a missing stored calendar through the adapter without recreating it",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({error:{code:"ErrorItemNotFound"}}),{status:404}));
    const adapter=new MicrosoftCalendarAdapter(
      connection(),
      new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.testConnection()).rejects.toMatchObject({
      code:"CALENDAR_REMOTE_CALENDAR_MISSING",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/calendars/kairos-calendar-id",
      expect.objectContaining({method:"GET"}),
    );
  });

  it("lists every editable exact-name Kairos calendar instead of picking one arbitrarily",async()=>{
    const fetchMock=vi.fn(async()=>Response.json({value:[
      {id:"kairos-a",name:"Kairos",canEdit:true},
      {id:"kairos-b",name:"Kairos"},
      {id:"readonly",name:"Kairos",canEdit:false},
      {id:"other",name:"Kairos Old",canEdit:true},
    ]}));
    const client=new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch);
    await expect(client.listCalendarsByName("Kairos")).resolves.toEqual([
      {remoteCalendarId:"kairos-a",name:"Kairos"},
      {remoteCalendarId:"kairos-b",name:"Kairos"},
    ]);
  });

  it("rejects ambiguous duplicate Kairos calendars instead of silently binding one",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith("/me/calendars/kairos-calendar-id")){
        return Response.json({id:"kairos-calendar-id",name:"Kairos"});
      }
      expect(url).toBe("https://graph.microsoft.com/v1.0/me/calendars");
      return Response.json({value:[
        {id:"kairos-calendar-id",name:"Kairos"},
        {id:"kairos-other",name:"Kairos"},
      ]});
    });
    const adapter=new MicrosoftCalendarAdapter(
      connection(),
      new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.testConnection()).rejects.toMatchObject({
      code:"CALENDAR_CONFIG_MISSING",
    });
    await expect(adapter.ensureCalendar()).rejects.toMatchObject({
      code:"CALENDAR_CONFIG_MISSING",
    });
  });

  it("reuses an existing Kairos calendar before creating another on reconnect",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://graph.microsoft.com/v1.0/me/calendars");
      expect(init?.method??"GET").toBe("GET");
      return Response.json({value:[
        {id:"other-calendar",name:"Personal"},
        {id:"existing-kairos",name:"Kairos"},
      ]});
    });
    const adapter=new MicrosoftCalendarAdapter(
      connection({remoteCalendarId:null,remoteCalendarName:null}),
      new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.ensureCalendar()).resolves.toEqual({
      remoteCalendarId:"existing-kairos",
      name:"Kairos",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the Kairos calendar only when no exact existing calendar is present",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if((init?.method??"GET")==="GET"){
        return Response.json({value:[{id:"other-calendar",name:"Personal"}]});
      }
      expect(String(input)).toBe("https://graph.microsoft.com/v1.0/me/calendars");
      expect(init?.method).toBe("POST");
      return Response.json({id:"new-calendar",name:"Kairos"},{status:201});
    });
    const adapter=new MicrosoftCalendarAdapter(
      connection({remoteCalendarId:null,remoteCalendarName:null}),
      new MicrosoftCalendarClient("fixture-access",fetchMock as typeof fetch),
    );
    await expect(adapter.ensureCalendar()).resolves.toEqual({remoteCalendarId:"new-calendar",name:"Kairos"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a safe Microsoft Graph error code without echoing provider messages",async()=>{
    const client=new MicrosoftCalendarClient(
      "fixture-access",
      vi.fn(async()=>Response.json({
        error:{
          code:"MailboxNotEnabledForRESTAPI",
          message:"private provider diagnostic that should not be echoed",
        },
      },{status:400})) as unknown as typeof fetch,
    );
    try{
      await client.createCalendar("Kairos");
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code:"CALENDAR_UPSTREAM_ERROR"});
      expect((error as Error).message).toContain("MailboxNotEnabledForRESTAPI");
      expect((error as Error).message).not.toContain("private provider diagnostic");
    }
  });

  it.each([
    [429,"CALENDAR_RATE_LIMITED"],
    [500,"CALENDAR_UPSTREAM_ERROR"],
  ] as const)("maps Graph HTTP %s failures",async(status,code)=>{
    const client=new MicrosoftCalendarClient("fixture-access",vi.fn(async()=>new Response("failure",{status})) as unknown as typeof fetch);
    await expect(client.createCalendar("Kairos")).rejects.toMatchObject({code});
  });

  it("maps network failures without leaking access tokens",async()=>{
    const secret="fixture-ms-access-token-never-echo";
    const client=new MicrosoftCalendarClient(secret,vi.fn(async()=>{throw new Error("network "+secret);}) as unknown as typeof fetch);
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
