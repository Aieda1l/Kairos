// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
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

beforeEach(()=>vi.restoreAllMocks());
afterEach(()=>vi.restoreAllMocks());

it("updates one provider state without erasing other connections",async()=>{
  const user=userEvent.setup();
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith("/google-1/sync"))return Response.json({status:"error",errorCode:"CALENDAR_UPSTREAM_ERROR"});
    if(url.endsWith("/apple-1/disconnect"))return Response.json({ok:true});
    throw new Error("unexpected request");
  });
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[google,apple]}><Harness/></CalendarSyncProvider>);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"sync google"}));
  expect(screen.getByTestId("gmsg")).toHaveTextContent(/could not be synchronized/i);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"disconnect apple"}));
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
