// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasSourceCard } from "@/features/sources/canvas-source-card";

const {navigateDocument}=vi.hoisted(()=>({navigateDocument:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/browser-navigation",()=>({navigateDocument}));

beforeEach(()=>{navigateDocument.mockClear();});

it('retains the accepted Canvas connection and fresh input while showing safe service recovery',async()=>{
  const user=userEvent.setup();const feed='https://canvas.example.test/feeds/calendars/new-private.ics';
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code:'ABUSE_STORAGE_UNAVAILABLE',message:'synthetic-private-marker'},{status:503})));
  render(<CanvasSourceCard connection={{id:'accepted',kind:'canvas',label:'Canvas',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null}}/>);
  await user.type(screen.getByLabelText('Canvas calendar feed URL'),feed);await user.click(screen.getByRole('button',{name:'Connect Canvas'}));
  expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry'})).toBeEnabled();
  expect(screen.getByLabelText('Canvas calendar feed URL')).toHaveValue(feed);expect(screen.getByRole('button',{name:'Sync Now'})).toBeEnabled();
  expect(screen.queryByText('synthetic-private-marker')).not.toBeInTheDocument();expect(navigateDocument).not.toHaveBeenCalled();
});

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

it.each(['test','connect','sync'] as const)('keeps non-JSON 429 Retry-After on Canvas %s',async(operation)=>{
  const user=userEvent.setup();const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{requests.push(String(input));return new Response('<html>synthetic-private-marker</html>',{status:429,headers:{'Retry-After':'120'}});}));
  render(<CanvasSourceCard connection={{id:'accepted',kind:'canvas',label:'Canvas',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null}}/>);
  const input=screen.getByLabelText('Canvas calendar feed URL');await user.type(input,'https://canvas.uw.edu/feeds/calendars/fresh.ics');
  const action=screen.getByRole('button',{name:operation==='test'?'Test connection':operation==='connect'?'Connect Canvas':'Sync Now'});
  await user.click(action);
  expect(screen.getByRole('button',{name:'Retry'})).toBeDisabled();expect(screen.getByText(/120 seconds/)).toBeInTheDocument();
  await user.click(action);expect(requests).toEqual(['/api/sources/canvas/'+operation]);
  expect(input).toHaveValue('https://canvas.uw.edu/feeds/calendars/fresh.ics');expect(screen.queryByText(/synthetic-private-marker/)).not.toBeInTheDocument();
});

it.each(['test','connect','sync'] as const)('maps a non-JSON Canvas %s 401 to sign-in',async(operation)=>{
  const user=userEvent.setup();vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:401})));
  render(<CanvasSourceCard connection={{id:'accepted',kind:'canvas',label:'Canvas',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null}}/>);
  await user.type(screen.getByLabelText('Canvas calendar feed URL'),'https://canvas.uw.edu/feeds/calendars/fresh.ics');
  await user.click(screen.getByRole('button',{name:operation==='test'?'Test connection':operation==='connect'?'Connect Canvas':'Sync Now'}));
  expect(screen.getByRole('link',{name:'Sign in and retry'})).toHaveAttribute('href','/sign-in');
});

it('does not accept a malformed successful Canvas replacement response or clear fresh input',async()=>{
  const user=userEvent.setup();vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>private-marker</html>',{status:200})));
  render(<CanvasSourceCard connection={{id:'accepted',kind:'canvas',label:'Canvas',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null}}/>);
  const input=screen.getByLabelText('Canvas calendar feed URL');await user.type(input,'https://canvas.uw.edu/feeds/calendars/fresh.ics');
  await user.click(screen.getByRole('button',{name:'Connect Canvas'}));
  expect(input).toHaveValue('https://canvas.uw.edu/feeds/calendars/fresh.ics');expect(screen.getByRole('button',{name:'Sync Now'})).toBeEnabled();
  expect(navigateDocument).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Retry'})).toBeEnabled();
});
