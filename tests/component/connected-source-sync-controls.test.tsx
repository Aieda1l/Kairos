// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const { gradescopeSync, edSync, state } = vi.hoisted(()=>({
  gradescopeSync: vi.fn(async()=>{}),
  edSync: vi.fn(async()=>{}),
  state:{gradescopeConnected:true,edConnected:true},
}));

vi.mock("@/features/gradescope/gradescope-provider",()=>({
  useGradescope:()=>({
    connection:state.gradescopeConnected?{id:"gs",enabled:true}:null,
    courses:state.gradescopeConnected?[{externalCourseId:"1",enabled:true}]:[],
    phase:"idle",
    lastSuccessfulAt:"2026-10-05T18:00:00Z",
    message:"",
    syncNow:gradescopeSync,
  }),
}));
vi.mock("@/features/ed/ed-provider",()=>({
  useEd:()=>({
    connection:state.edConnected?{id:"ed",enabled:true}:null,
    courses:state.edConnected?[{externalCourseId:"2",enabled:true}]:[],
    phase:"idle",
    lastSuccessfulAt:"2026-10-05T19:00:00Z",
    message:"",
    syncNow:edSync,
  }),
}));
vi.mock("@/features/submission-status/submission-status-control",()=>({
  SubmissionStatusControl:()=> <div>Canvas submissions control</div>,
}));
vi.mock("@/features/sync/sync-button",()=>({
  SyncButton:()=> <button type="button">Sync Canvas deadlines</button>,
}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));

import { ConnectedSourceSyncControls } from "@/features/sync/connected-source-sync-controls";

beforeEach(()=>{
  gradescopeSync.mockClear();
  edSync.mockClear();
  state.gradescopeConnected=true;
  state.edConnected=true;
});

it("shows sync controls for every connected source",async()=>{
  const user=userEvent.setup();
  render(<ConnectedSourceSyncControls canvasConnected canvasLastSyncCompletedAt="2026-10-05T17:00:00Z"/>);

  expect(screen.getByText(/Canvas deadlines/)).toBeInTheDocument();
  expect(screen.getByText("Canvas submissions control")).toBeInTheDocument();
  expect(screen.getByText(/Gradescope/)).toBeInTheDocument();
  expect(screen.getByText(/^Ed/)).toBeInTheDocument();

  await user.click(screen.getByRole("button",{name:"Sync Gradescope"}));
  await user.click(screen.getByRole("button",{name:"Sync Ed"}));
  expect(gradescopeSync).toHaveBeenCalledTimes(1);
  expect(edSync).toHaveBeenCalledTimes(1);
});

it("hides source controls that are not connected",()=>{
  state.gradescopeConnected=false;
  state.edConnected=false;
  render(<ConnectedSourceSyncControls canvasConnected={false} canvasLastSyncCompletedAt={null}/>);
  expect(screen.queryByText(/Canvas deadlines/)).not.toBeInTheDocument();
  expect(screen.queryByText("Canvas submissions control")).not.toBeInTheDocument();
  expect(screen.queryByText(/Gradescope/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Sync Ed"})).not.toBeInTheDocument();
});
