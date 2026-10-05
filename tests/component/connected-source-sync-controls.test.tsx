// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const { gradescopeSync, edSync, submissionSync, refresh, state } = vi.hoisted(()=>({
  gradescopeSync: vi.fn(async()=>{}),
  edSync: vi.fn(async()=>{}),
  submissionSync: vi.fn(async()=>{}),
  refresh: vi.fn(),
  state:{gradescopeConnected:true,edConnected:true},
}));

vi.mock("@/features/gradescope/gradescope-provider",()=>({
  useGradescope:()=>({
    connection:state.gradescopeConnected?{id:"gs",enabled:true}:null,
    courses:state.gradescopeConnected?[{externalCourseId:"1",enabled:true}]:[],
    phase:"idle",
    message:"",
    syncNow:gradescopeSync,
  }),
}));
vi.mock("@/features/ed/ed-provider",()=>({
  useEd:()=>({
    connection:state.edConnected?{id:"ed",enabled:true}:null,
    courses:state.edConnected?[{externalCourseId:"2",enabled:true}]:[],
    phase:"idle",
    message:"",
    syncNow:edSync,
  }),
}));
vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({
    phase:"idle",
    message:"",
    syncNow:submissionSync,
  }),
}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));

import { ConnectedSourceSyncControls } from "@/features/sync/connected-source-sync-controls";

beforeEach(()=>{
  gradescopeSync.mockClear();
  edSync.mockClear();
  submissionSync.mockClear();
  refresh.mockClear();
  state.gradescopeConnected=true;
  state.edConnected=true;
  vi.unstubAllGlobals();
});

it("shows one purple Sync All button and syncs every connected source",async()=>{
  const user=userEvent.setup();
  const fetchMock=vi.fn(async()=>new Response(JSON.stringify({
    connectionId:"canvas",
    inserted:1,
    updated:0,
    skipped:0,
    errors:[],
    partial:false,
    completedAt:"2026-10-05T20:00:00Z",
  }),{status:200,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetchMock);

  render(<ConnectedSourceSyncControls canvasConnected/>);

  expect(screen.getAllByRole("button")).toHaveLength(1);
  const button=screen.getByRole("button",{name:"Sync All"});
  expect(button.className).toContain("bg-[var(--accent)]");

  await user.click(button);

  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/api/sources/canvas/sync",{method:"POST"}));
  expect(submissionSync).toHaveBeenCalledTimes(1);
  expect(gradescopeSync).toHaveBeenCalledTimes(1);
  expect(edSync).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalled();
});

it("syncs only sources that are connected and eligible",async()=>{
  state.gradescopeConnected=false;
  state.edConnected=false;
  const user=userEvent.setup();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}",{status:200,headers:{"content-type":"application/json"}})));

  render(<ConnectedSourceSyncControls canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));

  expect(submissionSync).toHaveBeenCalledTimes(1);
  expect(gradescopeSync).not.toHaveBeenCalled();
  expect(edSync).not.toHaveBeenCalled();
});

it("renders nothing when no source is connected",()=>{
  state.gradescopeConnected=false;
  state.edConnected=false;
  render(<ConnectedSourceSyncControls canvasConnected={false}/>);
  expect(screen.queryByRole("button",{name:"Sync All"})).not.toBeInTheDocument();
});
