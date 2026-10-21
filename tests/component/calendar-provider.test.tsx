// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useRef} from 'react';
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

function AdmittedHarness(){
  const calendar=useCalendarSync();
  return <>
    <button onClick={()=>void calendar.syncAll()}>Manual batch</button>
    <button onClick={()=>void calendar.syncAll('11111111-1111-4111-8111-111111111111')}>Admitted batch</button>
  </>;
}
function SplitHarness(){
  const calendar=useCalendarSync();
  return <>
    <button onClick={()=>void calendar.syncAll()}>Split sync</button>
    <span data-testid="split-google">{calendar.messageFor(google.id)}</span>
    <span data-testid="split-microsoft">{calendar.messageFor(microsoft.id)}</span>
  </>;
}
function HeldHarness(){
  const calendar=useCalendarSync(),release=useRef<(()=>void)|null>(null);
  return <>
    <button onClick={()=>{release.current=calendar.holdAutomaticSync();}}>Hold calendars</button>
    <button onClick={()=>release.current?.()}>Release calendars</button>
    <button onClick={()=>void calendar.syncAll()}>Final calendar pass</button>
  </>;
}
it('holds automatic source-triggered work until the explicit final pass of Sync All',async()=>{
  const ticket={connectionId:google.id,runId:'11111111-1111-4111-8111-111111111111'};
  const requests=vi.fn<typeof fetch>(async input=>String(input)==='/api/calendars/sync-all'
    ?Response.json({invocations:[ticket]}):Response.json({connectionId:google.id,status:'success',completedAt:new Date().toISOString(),errorCode:null}));
  vi.stubGlobal('fetch',requests);
  const fresh={...google,lastSyncCompletedAt:new Date(Date.now()-60000).toISOString(),lastSyncStatus:'success' as const};
  const view=render(<CalendarSyncProvider initialConnections={[fresh]}><HeldHarness/></CalendarSyncProvider>);
  const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Hold calendars'}));
  view.rerender(<CalendarSyncProvider initialConnections={[{...fresh,sourceSyncAt:new Date(Date.now()-1000).toISOString()}]}><HeldHarness/></CalendarSyncProvider>);
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(requests).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Final calendar pass'}));
  await waitFor(()=>expect(requests).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button',{name:'Release calendars'}));
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(requests).toHaveBeenCalledTimes(2);
});
it('runs destination tickets as separate requests and preserves another destination after a provider failure',async()=>{
  const tickets=[{connectionId:google.id,runId:'11111111-1111-4111-8111-111111111111'},{connectionId:microsoft.id,runId:'22222222-2222-4222-8222-222222222222'}];
  const requests=vi.fn<typeof fetch>(async input=>{
    if(String(input)==='/api/calendars/sync-all')return Response.json({invocations:tickets});
    if(String(input)===`/api/calendars/${google.id}/sync`)return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});
    return Response.json({connectionId:microsoft.id,status:'success',completedAt:new Date().toISOString(),errorCode:null});
  });
  vi.stubGlobal('fetch',requests);
  const fresh=[google,microsoft].map(c=>({...c,lastSyncCompletedAt:new Date().toISOString(),lastSyncStatus:'success' as const}));
  render(<CalendarSyncProvider initialConnections={fresh}><SplitHarness/></CalendarSyncProvider>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Split sync'}));
  await waitFor(()=>expect(requests).toHaveBeenCalledTimes(3));
  expect(requests.mock.calls.slice(1)).toEqual(tickets.map(ticket=>[
    `/api/calendars/${ticket.connectionId}/sync`,{method:'POST',keepalive:true,headers:{'x-kairos-calendar-run':ticket.runId}},
  ]));
  expect(screen.getByTestId('split-google').textContent).toContain('could not be synchronized');
  expect(screen.getByTestId('split-microsoft').textContent).toContain('synchronized.');
});
it('a new source revision schedules separate calendar work once while failed visibility retries stay paced',async()=>{
  const ticket={connectionId:google.id,runId:'11111111-1111-4111-8111-111111111111'};
  const requests=vi.fn<typeof fetch>(async input=>String(input)==='/api/calendars/sync-all'
    ?Response.json({invocations:[ticket]}):Response.json({code:'SERVICE_UNAVAILABLE'},{status:503}));
  vi.stubGlobal('fetch',requests);
  const fresh={...google,lastSyncCompletedAt:new Date(Date.now()-60000).toISOString(),lastSyncStatus:'success' as const};
  const view=render(<CalendarSyncProvider initialConnections={[fresh]}><SplitHarness/></CalendarSyncProvider>);
  expect(requests).not.toHaveBeenCalled();
  view.rerender(<CalendarSyncProvider initialConnections={[{...fresh,sourceSyncAt:new Date(Date.now()-1000).toISOString()}]}><SplitHarness/></CalendarSyncProvider>);
  await waitFor(()=>expect(requests).toHaveBeenCalledTimes(2));
  act(()=>{for(let i=0;i<6;i++)document.dispatchEvent(new Event('visibilitychange'));});
  expect(requests).toHaveBeenCalledTimes(2);
});
it('an admitted final calendar pass waits for older work then starts its own claimed request',async()=>{
  let settle!:(response:Response)=>void;
  const requests=vi.fn<typeof fetch>();
  requests.mockImplementationOnce(()=>new Promise<Response>(resolve=>{settle=resolve;}));
  requests.mockImplementation(async()=>Response.json({status:'success',results:[]}));
  vi.stubGlobal('fetch',requests);
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString(),lastSyncStatus:'success'}]}><AdmittedHarness/></CalendarSyncProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Manual batch'}));
  await waitFor(()=>expect(requests).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button',{name:'Admitted batch'}));
  expect(requests).toHaveBeenCalledTimes(1);
  await act(async()=>settle(Response.json({status:'success',results:[]})));
  await waitFor(()=>expect(requests).toHaveBeenCalledTimes(2));
  expect(requests.mock.calls[1]).toEqual(['/api/calendars/sync-all',{method:'POST',keepalive:true,headers:{'x-kairos-sync-all-run':'11111111-1111-4111-8111-111111111111','x-kairos-calendar-invocations':'separate'}}]);
});

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
    <span data-testid="gstatus">{calendar.connections.find(c=>c.id==='google-1')?.lastSyncStatus}</span>
    <span data-testid="grecovery">{calendar.recoveryFor('google-1')?.message??''}</span>
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
it.each([false,true])('shows denied Google consent safely for new or connected calendars (%s)',async connected=>{
  window.history.replaceState(null,'','/onboarding?calendarProvider=google&calendarError=CALENDAR_AUTH_REQUIRED');
  function ErrorHarness(){const calendar=useCalendarSync();return <span>{calendar.messageFor(connected?google.id:'google')}</span>;}
  render(<CalendarSyncProvider initialConnections={connected?[{...google,lastSyncCompletedAt:new Date().toISOString()}]:[]}><ErrorHarness/></CalendarSyncProvider>);
  await screen.findByText('Google Calendar authorization was not completed.');
  expect(window.location.search).toBe('');
});
it('does not reflect an unknown Google callback error and removes query flags',async()=>{
  const secret='SYNTHETIC_PRIVATE_untrusted_error';
  window.history.replaceState(null,'','/onboarding?calendarProvider=google&calendarError='+secret+'&calendarStage='+secret);
  function ErrorHarness(){const calendar=useCalendarSync();return <span>{calendar.messageFor('google')}</span>;}
  render(<CalendarSyncProvider initialConnections={[]}><ErrorHarness/></CalendarSyncProvider>);
  await screen.findByText('Google Calendar could not be connected. Try again.');
  expect(document.body.textContent).not.toContain(secret);expect(window.location.search).toBe('');
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

it.each(['single','batch'] as const)('shows a new partial rate limit after an unrelated %s failure',async path=>{
  let first!:(response:Response)=>void,calls=0;
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(async()=>++calls===1?new Promise<Response>(resolve=>{first=resolve;}):Response.json({code:'SERVICE_UNAVAILABLE'},{status:503})));
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString()}]}><Harness/><AdmittedHarness/></CalendarSyncProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:path==='single'?'sync google':'Manual batch'}));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  const row={connectionId:google.id,status:'partial',errorCode:'RATE_LIMITED',retryAfterSeconds:60,completedAt:new Date().toISOString()};
  await act(async()=>first(Response.json(path==='single'?row:{status:'partial',results:[row]})));
  expect(screen.getByTestId('gmsg')).toHaveTextContent(/limiting repeated requests/);
  await user.click(screen.getByRole('button',{name:'sync google'}));
  expect(calls).toBe(2);
});

it.each(['single','batch-http','batch-row'] as const)('keeps uncertainty visible across mixed late rate/uncertainty responses in %s',async path=>{
  for(const lateCode of ['RATE_LIMITED','SYNC_RECOVERY_REQUIRED'] as const){
    const earlyCode=lateCode==='RATE_LIMITED'?'SYNC_RECOVERY_REQUIRED':'RATE_LIMITED';
    let first!:(response:Response)=>void,calls=0;
    const failure=(code:string)=>Response.json({code},{status:code==='RATE_LIMITED'?429:409,headers:code==='RATE_LIMITED'?{'Retry-After':'60'}:{}});
    const fetchMock=vi.fn<typeof fetch>(async()=>++calls===1?new Promise<Response>(resolve=>{first=resolve;}):failure(earlyCode));
    vi.stubGlobal('fetch',fetchMock);
    const view=render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString()}]}><Harness/><AdmittedHarness/></CalendarSyncProvider>);
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:path==='single'?'sync google':'Manual batch'}));
    await user.click(screen.getByRole('button',{name:'sync google'}));
    await act(async()=>first(path==='batch-row'?Response.json({status:'partial',results:[{connectionId:google.id,status:'partial',completedAt:new Date().toISOString(),errorCode:lateCode}]}):failure(lateCode)));
    expect(screen.getByTestId('gmsg')).toHaveTextContent(/Prior provider work has an uncertain outcome/);
    const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+61000);
    await user.click(screen.getByRole('button',{name:'sync google'}));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock.mockRestore();view.unmount();
  }
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
  expect(fetchMock).toHaveBeenCalledWith("/api/calendars/sync-all",{method:"POST",keepalive:true,headers:{'x-kairos-calendar-invocations':'separate'}});

  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await act(async()=>{await Promise.resolve();});
  expect(fetchMock).toHaveBeenCalledTimes(1);

  now+=16*60*1000;
  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
});

it.each(['http','provider'] as const)('spaces failed automatic calendar checks without blocking manual retries: %s',async mode=>{
  let now=Date.parse('2026-10-19T22:00:00.000Z');
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  const requests=vi.fn(async()=>mode==='http'
    ?Response.json({code:'SERVICE_UNAVAILABLE'},{status:503})
    :Response.json({results:[{connectionId:google.id,status:'error',errorCode:'SERVICE_UNAVAILABLE'}]}));
  vi.stubGlobal('fetch',requests);
  render(<CalendarSyncProvider initialConnections={[google]}><AdmittedHarness/></CalendarSyncProvider>);
  await act(async()=>{await Promise.resolve();});
  expect(requests).toHaveBeenCalledTimes(1);
  for(let i=0;i<6;i++)await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  expect(requests).toHaveBeenCalledTimes(1);
  await userEvent.setup().click(screen.getByRole('button',{name:'Manual batch'}));
  expect(requests).toHaveBeenCalledTimes(2);
  now+=15*60*1000;
  await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  expect(requests).toHaveBeenCalledTimes(3);
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

it.each([
  ['SYNC_IN_PROGRESS',false,true],['SYNC_IN_PROGRESS',true,true],
  ['RATE_LIMITED',false,false],['RATE_LIMITED',true,false],
  ['SYNC_RECOVERY_REQUIRED',false,false],['SYNC_RECOVERY_REQUIRED',true,false],
] as const)('keeps %s recovery causal when automatic conflict arrives after success: %s',async(code,late,retryAllowed)=>{
  let auto!:(response:Response)=>void,manual!:(response:Response)=>void,manualCalls=0;
  const completed=()=>Response.json({connectionId:google.id,status:'success',completedAt:new Date().toISOString(),createdCount:0,updatedCount:0,deletedCount:0,unchangedCount:1,failedCount:0,errorCode:null});
  const fetchMock=vi.fn<typeof fetch>(async input=>{
    if(String(input)==='/api/calendars/sync-all')return new Promise<Response>(resolve=>{auto=resolve;});
    if(String(input)==='/api/calendars/google-1/sync')return ++manualCalls===1?new Promise<Response>(resolve=>{manual=resolve;}):completed();
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<CalendarSyncProvider initialConnections={[google]}><Harness/></CalendarSyncProvider>);
  const user=userEvent.setup();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  const conflict=()=>Response.json({code},{status:code==='RATE_LIMITED'?429:409,headers:code==='RATE_LIMITED'?{'Retry-After':'3600'}:{}});
  if(late){await act(async()=>manual(completed()));await act(async()=>auto(conflict()));}
  else{await act(async()=>auto(conflict()));await act(async()=>manual(completed()));}
  await user.click(screen.getByRole('button',{name:'sync google'}));
  expect(fetchMock).toHaveBeenCalledTimes(retryAllowed?3:2);
  if(!retryAllowed)expect(screen.getByTestId('gmsg')).toHaveTextContent(code==='RATE_LIMITED'?/limiting repeated requests/:/Prior provider work has an uncertain outcome/);
  expect(screen.getByTestId('count')).toHaveTextContent('1');
});

it('retains successful metadata and recovery presentation when an older manual busy response arrives',async()=>{
  let first!:(response:Response)=>void,calls=0;
  const fetchMock=vi.fn<typeof fetch>(async()=>++calls===1?new Promise<Response>(resolve=>{first=resolve;}):Response.json({connectionId:google.id,status:'success',completedAt:new Date().toISOString(),errorCode:null}));
  vi.stubGlobal('fetch',fetchMock);
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString(),lastSyncStatus:'success'}]}><Harness/></CalendarSyncProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'sync google'}));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  await act(async()=>first(Response.json({connectionId:google.id,status:'error',errorCode:'SYNC_IN_PROGRESS'},{status:409})));
  expect(screen.getByTestId('gstatus')).toHaveTextContent('success');
  expect(screen.getByTestId('grecovery')).toBeEmptyDOMElement();
  await user.click(screen.getByRole('button',{name:'sync google'}));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('ignores a late per-connection busy result only for the destination that completed',async()=>{
  let auto!:(response:Response)=>void,manual!:(response:Response)=>void,calls=0;
  const success=()=>Response.json({connectionId:google.id,status:'success',completedAt:new Date().toISOString(),errorCode:null});
  const fetchMock=vi.fn<typeof fetch>(async input=>{
    if(String(input)==='/api/calendars/sync-all')return new Promise<Response>(resolve=>{auto=resolve;});
    return ++calls===1?new Promise<Response>(resolve=>{manual=resolve;}):success();
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<CalendarSyncProvider initialConnections={[google,microsoft]}><Harness/></CalendarSyncProvider>);
  const user=userEvent.setup();await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  await act(async()=>manual(success()));
  await act(async()=>auto(Response.json({status:'error',results:[google,microsoft].map(c=>({connectionId:c.id,status:'error',errorCode:'SYNC_IN_PROGRESS'}))})));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  await user.click(screen.getByRole('button',{name:'sync microsoft'}));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/calendars/google-1/sync');
});

it.each([false,true])('credential testing cannot settle a sync conflict arriving after the test: %s',async late=>{
  let auto!:(response:Response)=>void,testCredentials!:(response:Response)=>void;
  const fetchMock=vi.fn<typeof fetch>(async input=>{
    if(String(input)==='/api/calendars/sync-all')return new Promise<Response>(resolve=>{auto=resolve;});
    if(String(input)==='/api/calendars/caldav/test')return new Promise<Response>(resolve=>{testCredentials=resolve;});
    return Response.json({connectionId:apple.id,status:'success',completedAt:new Date().toISOString(),errorCode:null});
  });
  vi.stubGlobal('fetch',fetchMock);
  function CredentialHarness(){const c=useCalendarSync();return <><button onClick={()=>void c.testIcloud('synthetic@example.invalid','synthetic-secret')}>Test credentials</button><button onClick={()=>void c.syncConnection(apple.id)}>Sync apple</button></>;}
  render(<CalendarSyncProvider initialConnections={[apple]}><CredentialHarness/></CalendarSyncProvider>);
  const user=userEvent.setup();await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button',{name:'Test credentials'}));
  const conflict=()=>Response.json({code:'SYNC_IN_PROGRESS'},{status:409});
  if(late){await act(async()=>testCredentials(Response.json({ok:true})));await act(async()=>auto(conflict()));}
  else{await act(async()=>auto(conflict()));await act(async()=>testCredentials(Response.json({ok:true})));}
  await user.click(screen.getByRole('button',{name:'Sync apple'}));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  ['single','RATE_LIMITED'],['single','SYNC_RECOVERY_REQUIRED'],
  ['batch','RATE_LIMITED'],['batch','SYNC_RECOVERY_REQUIRED'],
] as const)('retains an active %s %s warning when an older partial reconciliation arrives',async(path,code)=>{
  let first!:(response:Response)=>void,calls=0;
  const fetchMock=vi.fn<typeof fetch>(async()=>++calls===1?new Promise<Response>(resolve=>{first=resolve;}):Response.json({code},{status:code==='RATE_LIMITED'?429:409,headers:code==='RATE_LIMITED'?{'Retry-After':'3600'}:{}}));
  vi.stubGlobal('fetch',fetchMock);
  render(<CalendarSyncProvider initialConnections={[{...google,lastSyncCompletedAt:new Date().toISOString()}]}><Harness/><AdmittedHarness/></CalendarSyncProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:path==='single'?'sync google':'Manual batch'}));
  await user.click(screen.getByRole('button',{name:'sync google'}));
  const result={connectionId:google.id,status:'partial',completedAt:new Date().toISOString(),errorCode:'CALENDAR_PARTIAL_SYNC',failedCount:1};
  await act(async()=>first(Response.json(path==='single'?result:{status:'partial',results:[result]})));
  expect(screen.getByTestId('gmsg')).toHaveTextContent(code==='RATE_LIMITED'?/limiting repeated requests/:/Prior provider work has an uncertain outcome/);
  await user.click(screen.getByRole('button',{name:'sync google'}));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
