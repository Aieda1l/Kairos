// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasSourceCard } from "@/features/sources/canvas-source-card";

const push=vi.fn();
vi.mock("next/navigation",()=>({useRouter:()=>({push,refresh:vi.fn()})}));

beforeEach(()=>{push.mockClear();});

it("tests then connects without keeping the feed URL in the rendered UI",async()=>{
  const user=userEvent.setup();
  const feedUrl="https://canvas.example.edu/feeds/calendars/private.ics";
  const fetchMock=vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ok:true,itemCount:3}),{status:200}))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      connection:{id:"1",kind:"canvas",label:"Canvas",enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:"2026-10-03T20:00:00Z",lastSyncStatus:"success",lastErrorCode:null},
      sync:{connectionId:"1",inserted:3,updated:0,skipped:0,errors:[],partial:false,completedAt:"2026-10-03T20:00:00Z"},
    }),{status:200}));
  vi.stubGlobal("fetch",fetchMock);

  render(<CanvasSourceCard connection={null}/>);
  const input=screen.getByLabelText("Canvas calendar feed URL");
  await user.type(input,feedUrl);
  await user.click(screen.getByRole("button",{name:"Test connection"}));
  expect(await screen.findByText(/3 assignments/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Connect Canvas"}));
  expect(push).toHaveBeenCalledWith("/upcoming");
  expect(input).toHaveValue("");
});

it("shows future connectors elsewhere, not fake Canvas actions",()=>{
  render(<CanvasSourceCard connection={null}/>);
  expect(screen.getByRole("button",{name:"Connect Canvas"})).toBeInTheDocument();
});
