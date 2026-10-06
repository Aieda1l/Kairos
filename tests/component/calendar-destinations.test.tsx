// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";

const state=vi.hoisted(()=>({
  connections:[] as CalendarConnection[],
  testIcloud:vi.fn(async()=>true),
  connectIcloud:vi.fn(async()=>true),
  startGoogle:vi.fn(async()=>undefined),
  startMicrosoft:vi.fn(async()=>undefined),
  syncConnection:vi.fn(async()=>undefined),
  removeEvents:vi.fn(async()=>undefined),
  disconnect:vi.fn(async()=>undefined),
  phaseFor:vi.fn(()=> "idle"),
  messageFor:vi.fn(()=> ""),
}));

vi.mock("@/features/calendars/calendar-provider",()=>({
  useCalendarSync:()=>state,
}));

import {CalendarDestinations} from "@/features/sources/calendar-destinations";

function connection(provider:CalendarConnection["provider"],id:string):CalendarConnection{
  return {
    id,provider,label:provider,accountLabel:provider==="caldav"?"student@example.com":null,
    remoteCalendarId:"remote-"+id,remoteCalendarName:"Kairos",enabled:true,
    lastSyncStartedAt:null,lastSyncCompletedAt:"2026-10-06T00:00:00.000Z",
    lastSyncStatus:"success",lastErrorCode:null,
  };
}

beforeEach(()=>{
  state.connections.length=0;
  for(const fn of [state.testIcloud,state.connectIcloud,state.startGoogle,state.startMicrosoft,state.syncConnection,state.removeEvents,state.disconnect])fn.mockClear();
  state.testIcloud.mockResolvedValue(true);
  state.connectIcloud.mockResolvedValue(true);
  state.phaseFor.mockReturnValue("idle");
  state.messageFor.mockReturnValue("");
});

describe("Calendar destinations",()=>{
  it("separates destinations from assignment sources and explains provider permissions",()=>{
    render(<CalendarDestinations/>);
    expect(screen.getByRole("heading",{name:"Calendar destinations"})).toBeVisible();
    expect(screen.getByText(/Sources bring assignments into Kairos\. Calendar destinations publish Kairos deadlines/i)).toBeVisible();
    expect(screen.getByRole("heading",{name:"Google Calendar"})).toBeVisible();
    expect(screen.getByText(/calendar Kairos creates/i)).toBeVisible();
    expect(screen.getByRole("heading",{name:"Outlook \/ Microsoft 365"})).toBeVisible();
    expect(screen.getByText(/Calendars\.ReadWrite/)).toBeVisible();
    expect(screen.getByRole("heading",{name:"Apple iCloud Calendar"})).toBeVisible();
    expect(screen.getByText(/Use an Apple app-specific password/i)).toBeVisible();
  });

  it("uses a password field for iCloud and clears the secret after connect",async()=>{
    const user=userEvent.setup();
    render(<CalendarDestinations/>);
    const username=screen.getByLabelText("Apple Account email");
    const secret=screen.getByLabelText("Apple app-specific password") as HTMLInputElement;
    expect(secret.type).toBe("password");
    await user.type(username,"student@example.com");
    await user.type(secret,"fixture-app-password-never-echo");
    await user.click(screen.getByRole("button",{name:"Test iCloud"}));
    expect(state.testIcloud).toHaveBeenCalledWith("student@example.com","fixture-app-password-never-echo");
    await user.click(screen.getByRole("button",{name:"Connect iCloud"}));
    expect(state.connectIcloud).toHaveBeenCalledWith("student@example.com","fixture-app-password-never-echo");
    expect(secret.value).toBe("");
    expect(document.body.textContent).not.toContain("fixture-app-password-never-echo");
  });

  it("shows connected health and keeps removal separate from disconnect",async()=>{
    state.connections.push(connection("google","google-1"));
    const user=userEvent.setup();
    render(<CalendarDestinations/>);
    expect(screen.getByText("Kairos")).toBeVisible();
    expect(screen.getByText(/Last successful/i)).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Sync Google Calendar"}));
    expect(state.syncConnection).toHaveBeenCalledWith("google-1");
    await user.click(screen.getByRole("button",{name:"Remove generated Google Calendar events"}));
    expect(state.removeEvents).toHaveBeenCalledWith("google-1");
    await user.click(screen.getByRole("button",{name:"Disconnect Google Calendar"}));
    expect(state.disconnect).toHaveBeenCalledWith("google-1");
  });
});
