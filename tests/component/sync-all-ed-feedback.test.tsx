// @vitest-environment jsdom
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {EdProvider} from '@/features/ed/ed-provider';
import {ConnectedSourceSyncControls} from '@/features/sync/connected-source-sync-controls';

vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/features/submission-status/submission-status-provider',()=>({useSubmissionStatusSync:()=>({phase:'partial',message:'8 of 9 submission statuses updated',syncNow:async()=>{}})}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({useGradescope:()=>({connection:null,phase:'idle',message:'',syncNow:async()=>{}})}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>({connections:[],syncAll:async()=>{},holdAutomaticSync:()=>()=>{}})}));
const runId='11111111-1111-4111-8111-111111111111';
const connection={id:'synthetic-ed',kind:'ed' as const,label:'Ed',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never' as const,lastErrorCode:null};
const syncState={lastAttemptedAt:null,lastSuccessfulAt:null,lastErrorCode:null,updatedCount:0,failedCount:0};
afterEach(()=>vi.unstubAllGlobals());
it.each(['success','failed','skipped'] as const)('reports this run’s Ed outcome independently of Canvas (%s)',async mode=>{
 const requests=vi.fn(async(input:RequestInfo|URL)=>{
  if(String(input)==='/api/sync-all/start')return Response.json({runId,expiresAt:'2099-01-01T00:00:00Z',steps:mode==='skipped'?[]:['ed']});
  if(mode==='failed')return Response.json({code:'ED_AUTH_INVALID'},{status:401});
  return Response.json({lastAttemptedAt:'2026-10-22T06:11:06Z',lastSuccessfulAt:'2026-10-22T06:11:06Z',lastErrorCode:null,statusUpdatedCount:0,failedCourseCount:0});
 });
 vi.stubGlobal('fetch',requests);
 render(<EdProvider connection={connection} initialCourses={[]} initialSyncState={syncState}><ConnectedSourceSyncControls canvasConnected/></EdProvider>);
 await userEvent.setup().click(screen.getByRole('button',{name:'Sync All'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Sync All'})).toBeEnabled());
 expect(screen.getByText(/Canvas submissions: 8 of 9 submission statuses updated/)).toBeVisible();
 if(mode==='success'){
  expect(screen.getByText('Ed sync complete.')).toHaveAttribute('role','status');
  expect(requests).toHaveBeenCalledWith('/api/sources/ed/sync',{method:'POST',headers:{'x-kairos-calendar-sync':'defer','x-kairos-sync-all-run':runId}});
 }else{
  expect(screen.queryByText('Ed sync complete.')).not.toBeInTheDocument();
  if(mode==='failed')expect(screen.getByText(/Ed:/)).toBeVisible();
  else expect(requests).toHaveBeenCalledTimes(1);
 }
});
