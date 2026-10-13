// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasSourceCard } from "@/features/sources/canvas-source-card";

const {navigateDocument}=vi.hoisted(()=>({navigateDocument:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/browser-navigation",()=>({navigateDocument}));

beforeEach(()=>{navigateDocument.mockClear();});

it('awaits the onboarding connection callback and keeps Sources default navigation separate',async()=>{
  const connection={id:'accepted',kind:'canvas',label:'Canvas',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({connection})));
  const onConnected=vi.fn(async()=>{});render(<CanvasSourceCard connection={null} onConnected={onConnected}/>);
  await userEvent.setup().type(screen.getByLabelText('Canvas calendar feed URL'),'https://canvas.uw.edu/feeds/calendars/synthetic.ics');
  await userEvent.setup().click(screen.getByRole('button',{name:'Connect Canvas'}));
  expect(onConnected).toHaveBeenCalledWith(connection);expect(navigateDocument).not.toHaveBeenCalled();
});

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
  expect(navigateDocument).toHaveBeenCalledWith("/upcoming");
  expect(input).toHaveValue("");
});

it("shows future connectors elsewhere, not fake Canvas actions",()=>{
  render(<CanvasSourceCard connection={null}/>);
  expect(screen.getByRole("button",{name:"Connect Canvas"})).toBeInTheDocument();
});
