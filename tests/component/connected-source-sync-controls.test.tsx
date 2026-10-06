// @vitest-environment jsdom
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";

const {
  gradescopeSync,edSync,submissionSync,calendarSync,refresh,state,order,
}=vi.hoisted(()=>({
  gradescopeSync:vi.fn(),
  edSync:vi.fn(),
  submissionSync:vi.fn(),
  calendarSync:vi.fn(),
  refresh:vi.fn(),
  order:[] as string[],
  state:{
    gradescopeConnected:true,
    edConnected:true,
    submissionPhase:"idle",
    submissionMessage:"",
    gradescopePhase:"idle",
    gradescopeMessage:"",
    edPhase:"idle",
    edMessage:"",
    calendarPhase:"idle",
    calendarMessage:"",
  },
}));

vi.mock("@/features/gradescope/gradescope-provider",()=>({
  useGradescope:()=>({
    connection:state.gradescopeConnected?{id:"gs",enabled:true}:null,
    courses:state.gradescopeConnected?[{externalCourseId:"1",enabled:true}]:[],
    phase:state.gradescopePhase,
    message:state.gradescopeMessage,
    syncNow:gradescopeSync,
  }),
}));
vi.mock("@/features/ed/ed-provider",()=>({
  useEd:()=>({
    connection:state.edConnected?{id:"ed",enabled:true}:null,
    courses:state.edConnected?[{externalCourseId:"2",enabled:true}]:[],
    phase:state.edPhase,
    message:state.edMessage,
    syncNow:edSync,
  }),
}));
vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({
    phase:state.submissionPhase,
    message:state.submissionMessage,
    syncNow:submissionSync,
  }),
}));
vi.mock("@/features/calendars/calendar-provider",()=>({
  useCalendarSync:()=>({
    connections:[{id:"calendar-1",label:"Google Calendar",provider:"google"}],
    syncAll:calendarSync,
    phaseFor:()=>state.calendarPhase,
    messageFor:()=>state.calendarMessage,
  }),
}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));

import {ConnectedSourceSyncControls} from "@/features/sync/connected-source-sync-controls";

beforeEach(()=>{
  order.length=0;
  for(const fn of [gradescopeSync,edSync,submissionSync,calendarSync,refresh])fn.mockReset();
  gradescopeSync.mockImplementation(async()=>{order.push("gradescope");});
  edSync.mockImplementation(async()=>{order.push("ed");});
  submissionSync.mockImplementation(async()=>{order.push("submission");});
  calendarSync.mockImplementation(async()=>{order.push("calendar");});
  refresh.mockImplementation(()=>{order.push("refresh");});
  state.gradescopeConnected=true;
  state.edConnected=true;
  state.submissionPhase="idle";
  state.submissionMessage="";
  state.gradescopePhase="idle";
  state.gradescopeMessage="";
  state.edPhase="idle";
  state.edMessage="";
  state.calendarPhase="idle";
  state.calendarMessage="";
  vi.unstubAllGlobals();
});

it("shows one purple Sync All button and performs one deferred-source sequence followed by calendars",async()=>{
  const user=userEvent.setup();
  const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    order.push("canvas");
    expect(init).toMatchObject({
      method:"POST",
      headers:{"x-kairos-calendar-sync":"defer"},
    });
    return Response.json({
      connectionId:"canvas",
      inserted:1,
      updated:0,
      skipped:0,
      errors:[],
      partial:false,
      completedAt:"2026-10-05T20:00:00Z",
    });
  });
  vi.stubGlobal("fetch",fetchMock);

  render(<ConnectedSourceSyncControls canvasConnected/>);

  expect(screen.getAllByRole("button")).toHaveLength(1);
  const button=screen.getByRole("button",{name:"Sync All"});
  expect(button.className).toContain("bg-[var(--accent)]");

  await user.click(button);

  await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(submissionSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(gradescopeSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(edSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(order).toEqual(["canvas","submission","gradescope","ed","calendar","refresh"]);
});

it("runs the final calendar pass even when a source deadline request fails",async()=>{
  const user=userEvent.setup();
  vi.stubGlobal("fetch",vi.fn(async()=>{
    order.push("canvas");
    return Response.json({message:"Canvas unavailable"},{status:502});
  }));

  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));

  await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
  expect(submissionSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(gradescopeSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(edSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(screen.getByText(/Canvas deadlines: Canvas unavailable/i)).toBeVisible();
});

it("renders calendar warnings separately from source warnings",()=>{
  state.submissionPhase="partial";
  state.submissionMessage="Some Canvas statuses failed.";
  state.calendarPhase="error";
  state.calendarMessage="Google Calendar could not be synchronized.";

  render(<ConnectedSourceSyncControls canvasConnected/>);

  expect(screen.getByText(/Canvas submissions: Some Canvas statuses failed/i)).toBeVisible();
  expect(screen.getByText(/Calendar destinations: Google Calendar could not be synchronized/i)).toBeVisible();
});

it("syncs only sources that are connected and eligible before calendars",async()=>{
  state.gradescopeConnected=false;
  state.edConnected=false;
  const user=userEvent.setup();
  vi.stubGlobal("fetch",vi.fn(async()=>{
    order.push("canvas");
    return Response.json({});
  }));

  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));

  await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
  expect(submissionSync).toHaveBeenCalledWith({deferCalendarSync:true});
  expect(gradescopeSync).not.toHaveBeenCalled();
  expect(edSync).not.toHaveBeenCalled();
  expect(order).toEqual(["canvas","submission","calendar","refresh"]);
});

it("renders nothing when no source is connected",()=>{
  state.gradescopeConnected=false;
  state.edConnected=false;
  render(<ConnectedSourceSyncControls canvasConnected={false}/>);
  expect(screen.queryByRole("button",{name:"Sync All"})).not.toBeInTheDocument();
});
