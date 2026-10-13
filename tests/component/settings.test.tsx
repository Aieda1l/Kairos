// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import type {SourceConnection} from '@/lib/assignments/types';
import type {SourceCourse} from '@/lib/sources/types';
import type {RecoveryNotice} from '@/lib/recovery/presentation';
import {SettingsContent as SettingsPage} from "@/features/settings/settings-content";

const {syncNow,routerPush,signOut,preferences}=vi.hoisted(()=>({syncNow:vi.fn(),routerPush:vi.fn(),signOut:vi.fn(),preferences:{automaticEnabled:true}}));
const gradescopeState=vi.hoisted(()=>({connection:null as SourceConnection|null,courses:[] as SourceCourse[],extensionDetected:false,recovery:null as RecoveryNotice|null,recoveryOperation:null as string|null}));
vi.mock('next-auth/react',()=>({signOut}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>({connections:[],recoveryFor:()=>null})}));
vi.mock('@/features/ed/ed-provider',()=>({useEd:()=>({connection:null})}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({useGradescope:()=>gradescopeState}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:routerPush,refresh:vi.fn()})}));
vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({
    enabled:true,
    automaticEnabled:preferences.automaticEnabled,
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"not-shared",
    canvasTabDetected:true,
    message:"",
    lastAttemptedAt:"2026-10-04T06:00:00.000Z",
    lastSuccessfulAt:"2026-10-04T06:00:01.000Z",
    lastErrorCode:null,
    updatedCount:4,
    failedCount:0,
    syncNow,
  }),
}));
beforeEach(()=>{preferences.automaticEnabled=true;gradescopeState.connection=null;gradescopeState.courses=[];gradescopeState.recovery=null;gradescopeState.recoveryOperation=null;});

it.each(['load','timezone','preference'] as const)('enforces non-JSON 429 Retry-After for settings %s',async(operation)=>{
  preferences.automaticEnabled=false;const user=userEvent.setup();const requests:Array<{url:string;method:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),method=init?.method??'GET';requests.push({url,method});
    return operation==='load'||method==='PUT'?new Response('{malformed',{status:429,headers:{'Retry-After':'120'}}):Response.json({timeZone:'Asia/Kathmandu'});
  }));
  render(<SettingsPage/>);
  if(operation!=='load'){
    await waitFor(()=>expect(screen.getByLabelText('Display timezone')).toHaveValue('Asia/Kathmandu'));
    await user.click(operation==='timezone'?screen.getByRole('button',{name:'Save timezone'}):screen.getByLabelText('Enable browser submission refresh'));
  }
  await screen.findByText(/120 seconds/);expect(screen.getByRole('button',{name:'Retry'})).toBeDisabled();
  const count=requests.length;
  await user.click(operation==='load'?screen.getByRole('button',{name:'Retry'}):operation==='timezone'?screen.getByRole('button',{name:'Save timezone'}):screen.getByLabelText('Enable browser submission refresh'));
  expect(requests).toHaveLength(count);expect(screen.getByRole('button',{name:'Sign out'})).toBeEnabled();
});

it.each(['load','timezone','preference'] as const)('maps non-JSON settings %s 401 to sign-in',async(operation)=>{
  const user=userEvent.setup();vi.stubGlobal('fetch',vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>operation==='load'||init?.method==='PUT'?new Response('<html>synthetic-private-marker</html>',{status:401}):Response.json({timeZone:'Asia/Kathmandu'})));
  render(<SettingsPage/>);
  if(operation!=='load'){
    await waitFor(()=>expect(screen.getByLabelText('Display timezone')).toHaveValue('Asia/Kathmandu'));
    await user.click(operation==='timezone'?screen.getByRole('button',{name:'Save timezone'}):screen.getByLabelText('Enable browser submission refresh'));
  }
  expect(await screen.findByRole('link',{name:'Sign in and retry'})).toHaveAttribute('href','/sign-in');expect(screen.queryByText(/synthetic-private-marker/)).not.toBeInTheDocument();
});

it.each([false,true])('suppresses persisted extension guidance for ineligible settings Gradescope (%s), retains fresh feedback',async(enabled)=>{
  gradescopeState.connection={id:'grade',kind:'gradescope',label:'Gradescope',enabled,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'error',lastErrorCode:'EXTENSION_UNAVAILABLE'};
  gradescopeState.courses=[{id:'course',sourceConnectionId:'grade',externalCourseId:'123',shortName:null,fullName:'Course',term:null,year:null,enabled:!enabled,firstSeenAt:'',lastSeenAt:''}];
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({timeZone:'Asia/Kathmandu'})));
  const view=render(<SettingsPage/>);await waitFor(()=>expect(screen.getByLabelText('Display timezone')).toHaveValue('Asia/Kathmandu'));
  expect(screen.queryByRole('link',{name:'Verify extension'})).not.toBeInTheDocument();
  gradescopeState.recovery={key:'gradescope',message:'Verify the extension for this explicit discovery attempt.',action:'verify-extension',href:'/settings'};gradescopeState.recoveryOperation='discovery';view.rerender(<SettingsPage/>);
  expect(screen.getByRole('link',{name:'Verify extension'})).toHaveAttribute('href','/settings');
});

it("offers timezone persistence and Canvas submission-status diagnostics",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({timeZone:"America/Los_Angeles"}))));
  render(<SettingsPage/>);
  expect(screen.getByLabelText("Display timezone")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Save timezone"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"Submission status"})).toBeInTheDocument();
  expect(screen.getByText("Automatic refresh")).toBeInTheDocument();
  expect(screen.getByText("On")).toBeInTheDocument();
  expect(screen.getByText("Refresh when older than")).toBeInTheDocument();
  expect(screen.getByText("15 minutes")).toBeInTheDocument();
  expect(screen.getByText("Last successful refresh")).toBeInTheDocument();
  expect(screen.getByText("Firefox extension")).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();
});

it('shows only the supplied identity summary, separate calendar consent and existing sign out',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({timeZone:'Asia/Kathmandu'})));
  const user=userEvent.setup();
  render(<SettingsPage account={{name:'Synthetic User',email:'student@example.test',identityProvider:'microsoft'}}/>);
  expect(screen.getByRole('heading',{name:'Account'})).toBeInTheDocument();
  expect(screen.getByText('Synthetic User')).toBeInTheDocument();expect(screen.getByText('student@example.test')).toBeInTheDocument();
  expect(screen.getByText('Microsoft')).toBeInTheDocument();
  expect(screen.getByText(/calendar permissions.*separately/i)).toBeInTheDocument();
  expect(screen.queryByText('not-shared')).not.toBeInTheDocument();
  expect(screen.queryByText(/installed version/i)).not.toBeInTheDocument();
  expect(screen.getByText(/public.*listing.*pending/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Sign out'}));
  expect(signOut).toHaveBeenCalledWith({redirectTo:'/sign-in'});
});

it('retains the old submission preference and makes browser refresh opt-in through the actual API',async()=>{
  preferences.automaticEnabled=false;
  const user=userEvent.setup();const fetchMock=vi.fn(async()=>Response.json({timeZone:'Asia/Kathmandu',enabled:false}));vi.stubGlobal('fetch',fetchMock);
  render(<SettingsPage/>);
  expect(screen.getByText('Off')).toBeInTheDocument();
  const toggle=screen.getByLabelText('Enable browser submission refresh');expect(toggle).not.toBeChecked();
  await user.click(toggle);
  expect(fetchMock).toHaveBeenCalledWith('/api/settings/submission-status',expect.objectContaining({method:'PUT',body:JSON.stringify({enabled:true})}));
  preferences.automaticEnabled=true;
});

it('keeps timezone and deletion controls usable when settings storage fails without raw error disclosure',async()=>{
  const user=userEvent.setup();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code:'ABUSE_STORAGE_UNAVAILABLE',message:'synthetic-private-marker'},{status:503})));
  render(<SettingsPage/>);
  await screen.findByText(/temporarily unavailable/i);
  expect(screen.getByRole('button',{name:'Save timezone'})).toBeEnabled();
  await user.type(screen.getByLabelText(/type DELETE/i),'DELETE');expect(screen.getByRole('button',{name:'Delete my account'})).toBeEnabled();
  expect(screen.queryByText('synthetic-private-marker')).not.toBeInTheDocument();
});
it('retries a failed timezone read without overwriting the saved timezone',async()=>{
  const user=userEvent.setup();const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({code:'ABUSE_STORAGE_UNAVAILABLE'},{status:503})).mockResolvedValueOnce(Response.json({timeZone:'Asia/Kathmandu'}));vi.stubGlobal('fetch',fetchMock);
  render(<SettingsPage/>);await screen.findByText(/temporarily unavailable/i);
  await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
  expect(screen.getByLabelText('Display timezone')).toHaveValue('Asia/Kathmandu');
});
it('keeps a preference failure actionable when a concurrent timezone read finishes',async()=>{
  const user=userEvent.setup();let release!:(response:Response)=>void;
  const read=new Promise<Response>(resolve=>{release=resolve;});
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>String(input)==='/api/settings/timezone'?read:Response.json({code:'ABUSE_STORAGE_UNAVAILABLE'},{status:503}));vi.stubGlobal('fetch',fetchMock);
  render(<SettingsPage/>);await user.click(screen.getByLabelText('Enable browser submission refresh'));
  await screen.findByText(/temporarily unavailable/i);
  await act(async()=>{release(Response.json({timeZone:'Asia/Kathmandu'}));await read;});
  expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(fetchMock.mock.calls.filter(([path])=>String(path)==='/api/settings/submission-status')).toHaveLength(2);
  expect(fetchMock.mock.calls.filter(([path])=>String(path)==='/api/settings/timezone')).toHaveLength(1);
});

it("requires explicit confirmation before deleting the hosted account",async()=>{
  const user=userEvent.setup();
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(init?.method==="DELETE")return new Response(null,{status:204});
    return new Response(JSON.stringify({timeZone:"America/Los_Angeles"}));
  });
  vi.stubGlobal("fetch",fetchMock);
  render(<SettingsPage/>);

  expect(screen.getByRole("heading",{name:"Delete account"})).toBeInTheDocument();
  expect(screen.getByText(/Remove generated events/i)).toBeInTheDocument();
  const button=screen.getByRole("button",{name:"Delete my account"});
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText(/type DELETE/i),"DELETE");
  expect(button).toBeEnabled();
  await user.click(button);
  expect(fetchMock).toHaveBeenCalledWith("/api/account",expect.objectContaining({
    method:"DELETE",
    body:JSON.stringify({confirmation:"DELETE"}),
  }));
  expect(routerPush).toHaveBeenCalledWith("/");
});
