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
import {SYNC_ALL_STEPS,type SyncAllStep} from '@/lib/sync-all/types';
const runId='11111111-1111-4111-8111-111111111111';
const admitted=(steps:readonly SyncAllStep[]=SYNC_ALL_STEPS)=>Response.json({runId,expiresAt:'2099-01-01T00:00:00Z',steps});
const admittedOptions={deferCalendarSync:true,syncAllRunId:runId};

it("denied root admission performs no source request or extension dispatch",async()=>{
  const user=userEvent.setup();
  const requests=vi.fn<typeof fetch>(async()=>Response.json({code:"RATE_LIMITED",retryAfterSeconds:120},{status:429,headers:{"Retry-After":"120"}}));
  vi.stubGlobal("fetch",requests);
  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));
  await waitFor(()=>expect(requests).toHaveBeenCalled());
  expect(requests).toHaveBeenCalledTimes(1);
  expect(requests.mock.calls[0]?.[0]).toBe("/api/sync-all/start");
  expect(submissionSync).not.toHaveBeenCalled();
  expect(gradescopeSync).not.toHaveBeenCalled();
  expect(edSync).not.toHaveBeenCalled();
  expect(calendarSync).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Sync All"})).toBeDisabled();
});

it('rejects an expired admission before child dispatch',async()=>{
  const requests=vi.fn(async()=>Response.json({runId,expiresAt:'2000-01-01T00:00:00Z',steps:SYNC_ALL_STEPS}));
  vi.stubGlobal('fetch',requests);
  render(<ConnectedSourceSyncControls canvasConnected/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync All'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sync All'})).toBeEnabled());
  expect(requests).toHaveBeenCalledTimes(1);
  for(const child of [submissionSync,gradescopeSync,edSync,calendarSync])expect(child).not.toHaveBeenCalled();
});

it.each(['submission','gradescope'] as const)('a rejected %s promise does not skip later admitted sources, calendars or refresh',async failed=>{
  (failed==='submission'?submissionSync:gradescopeSync).mockRejectedValueOnce(new Error('synthetic-private-rejection'));
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>input==='/api/sync-all/start'?admitted():Response.json({ok:true})));
  render(<ConnectedSourceSyncControls canvasConnected/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync All'}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
  expect(edSync).toHaveBeenCalledWith(admittedOptions);
  expect(calendarSync).toHaveBeenCalledWith(runId);
  if(failed==='submission')expect(gradescopeSync).toHaveBeenCalledWith(admittedOptions);
  expect(screen.queryByText(/synthetic-private-rejection/i)).not.toBeInTheDocument();
  expect(screen.getByText(failed==='submission'?/Canvas submissions:.*unavailable/i:/Gradescope:.*unavailable/i)).toBeVisible();
});

beforeEach(()=>{
  order.length=0;
  for(const fn of [gradescopeSync,edSync,submissionSync,calendarSync,refresh])fn.mockReset();
  gradescopeSync.mockImplementation(async()=>{order.push("gradescope");});
  edSync.mockImplementation(async()=>{order.push("ed");return {status:'completed',message:'Ed sync complete.',recovery:null};});
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
    if(_input==='/api/sync-all/start'){order.push('admission');return admitted();}
    order.push("canvas");
    expect(init).toMatchObject({
      method:"POST",
      headers:{"x-kairos-calendar-sync":"defer","x-kairos-sync-all-run":runId},
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
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(submissionSync).toHaveBeenCalledWith(admittedOptions);
  expect(gradescopeSync).toHaveBeenCalledWith(admittedOptions);
  expect(edSync).toHaveBeenCalledWith(admittedOptions);
  expect(calendarSync).toHaveBeenCalledWith(runId);
  expect(order).toEqual(['admission',"canvas","submission","gradescope","ed","calendar","refresh"]);
});

it("runs the final calendar pass even when a source deadline request fails",async()=>{
  const user=userEvent.setup();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    if(input==='/api/sync-all/start')return admitted();
    order.push("canvas");
    return Response.json({message:"Canvas unavailable"},{status:502});
  }));

  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));

  await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
  expect(submissionSync).toHaveBeenCalledWith(admittedOptions);
  expect(gradescopeSync).toHaveBeenCalledWith(admittedOptions);
  expect(edSync).toHaveBeenCalledWith(admittedOptions);
  expect(screen.getByText(/Canvas deadlines:/i)).toBeVisible();
  expect(screen.queryByText(/Canvas unavailable/i)).not.toBeInTheDocument();
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

it("dispatches only server-admitted sources before calendars",async()=>{
  const user=userEvent.setup();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    if(input==='/api/sync-all/start')return admitted(['canvas-deadlines','canvas-submissions','calendars']);
    order.push("canvas");
    return Response.json({});
  }));

  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));

  await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
  expect(submissionSync).toHaveBeenCalledWith(admittedOptions);
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

it.each(['blocked','failed','partial','skipped','legacy-void'] as const)('does not reuse an earlier Ed success for a current %s attempt',async status=>{
  state.edPhase='success';state.edMessage='Ed sync complete.';
  if(status==='legacy-void')edSync.mockResolvedValueOnce(undefined);
  else edSync.mockResolvedValueOnce({status,message:'Prior provider work has an uncertain outcome.',recovery:null});
  vi.stubGlobal('fetch',async()=>admitted(status==='skipped'?['calendars']:['ed','calendars']));
  render(<ConnectedSourceSyncControls canvasConnected/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync All'}));
  await waitFor(()=>expect(calendarSync).toHaveBeenCalledOnce());
  expect(screen.queryByText('Ed sync complete.')).not.toBeInTheDocument();
  if(status!=='skipped')expect(screen.getByText(/Ed:/)).toBeVisible();
});
