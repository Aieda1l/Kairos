// @vitest-environment jsdom
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import type {CalendarConnection} from '@/lib/calendar/types';
import type {SourceConnection} from '@/lib/assignments/types';
import type {SourceCourse} from '@/lib/sources/types';
import {CalendarSyncProvider,useCalendarSync} from '@/features/calendars/calendar-provider';
import {EdProvider,useEd} from '@/features/ed/ed-provider';
import {ConnectedSourceSyncControls} from '@/features/sync/connected-source-sync-controls';
import {SYNC_ALL_STEPS} from '@/lib/sync-all/types';

const {submissionSync,gradescopeSync,refresh,order}=vi.hoisted(()=>({
  submissionSync:vi.fn(),gradescopeSync:vi.fn(),refresh:vi.fn(),order:[] as string[],
}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
// Prior source providers already have their own boundary tests. Keep their partial
// state visible while exercising the real Ed and destination orchestration here.
vi.mock('@/features/submission-status/submission-status-provider',()=>({
  useSubmissionStatusSync:()=>({phase:'partial',message:'Some Canvas statuses failed.',syncNow:submissionSync}),
}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({
  useGradescope:()=>({connection:{id:'gradescope',enabled:true},courses:[],phase:'partial',message:'Some Gradescope courses failed.',syncNow:gradescopeSync}),
}));

const edConnection:SourceConnection={id:'ed-connection',kind:'ed',label:'Ed',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null};
const course:SourceCourse={id:'local-ed',sourceConnectionId:edConnection.id,externalCourseId:'123',shortName:'CSE 331',fullName:'Software Design',term:'Autumn',year:'2026',enabled:true,firstSeenAt:'2026-10-05T00:00:00Z',lastSeenAt:'2026-10-05T00:00:00Z'};
const connections:CalendarConnection[]=(['google','microsoft','caldav'] as const).map(provider=>({
  id:provider+'-destination',provider,label:provider+' Calendar',accountLabel:null,
  remoteCalendarId:'remote-'+provider,remoteCalendarName:'Kairos',enabled:true,
  lastSyncStartedAt:null,lastSyncCompletedAt:'2099-01-01T00:00:00Z',lastSyncStatus:'success',lastErrorCode:null,
}));
function State(){
  const ed=useEd(),calendars=useCalendarSync();
  return <>
    <output data-testid="ed-state">{JSON.stringify({phase:ed.phase,updated:ed.updatedCount,failed:ed.failedCount})}</output>
    {connections.map(c=><output key={c.id} data-testid={c.id}>{calendars.phaseFor(c.id)}</output>)}
  </>;
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();order.length=0;});

it('continues partial sources and blocked Ed through all three calendar tickets, then completes Ed only after a fresh admitted response',async()=>{
  const rootIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
  const ticketIds=[
    ['31111111-1111-4111-8111-111111111111','32222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],
    ['41111111-1111-4111-8111-111111111111','42222222-2222-4222-8222-222222222222','43333333-3333-4333-8333-333333333333'],
  ];
  let run=-1;
  submissionSync.mockImplementation(async()=>{order.push('submission');});
  gradescopeSync.mockImplementation(async()=>{order.push('gradescope');});
  const requests=vi.fn<typeof fetch>(async(input,init)=>{
    const url=String(input);
    if(url==='/api/sync-all/start'){
      run++;order.push('admission');
      return Response.json({runId:rootIds[run],expiresAt:'2099-01-01T00:00:00Z',steps:SYNC_ALL_STEPS});
    }
    const parentHeaders={'x-kairos-calendar-sync':'defer','x-kairos-sync-all-run':rootIds[run]};
    if(url==='/api/sources/canvas/sync'){
      order.push('canvas');expect(init).toEqual({method:'POST',headers:parentHeaders});
      return Response.json({connectionId:'canvas',inserted:1,updated:0,skipped:0,errors:[],partial:false,completedAt:'2026-10-23T12:00:00Z'});
    }
    if(url==='/api/sources/ed/sync'){
      order.push('ed');expect(init).toEqual({method:'POST',headers:parentHeaders});
      return run===0
        ?Response.json({code:'SYNC_RECOVERY_REQUIRED',message:'synthetic-private-detail'},{status:409})
        :Response.json({lastAttemptedAt:'2026-10-23T12:00:00Z',lastSuccessfulAt:'2026-10-23T12:00:00Z',lastErrorCode:null,statusUpdatedCount:3,failedCourseCount:0,insertedCount:1,updatedCount:2});
    }
    if(url==='/api/calendars/sync-all'){
      order.push('plan');
      expect(init).toEqual({method:'POST',keepalive:true,headers:{'x-kairos-sync-all-run':rootIds[run],'x-kairos-calendar-invocations':'separate'}});
      return Response.json({invocations:connections.map((c,i)=>({connectionId:c.id,runId:ticketIds[run][i]}))});
    }
    const index=connections.findIndex(c=>url===`/api/calendars/${c.id}/sync`);
    if(index<0)throw new Error('Unexpected request '+url);
    const connection=connections[index];order.push(connection.provider);
    expect(init).toEqual({method:'POST',keepalive:true,headers:{'x-kairos-calendar-run':ticketIds[run][index]}});
    return Response.json({connectionId:connection.id,status:'success',completedAt:'2099-01-01T00:00:00Z',errorCode:null,createdCount:1,updatedCount:0,deletedCount:0,unchangedCount:2,failedCount:0});
  });
  vi.stubGlobal('fetch',requests);
  render(<CalendarSyncProvider initialConnections={connections}>
    <EdProvider connection={edConnection} initialCourses={[course]} initialSyncState={{lastAttemptedAt:null,lastSuccessfulAt:null,lastErrorCode:null,updatedCount:0,failedCount:0}}>
      <ConnectedSourceSyncControls canvasConnected/><State/>
    </EdProvider>
  </CalendarSyncProvider>);
  expect(requests).not.toHaveBeenCalled();
  const user=userEvent.setup();
  for(let attempt=0;attempt<2;attempt++){
    await user.click(screen.getByRole('button',{name:'Sync All'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Sync All'})).toBeEnabled());
    expect(requests).toHaveBeenCalledTimes((attempt+1)*7);
    expect(order.slice(attempt*9,(attempt+1)*9)).toEqual(['admission','canvas','submission','gradescope','ed','plan','google','microsoft','caldav']);
    for(const child of [submissionSync,gradescopeSync])expect(child).toHaveBeenNthCalledWith(attempt+1,{deferCalendarSync:true,syncAllRunId:rootIds[attempt]});
    for(const c of connections)expect(screen.getByTestId(c.id)).toHaveTextContent('success');
    expect(screen.getByText(/Canvas submissions: Some Canvas statuses failed/)).toBeVisible();
    expect(screen.getByText(/Gradescope: Some Gradescope courses failed/)).toBeVisible();
    if(attempt===0){
      expect(screen.getByText(/Ed: Prior provider work has an uncertain outcome/)).toBeVisible();
      expect(screen.queryByText('Ed sync complete.')).not.toBeInTheDocument();
      expect(screen.getByTestId('ed-state')).toHaveTextContent('"updated":0');
    }else{
      expect(screen.getByText('Ed sync complete.')).toBeVisible();
      expect(screen.queryByText(/Ed: Prior provider work/)).not.toBeInTheDocument();
      expect(screen.getByTestId('ed-state')).toHaveTextContent('"updated":3');
      expect(screen.getByTestId('ed-state')).toHaveTextContent('"failed":0');
    }
  }
  expect(requests.mock.calls.filter(([url])=>url==='/api/sync-all/start')).toHaveLength(2);
  expect(new Set(ticketIds.flat()).size).toBe(6);
  expect(document.body.textContent).not.toContain('synthetic-private-detail');
});
