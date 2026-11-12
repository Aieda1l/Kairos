// @vitest-environment jsdom
import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {SubmissionStatusProvider} from '@/features/submission-status/submission-status-provider';
import {GradescopeProvider} from '@/features/gradescope/gradescope-provider';
import {EdProvider} from '@/features/ed/ed-provider';
import {ConnectedSourceSyncControls} from '@/features/sync/connected-source-sync-controls';
import type {SourceConnection} from '@/lib/assignments/types';

const {refresh,calendarSync,ping,syncCanvas,syncGradescope}=vi.hoisted(()=>({
  refresh:vi.fn(),calendarSync:vi.fn(),ping:vi.fn(),syncCanvas:vi.fn(),syncGradescope:vi.fn(),
}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>({
  connections:[],syncAll:calendarSync,holdAutomaticSync:()=>()=>{},
})}));
vi.mock('@/features/submission-status/extension-bridge',async()=>({
  ...await vi.importActual<typeof import('@/features/submission-status/extension-bridge')>('@/features/submission-status/extension-bridge'),
  pingKairosExtension:ping,syncExtensionBatch:syncCanvas,
}));
vi.mock('@/features/gradescope/extension-bridge',async()=>({
  ...await vi.importActual<typeof import('@/features/gradescope/extension-bridge')>('@/features/gradescope/extension-bridge'),
  syncGradescopeExtensionBatch:syncGradescope,
}));
const canvasId='11111111-1111-4111-8111-111111111111';
const gradescopeId='22222222-2222-4222-8222-222222222222';
const rootId='33333333-3333-4333-8333-333333333333';
const completedAt='2099-01-01T00:00:00Z';
const initial={lastAttemptedAt:null,lastSuccessfulAt:null,lastErrorCode:null,updatedCount:0,failedCount:0};
const connection=(kind:'ed'|'gradescope'):SourceConnection=>({id:kind,kind,label:kind,enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never',lastErrorCode:null});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});

it.each(['success','partial','failed'] as const)('waits until later coordinated work finishes before refreshing (%s Ed)',async outcome=>{
  let finishCalendars!:()=>void;
  calendarSync.mockImplementation(()=>new Promise<void>(resolve=>{finishCalendars=resolve;}));
  ping.mockResolvedValue({extensionVersion:'fixture',canvasTabDetected:true,gradescopeTabDetected:true});
  const assignments=[{assignmentLocalId:'local-canvas',courseId:'999',assignmentId:'4242'}];
  syncCanvas.mockResolvedValue({protocolVersion:1,requestId:canvasId,errorCode:null,results:assignments.map(item=>({
    ...item,state:'submitted',isLate:false,isMissing:false,submittedAt:null,checkedAt:completedAt,extractorVersion:'fixture',
  }))});
  syncGradescope.mockResolvedValue({protocolVersion:1,requestId:gradescopeId,errorCode:null,courses:[{
    courseId:'123',checkedAt:completedAt,errorCode:null,parseDiagnosticCounts:[],assignments:[],
  }]});
  const requests=vi.fn<typeof fetch>(async(input,init)=>{
    const url=String(input);
    if(url==='/api/sync-all/start')return Response.json({runId:rootId,expiresAt:completedAt,steps:['canvas-submissions','gradescope','ed','calendars']});
    if(url==='/api/sources/canvas/submission-status/start')return Response.json({requestId:canvasId,assignments,maxBatchSize:100});
    if(url==='/api/sources/canvas/submission-status/complete')return Response.json({requestId:canvasId,updatedCount:1,failedCount:0,ignoredStale:0,lastAttemptedAt:completedAt,lastSuccessfulAt:completedAt,lastErrorCode:null});
    if(url==='/api/sources/gradescope/sync/start')return Response.json({protocolVersion:1,requestId:gradescopeId,courseIds:['123'],maxCourseBatchSize:20});
    if(url==='/api/sources/gradescope/sync/complete')return Response.json({requestId:gradescopeId,insertedCount:0,updatedCount:1,statusUpdatedCount:1,failedCourseCount:0,ignoredStale:0,lastAttemptedAt:completedAt,lastSuccessfulAt:completedAt,lastErrorCode:null,failureDiagnostics:[],failureHttpStatuses:[]});
    if(url==='/api/sources/ed/sync'){
      expect(init).toEqual({method:'POST',headers:{'x-kairos-calendar-sync':'defer','x-kairos-sync-all-run':rootId}});
      if(outcome==='failed')return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});
      return Response.json({lastAttemptedAt:completedAt,lastSuccessfulAt:completedAt,lastErrorCode:outcome==='partial'?'PARTIAL_SYNC':null,statusUpdatedCount:1,failedCourseCount:outcome==='partial'?1:0,insertedCount:0,updatedCount:1});
    }
    throw new Error('Unexpected synthetic route');
  });
  vi.stubGlobal('fetch',requests);
  render(<SubmissionStatusProvider enabled automaticEnabled={false} initialSyncState={initial}>
    <GradescopeProvider connection={connection('gradescope')} initialCourses={[]} initialSyncState={initial}>
      <EdProvider connection={connection('ed')} initialCourses={[]} initialSyncState={initial}>
        <ConnectedSourceSyncControls canvasConnected/>
      </EdProvider>
    </GradescopeProvider>
  </SubmissionStatusProvider>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync All'}));
  await waitFor(()=>expect(calendarSync).toHaveBeenCalledOnce());
  try{
    expect(syncCanvas).toHaveBeenCalledOnce();
    expect(syncGradescope).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  }finally{await act(async()=>finishCalendars());}
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sync All'})).toBeEnabled());
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(requests.mock.calls.filter(([url])=>String(url).endsWith('/complete'))).toHaveLength(2);
});
