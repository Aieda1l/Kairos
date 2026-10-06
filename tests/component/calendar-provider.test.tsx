// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";
import {CalendarSyncProvider,useCalendarSync} from "@/features/calendars/calendar-provider";

const google:CalendarConnection={
  id:"google-1",provider:"google",label:"Google Calendar",accountLabel:null,
  remoteCalendarId:"remote-google",remoteCalendarName:"Kairos",enabled:true,
  lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
};
const apple:CalendarConnection={
  id:"apple-1",provider:"caldav",label:"Apple iCloud Calendar",accountLabel:"student@example.com",
  remoteCalendarId:"remote-apple",remoteCalendarName:"Kairos",enabled:true,
  lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
};

function Harness(){
  const calendar=useCalendarSync();
  return <div>
    <span data-testid="count">{calendar.connections.length}</span>
    <span data-testid="gmsg">{calendar.messageFor("google-1")}</span>
    <button onClick={()=>void calendar.syncConnection("google-1")}>sync google</button>
    <button onClick={()=>void calendar.disconnect("apple-1")}>disconnect apple</button>
  </div>;
}

beforeEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates one provider state without erasing other connections",async()=>{
  const user=userEvent.setup();
  const fresh=new Date().toISOString();
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith("/google-1/sync"))return Response.json({status:"error",errorCode:"CALENDAR_UPSTREAM_ERROR"});
    if(url.endsWith("/apple-1/disconnect"))return Response.json({ok:true});
    throw new Error("unexpected request "+url);
  });
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[
    {...google,lastSyncCompletedAt:fresh,lastSyncStatus:"success"},
    {...apple,lastSyncCompletedAt:fresh,lastSyncStatus:"success"},
  ]}><Harness/></CalendarSyncProvider>);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"sync google"}));
  expect(screen.getByTestId("gmsg")).toHaveTextContent(/could not be synchronized/i);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"disconnect apple"}));
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not auto-sync when there are no calendar destinations",async()=>{
  const fetchMock=vi.fn();
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[]}><div>child</div></CalendarSyncProvider>);
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not auto-sync a destination reconciled less than 15 minutes ago",async()=>{
  const now=Date.now();
  vi.spyOn(Date,"now").mockReturnValue(now);
  const fetchMock=vi.fn();
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:new Date(now-5*60*1000).toISOString(),
    lastSyncStatus:"success",
  }]}><div>child</div></CalendarSyncProvider>);
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).not.toHaveBeenCalled();
});

it("auto-syncs a stale destination once and refreshes again only after another 15 minutes",async()=>{
  let now=Date.parse("2026-10-06T01:30:00.000Z");
  vi.spyOn(Date,"now").mockImplementation(()=>now);
  const fetchMock=vi.fn(async()=>Response.json({
    status:"success",
    results:[{
      connectionId:"google-1",
      status:"success",
      completedAt:new Date(now).toISOString(),
      errorCode:null,
    }],
  }));
  vi.stubGlobal("fetch",fetchMock);

  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:new Date(now-16*60*1000).toISOString(),
    lastSyncStatus:"success",
  }]}><div>child</div></CalendarSyncProvider>);

  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/calendars/sync-all",{method:"POST"});

  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).toHaveBeenCalledTimes(1);

  now+=16*60*1000;
  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
});

it("does not start overlapping auto-syncs on repeated visibility events",async()=>{
  const now=Date.now();
  vi.spyOn(Date,"now").mockReturnValue(now);
  let release!:(response:Response)=>void;
  const gate=new Promise<Response>(resolve=>{release=resolve;});
  const fetchMock=vi.fn(()=>gate);
  vi.stubGlobal("fetch",fetchMock);

  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:null,
    lastSyncStatus:"never",
  }]}><div>child</div></CalendarSyncProvider>);

  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  act(()=>{
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async()=>{
    release(Response.json({status:"success",results:[]}));
    await gate;
  });
});
