// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {CalendarConnection} from "@/lib/calendar/types";
import {CalendarSyncProvider,useCalendarSync} from "@/features/calendars/calendar-provider";
import {GoogleCalendarCard} from '@/features/sources/google-calendar-card';
import {MicrosoftCalendarCard} from '@/features/sources/microsoft-calendar-card';
import {IcloudCalendarCard} from '@/features/sources/icloud-calendar-card';

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
const microsoft:CalendarConnection={
  id:"microsoft-1",provider:"microsoft",label:"Outlook / Microsoft 365",accountLabel:null,
  remoteCalendarId:"remote-microsoft",remoteCalendarName:"Kairos",enabled:true,
  lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
};

it.each([
  ['google',false,'Connect Google Calendar','/api/calendars/google/start'],
  ['google',true,'Reconnect Google Calendar','/api/calendars/google/start'],
  ['google',true,'Sync Google Calendar','/api/calendars/google-1/sync'],
  ['google',true,'Remove generated Google Calendar events','/api/calendars/google-1/remove-events'],
  ['google',true,'Disconnect Google Calendar','/api/calendars/google-1/disconnect'],
  ['microsoft',false,'Connect Microsoft Calendar','/api/calendars/microsoft/start'],
  ['microsoft',true,'Reconnect Microsoft Calendar','/api/calendars/microsoft/start'],
  ['microsoft',true,'Sync Microsoft Calendar','/api/calendars/microsoft-1/sync'],
  ['microsoft',true,'Remove generated Microsoft Calendar events','/api/calendars/microsoft-1/remove-events'],
  ['microsoft',true,'Disconnect Microsoft Calendar','/api/calendars/microsoft-1/disconnect'],
  ['caldav',false,'Test iCloud','/api/calendars/caldav/test'],
  ['caldav',true,'Test iCloud','/api/calendars/caldav/test'],
  ['caldav',false,'Connect iCloud','/api/calendars/caldav/connect'],
  ['caldav',true,'Update iCloud','/api/calendars/caldav/connect'],
  ['caldav',true,'Sync Apple iCloud Calendar','/api/calendars/apple-1/sync'],
  ['caldav',true,'Remove generated Apple iCloud Calendar events','/api/calendars/apple-1/remove-events'],
  ['caldav',true,'Disconnect Apple iCloud Calendar','/api/calendars/apple-1/disconnect'],
] as const)('card Retry preserves %s intent (%s): %s',async(provider,accepted,buttonName,endpoint)=>{
  const user=userEvent.setup();
  const connection=accepted?{...(provider==='google'?google:provider==='microsoft'?microsoft:apple),lastSyncCompletedAt:new Date().toISOString(),lastSyncStatus:'success' as const}:null;
  const requests:Array<{url:string;init?:RequestInit}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    requests.push({url:String(input),init});return Response.json({code:'SERVICE_UNAVAILABLE',message:'synthetic-private-marker'},{status:503});
  }));
  const Card=provider==='google'?GoogleCalendarCard:provider==='microsoft'?MicrosoftCalendarCard:IcloudCalendarCard;
  render(<CalendarSyncProvider initialConnections={connection?[connection]:[]}><Card connection={connection}/><Harness/></CalendarSyncProvider>);
  if(provider==='caldav'){
    await user.clear(screen.getByLabelText('Apple Account email'));
    await user.type(screen.getByLabelText('Apple Account email'),'new@example.test');
    await user.type(screen.getByLabelText('Apple app-specific password'),'fresh-memory');
  }
  await user.click(screen.getByRole('button',{name:buttonName}));
  expect(requests).toHaveLength(1);expect(requests[0]?.url).toBe(endpoint);
  await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(requests.map(request=>request.url)).toEqual([endpoint,endpoint]);
  expect(requests[1]?.init).toEqual(requests[0]?.init);
  expect(screen.getByTestId('count')).toHaveTextContent(accepted?'1':'0');
  if(provider==='caldav')expect(screen.getByLabelText('Apple app-specific password')).toHaveValue('fresh-memory');
  expect(document.documentElement.outerHTML).not.toMatch(/fresh-memory|synthetic-private-marker/);
});

it('does not inherit an old destructive intent when later synchronization fails',async()=>{
  const user=userEvent.setup();const connection={...google,lastSyncCompletedAt:new Date().toISOString()};
  const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);requests.push(url);return url.endsWith('/remove-events')?Response.json({ok:true}):Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});
  }));
  render(<CalendarSyncProvider initialConnections={[connection]}><GoogleCalendarCard connection={connection}/></CalendarSyncProvider>);
  await user.click(screen.getByRole('button',{name:'Remove generated Google Calendar events'}));
  await user.click(screen.getByRole('button',{name:'Sync Google Calendar'}));
  await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(requests).toEqual(['/api/calendars/google-1/remove-events','/api/calendars/google-1/sync','/api/calendars/google-1/sync']);
});

function Harness(){
  const calendar=useCalendarSync();
  return <div>
    <span data-testid="count">{calendar.connections.length}</span>
    <span data-testid="gmsg">{calendar.messageFor("google-1")}</span>
    <span data-testid="mmsg">{calendar.messageFor("microsoft-1")}</span>
    <button onClick={()=>void calendar.syncConnection("google-1")}>sync google</button>
    <button onClick={()=>void calendar.syncConnection("microsoft-1")}>sync microsoft</button>
    <button onClick={()=>void calendar.disconnect("apple-1")}>disconnect apple</button>
  </div>;
}

it("explains a completed Microsoft sign-in followed by rejected Outlook calendar access",async()=>{
  window.history.replaceState(null,"","/sources?calendarProvider=microsoft&calendarError=CALENDAR_AUTH_EXPIRED&calendarStage=calendar_setup");
  function ErrorHarness(){
    const calendar=useCalendarSync();
    return <span>{calendar.messageFor("microsoft")}</span>;
  }
  render(<CalendarSyncProvider initialConnections={[]}><ErrorHarness/></CalendarSyncProvider>);
  await screen.findByText(/Microsoft signed in successfully, but Outlook rejected calendar access/);
  expect(window.location.search).toBe("");
});

beforeEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates one provider state without erasing other connections",async()=>{
  const user=userEvent.setup();
  const fresh=new Date().toISOString();
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith("/google-1/sync"))return Response.json({status:"error",errorCode:"CALENDAR_UPSTREAM_ERROR"});
    if(url.endsWith("/apple-1/disconnect"))return Response.json({ok:true});
    throw new Error("unexpected request "+url);
  });
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[
    {...google,lastSyncCompletedAt:fresh,lastSyncStatus:"success"},
    {...apple,lastSyncCompletedAt:fresh,lastSyncStatus:"success"},
  ]}><Harness/></CalendarSyncProvider>);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"sync google"}));
  expect(screen.getByTestId("gmsg")).toHaveTextContent(/could not be synchronized/i);
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  await user.click(screen.getByRole("button",{name:"disconnect apple"}));
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});


it("reports reconciliation counts and names the secondary Outlook calendar",async()=>{
  const user=userEvent.setup();
  const fresh=new Date().toISOString();
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    expect(String(input)).toMatch(/\/microsoft-1\/sync$/);
    return Response.json({
      connectionId:"microsoft-1",
      status:"success",
      createdCount:7,
      updatedCount:2,
      deletedCount:1,
      unchangedCount:4,
      failedCount:0,
      completedAt:new Date().toISOString(),
      errorCode:null,
    });
  });
  vi.stubGlobal("fetch",fetchMock);

  render(<CalendarSyncProvider initialConnections={[{
    ...microsoft,
    lastSyncCompletedAt:fresh,
    lastSyncStatus:"success",
  }]}><Harness/></CalendarSyncProvider>);

  await user.click(screen.getByRole("button",{name:"sync microsoft"}));
  expect(screen.getByTestId("mmsg")).toHaveTextContent(/7 created/i);
  expect(screen.getByTestId("mmsg")).toHaveTextContent(/2 updated/i);
  expect(screen.getByTestId("mmsg")).toHaveTextContent(/4 unchanged/i);
  expect(screen.getByTestId("mmsg")).toHaveTextContent(/secondary Kairos calendar/i);
});

it("does not auto-sync when there are no calendar destinations",async()=>{
  const fetchMock=vi.fn();
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[]}><div>child</div></CalendarSyncProvider>);
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  ['ABUSE_STORAGE_UNAVAILABLE','retry'],['CALENDAR_AUTH_EXPIRED','reconnect'],
  ['CALENDAR_REMOTE_CALENDAR_MISSING','recreate'],['SYNC_RECOVERY_REQUIRED','retry'],
])('keeps %s recovery causal, scoped and safe',async(code,action)=>{
  const user=userEvent.setup();const fresh=new Date().toISOString();
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code,message:'synthetic-private-marker'},{status:503})));
  function RecoveryHarness(){const calendar=useCalendarSync();return <><button onClick={()=>void calendar.syncConnection('google-1')}>Recover sync</button><span data-testid="recovery">{calendar.recoveryFor?.('google-1')?.action}</span><span>{calendar.messageFor('google-1')}</span><span data-testid="retained">{calendar.connections.length}</span></>;}
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:fresh}]}><RecoveryHarness/></CalendarSyncProvider>);
  await user.click(screen.getByRole('button',{name:'Recover sync'}));
  expect(screen.getByTestId('recovery')).toHaveTextContent(action);expect(screen.getByTestId('retained')).toHaveTextContent('1');
  expect(screen.queryByText('synthetic-private-marker')).not.toBeInTheDocument();
});

it('blocks repeated provider attempts until Retry-After but permits local disconnect',async()=>{
  const user=userEvent.setup();const fetchMock=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/disconnect')?Response.json({ok:true}):Response.json({code:'RATE_LIMITED'},{status:429,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',fetchMock);
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString()},{...apple,lastSyncCompletedAt:new Date().toISOString()}]}><Harness/></CalendarSyncProvider>);
  await user.click(screen.getByRole('button',{name:'sync google'}));await user.click(screen.getByRole('button',{name:'sync google'}));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button',{name:'disconnect apple'}));expect(screen.getByTestId('count')).toHaveTextContent('1');
});

it("does not auto-sync a destination reconciled less than 15 minutes ago",async()=>{
  const now=Date.now();
  vi.spyOn(Date,"now").mockReturnValue(now);
  const fetchMock=vi.fn();
  vi.stubGlobal("fetch",fetchMock);
  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:new Date(now-5*60*1000).toISOString(),
    lastSyncStatus:"success",
  }]}><div>child</div></CalendarSyncProvider>);
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).not.toHaveBeenCalled();
});

it("auto-syncs a stale destination once and refreshes again only after another 15 minutes",async()=>{
  let now=Date.parse("2026-10-06T01:30:00.000Z");
  vi.spyOn(Date,"now").mockImplementation(()=>now);
  const fetchMock=vi.fn(async()=>Response.json({
    status:"success",
    results:[{
      connectionId:"google-1",
      status:"success",
      completedAt:new Date(now).toISOString(),
      errorCode:null,
    }],
  }));
  vi.stubGlobal("fetch",fetchMock);

  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:new Date(now-16*60*1000).toISOString(),
    lastSyncStatus:"success",
  }]}><div>child</div></CalendarSyncProvider>);

  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/calendars/sync-all",{method:"POST"});

  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).toHaveBeenCalledTimes(1);

  now+=16*60*1000;
  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
});

it("does not start overlapping auto-syncs on repeated visibility events",async()=>{
  const now=Date.now();
  vi.spyOn(Date,"now").mockReturnValue(now);
  let release!:(response:Response)=>void;
  const gate=new Promise<Response>(resolve=>{release=resolve;});
  const fetchMock=vi.fn(()=>gate);
  vi.stubGlobal("fetch",fetchMock);

  render(<CalendarSyncProvider initialConnections={[{
    ...google,
    lastSyncCompletedAt:null,
    lastSyncStatus:"never",
  }]}><div>child</div></CalendarSyncProvider>);

  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  act(()=>{
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async()=>{
    release(Response.json({status:"success",results:[]}));
    await gate;
  });
});
