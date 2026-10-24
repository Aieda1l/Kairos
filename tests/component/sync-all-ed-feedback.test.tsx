// @vitest-environment jsdom
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EdProvider} from '@/features/ed/ed-provider';
import {ConnectedSourceSyncControls} from '@/features/sync/connected-source-sync-controls';

vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
const {calendarSync}=vi.hoisted(()=>({calendarSync:vi.fn()}));
vi.mock('@/features/submission-status/submission-status-provider',()=>({useSubmissionStatusSync:()=>({phase:'partial',message:'8 of 9 submission statuses updated',syncNow:async()=>{}})}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({useGradescope:()=>({connection:null,phase:'idle',message:'',syncNow:async()=>{}})}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>({connections:[],syncAll:calendarSync,holdAutomaticSync:()=>()=>{}})}));
const runId='11111111-1111-4111-8111-111111111111';
const connection={id:'synthetic-ed',kind:'ed' as const,label:'Ed',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never' as const,lastErrorCode:null};
const syncState={lastAttemptedAt:null,lastSuccessfulAt:null,lastErrorCode:null,updatedCount:0,failedCount:0};
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>calendarSync.mockReset());
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

it.each(['settled','uncertain','cooldown'] as const)('a fresh manual Sync All reports the current Ed recovery attempt (%s)',async mode=>{
 let admissionCount=0;let edCount=0;
 const requests=vi.fn(async(input:RequestInfo|URL)=>{
  if(String(input)==='/api/sync-all/start'){
   admissionCount++;
   return Response.json({runId:admissionCount===1?runId:'22222222-2222-4222-8222-222222222222',expiresAt:'2099-01-01T00:00:00Z',steps:['ed','calendars']});
  }
  edCount++;
  if(edCount===1||mode==='uncertain')return Response.json(mode==='cooldown'?{code:'RATE_LIMITED',retryAfterSeconds:120}:{code:'SYNC_RECOVERY_REQUIRED',message:'synthetic-private-detail'},{status:mode==='cooldown'?429:409});
  return Response.json({lastAttemptedAt:'2026-10-22T06:11:06Z',lastSuccessfulAt:'2026-10-22T06:11:06Z',lastErrorCode:null,statusUpdatedCount:0,failedCourseCount:0});
 });
 vi.stubGlobal('fetch',requests);
 render(<EdProvider connection={connection} initialCourses={[]} initialSyncState={syncState}><ConnectedSourceSyncControls canvasConnected/></EdProvider>);
 const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'Sync All'}));
 await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(1));
 expect(screen.queryByText('Ed sync complete.')).not.toBeInTheDocument();
 expect(edCount).toBe(1);
 await user.click(screen.getByRole('button',{name:'Sync All'}));
 await waitFor(()=>expect(calendarSync).toHaveBeenCalledTimes(2));
 expect(admissionCount).toBe(2);
 expect(edCount).toBe(mode==='cooldown'?1:2);
 if(mode==='settled')expect(screen.getByText('Ed sync complete.')).toHaveAttribute('role','status');
 else{
  expect(screen.queryByText('Ed sync complete.')).not.toBeInTheDocument();
  expect(screen.getByText(mode==='cooldown'?/Ed:.*120 seconds/:/Ed:.*uncertain outcome/)).toBeVisible();
 }
 expect(document.body).not.toHaveTextContent('synthetic-private-detail');
});
