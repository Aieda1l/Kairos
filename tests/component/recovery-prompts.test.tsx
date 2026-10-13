// @vitest-environment jsdom
import {act,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RecoveryPrompts,ReturningRecoveryPrompts} from '@/features/recovery/recovery-prompts';
import {getRecoveryNotice} from '@/lib/recovery/presentation';
const state=vi.hoisted(()=>({
  submission:{enabled:false,automaticEnabled:false,extensionChecked:true,extensionDetected:false,lastErrorCode:null},
  gradescope:{connection:null,courses:[],extensionChecked:true,extensionDetected:false,lastErrorCode:null},
  ed:{connection:null,lastErrorCode:null},calendars:{connections:[],recoveryFor:()=>null},
}));
vi.mock('@/features/submission-status/submission-status-provider',()=>({useSubmissionStatusSync:()=>state.submission}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({useGradescope:()=>state.gradescope}));
vi.mock('@/features/ed/ed-provider',()=>({useEd:()=>state.ed}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>state.calendars}));
beforeEach(()=>{state.submission.enabled=false;state.submission.automaticEnabled=false;});
afterEach(()=>vi.useRealTimers());
it('allows dismissal without blocking unrelated controls or persisting private state',async()=>{
  const user=userEvent.setup();const action=vi.fn();
  render(<><RecoveryPrompts notices={[{key:'no-source',message:'Connect an optional source when ready.',action:'connect',href:'/sources'}]}/><button onClick={action}>Calendar view</button></>);
  expect(screen.getByRole('link',{name:'Connect'})).toHaveAttribute('href','/sources');
  await user.click(screen.getByRole('button',{name:'Dismiss guidance'}));
  expect(screen.queryByText(/optional source/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Calendar view'}));expect(action).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});
it('offers optional sources to established users without resuming completed setup',()=>{
  render(<ReturningRecoveryPrompts initialSources={[]} onboarding={{status:'completed',revision:4}}/>);
  expect(screen.getByRole('link',{name:'Connect'})).toHaveAttribute('href','/sources');
  expect(screen.queryByRole('link',{name:'Resume setup'})).not.toBeInTheDocument();
});
it('links deferred users to the existing explicit CAS resume flow',()=>{
  render(<ReturningRecoveryPrompts initialSources={[]} onboarding={{status:'deferred',revision:3}}/>);
  expect(screen.getByRole('link',{name:'Resume setup'})).toHaveAttribute('href','/onboarding');
});
it('prompts for a first successful sync without redirecting or forcing integrations',()=>{
  render(<ReturningRecoveryPrompts initialSources={[{kind:'canvas',enabled:true,lastSyncCompletedAt:null,lastErrorCode:null}]} onboarding={{status:'completed',revision:0}}/>);
  expect(screen.getByText(/no successful sync/i)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Retry'})).toHaveAttribute('href','/sources');
});
it('requires a genuinely enabled browser feature before prompting about extension absence',()=>{
  const props={initialSources:[{kind:'canvas' as const,enabled:true,lastSyncCompletedAt:'2026-10-10',lastErrorCode:null}],onboarding:{status:'completed' as const,revision:0}};
  const {rerender}=render(<ReturningRecoveryPrompts {...props}/>);
  expect(screen.queryByText(/extension.*not detected/i)).not.toBeInTheDocument();
  state.submission.enabled=true;state.submission.automaticEnabled=true;rerender(<ReturningRecoveryPrompts {...props}/>);
  expect(screen.getByRole('link',{name:'Verify extension'})).toHaveAttribute('href','/settings');
});
it('does not revive old extension errors after browser refresh is disabled',()=>{
  Object.assign(state.submission,{lastErrorCode:'EXTENSION_UNAVAILABLE'});
  render(<ReturningRecoveryPrompts initialSources={[{kind:'canvas',enabled:true,lastSyncCompletedAt:'2026-10-10',lastErrorCode:null}]} onboarding={{status:'completed',revision:0}}/>);
  expect(screen.queryByRole('link',{name:'Verify extension'})).not.toBeInTheDocument();
  Object.assign(state.submission,{lastErrorCode:null});
});
it('offers recovery/support for uncertain ownership without executing retry work',()=>{
  const notice=getRecoveryNotice('SYNC_RECOVERY_REQUIRED')!;
  const retry=vi.fn();render(<RecoveryPrompts notices={[notice]} onRetry={retry}/>);
  expect(screen.getByRole('link',{name:'Recovery and support'})).toHaveAttribute('href','/support');
  expect(retry).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Retry'})).not.toBeInTheDocument();
});
it('enforces bounded backoff on manual retry and never schedules a retry loop',async()=>{
  vi.useFakeTimers();const retry=vi.fn();
  render(<RecoveryPrompts notices={[getRecoveryNotice('RATE_LIMITED',{retryAfterSeconds:2})!]} onRetry={retry}/>);
  expect(screen.getByRole('button',{name:'Retry'})).toBeDisabled();
  await act(async()=>{vi.advanceTimersByTime(2000);});
  expect(screen.getByRole('button',{name:'Retry'})).toBeEnabled();expect(retry).not.toHaveBeenCalled();
  screen.getByRole('button',{name:'Retry'}).click();expect(retry).toHaveBeenCalledOnce();
});
