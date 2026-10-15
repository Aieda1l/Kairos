// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {OnboardingWizard} from '@/features/onboarding/onboarding-wizard';
import {createOnboardingState,applyOnboardingCommand} from '@/lib/onboarding/state';
import type {OnboardingCommand,OnboardingState} from '@/lib/onboarding/types';
import {getFirefoxDistribution} from '@/lib/extension-distribution';
const nav=vi.hoisted(()=>({refresh:vi.fn(),push:vi.fn(),ping:vi.fn(),startGoogle:vi.fn(async()=>{}),withCourses:false,saveEd:vi.fn(async()=>{}),saveGradescope:vi.fn(async()=>{})}));
const courses=['123','456'].map(externalCourseId=>({id:'synthetic-'+externalCourseId,sourceConnectionId:'synthetic-source',externalCourseId,shortName:null,fullName:'Synthetic course '+externalCourseId,term:null,year:null,enabled:externalCourseId==='123',firstSeenAt:'2026-10-01T00:00:00Z',lastSeenAt:'2026-10-01T00:00:00Z'}));
const connection={id:'synthetic-source',label:'Synthetic',enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:'never' as const,lastErrorCode:null};
vi.mock('next/navigation',()=>({useRouter:()=>nav}));
vi.mock('@/lib/browser-navigation',()=>({navigateDocument:nav.push}));
vi.mock('@/features/submission-status/extension-bridge',()=>({pingKairosExtension:nav.ping}));
// Provider transports are exercised separately; cards here remain real.
vi.mock('@/features/ed/ed-provider',()=>({useEd:()=>({connection:nav.withCourses?{...connection,kind:'ed'}:null,courses:nav.withCourses?courses:[],phase:'idle',refreshAccepted:vi.fn(),saveEnabledCourses:nav.saveEd,message:''})}));
vi.mock('@/features/gradescope/gradescope-provider',()=>({useGradescope:()=>({connection:nav.withCourses?{...connection,kind:'gradescope'}:null,courses:nav.withCourses?courses:[],phase:'idle',saveEnabledCourses:nav.saveGradescope,message:'',extensionDetected:false})}));
vi.mock('@/features/calendars/calendar-provider',()=>({useCalendarSync:()=>({connections:[],phaseFor:()=> 'idle',messageFor:()=>'',refreshAccepted:vi.fn(),syncAll:vi.fn(),startGoogle:nav.startGoogle})}));
let state:OnboardingState,enabled:boolean,saved:boolean,requests:Array<{path:string;method:string;body:Record<string,unknown>}>,conflict:boolean,serverTimeZone:string;
beforeEach(()=>{
  state=createOnboardingState();enabled=false;saved=false;conflict=false;requests=[];serverTimeZone='America/Los_Angeles';nav.withCourses=false;
  nav.push.mockClear();nav.refresh.mockClear();nav.startGoogle.mockClear();nav.ping.mockRejectedValue(new Error('absent'));
  nav.saveEd.mockClear();nav.saveGradescope.mockClear();
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    const method=init?.method??'GET',body=JSON.parse(String(init?.body??'{}'));
    requests.push({path,method,body});
    if(path==='/api/settings/onboarding'){
      if(method==='PATCH'){
        if(conflict){conflict=false;state={...state,revision:state.revision+1,currentStep:'ed'};return Response.json({code:'ONBOARDING_CONFLICT'},{status:409});}
        if(body.expectedRevision!==state.revision)return Response.json({code:'ONBOARDING_CONFLICT'},{status:409});
        state=applyOnboardingCommand(state,body.command as OnboardingCommand);
      }return Response.json({state});
    }
    if(path==='/api/settings/onboarding/draft'){
      if(method==='PUT')saved=true;
      if(method==='DELETE')saved=false;
      if(method==='POST')return Response.json(body.action==='test'?{ok:true,count:2}:{kind:body.kind,connected:true,connection:{id:'accepted'}});
      return Response.json({drafts:saved?[{kind:'canvas',saved:true}]:[]});
    }
    if(path==='/api/settings/submission-status'){if(method==='PUT')enabled=body.enabled as boolean;return Response.json({enabled});}
    if(path==='/api/settings/timezone'){if(method==='PUT')serverTimeZone=body.timeZone as string;return Response.json({timeZone:serverTimeZone});}
    if(path==='/api/settings/calendar')return Response.json({hideSubmitted:true});
    throw new Error('Unexpected local transport '+path);
  }));
});
function mount(initial=state){return render(<OnboardingWizard initialState={initial} initialTimeZone="America/Los_Angeles" canvasConnection={null} submissionEnabled={enabled} distribution={getFirefoxDistribution({})}/>);}
async function click(name:string){await userEvent.setup().click(screen.getByRole('button',{name}));}
it('orders optional steps, accepts IANA zones, skips every integration and finishes with authentication alone',async()=>{
  mount();
  await userEvent.setup().clear(screen.getByLabelText('Display timezone'));
  await userEvent.setup().type(screen.getByLabelText('Display timezone'),'Asia/Kathmandu');
  await click('Continue');
  for(const title of ['Firefox','Canvas','Submission status','Gradescope','Ed','Calendar destinations']){
    expect(screen.getByRole('heading',{name:title})).toBeVisible();await click('Skip');
  }
  await click('Finish setup');
  expect(state.status).toBe('completed');expect(enabled).toBe(false);expect(nav.push).toHaveBeenCalledWith('/upcoming');
  expect(requests.find(r=>r.path==='/api/settings/timezone'&&r.method==='PUT')?.body).toEqual({timeZone:'Asia/Kathmandu'});
});
it('keeps fresh visible credentials in memory across Back without writing storage or HTML',async()=>{
  mount({...state,currentStep:'canvas'});
  const secret='https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=memory-secret';
  await userEvent.setup().type(screen.getByLabelText('Canvas calendar feed URL'),secret);
  await click('Back');await click('Continue');
  expect(screen.getByLabelText('Canvas calendar feed URL')).toHaveValue(secret);
  expect(document.documentElement.outerHTML).not.toContain('memory-secret');
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});
it('keeps Firefox optional without a configured listing, checks presence and never blocks Canvas or Ed',async()=>{
  mount({...state,currentStep:'firefox'});
  expect(screen.getByText(/Firefox setup is optional/i)).toBeVisible();
  expect(screen.queryByRole('link',{name:/Install/})).toBeNull();
  await click('Check extension');expect(await screen.findByText(/not detected/i)).toBeVisible();
  await click('Continue');expect(screen.getByRole('heading',{name:'Canvas'})).toBeVisible();expect(screen.getByRole('button',{name:'Skip'})).toBeEnabled();
});
it('requires an explicit submission opt-in and persists it only on that step',async()=>{
  mount({...state,currentStep:'submission-status'});
  const box=screen.getByRole('checkbox',{name:'Enable browser submission refresh'});expect(box).not.toBeChecked();
  await userEvent.setup().click(box);await click('Continue');expect(enabled).toBe(true);
});
it('defers, resumes the same saved step, and stops on revision conflicts',async()=>{
  state={...state,currentStep:'canvas'};const view=mount();await click('Save for later');expect(state.status).toBe('deferred');
  view.unmount();mount();await click('Resume setup');expect(state.status).toBe('active');
  conflict=true;await click('Continue');
  expect(await screen.findByText(/progress changed/i)).toBeVisible();
  expect(screen.getByRole('heading',{name:'Canvas'})).toBeVisible();
  await click('Continue');expect(state.currentStep).toBe('ed');
  expect(screen.getByRole('heading',{name:'Canvas'})).toBeVisible();
  await click('Reload saved progress');expect(screen.getByRole('heading',{name:'Ed'})).toBeVisible();
});
it('prevents navigation while a private save is in flight',async()=>{
  const original=fetch;let release!:()=>void;
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    if(path==='/api/settings/onboarding/draft'&&init?.method==='PUT')await new Promise<void>(ok=>{release=ok;});
    return original(path,init);
  }));
  mount({...state,currentStep:'canvas'});
  await userEvent.setup().type(screen.getByLabelText('Canvas calendar feed URL'),'https://canvas.uw.edu/feeds/calendars/synthetic.ics');
  await click('Save privately');expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();
  release();await waitFor(()=>expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled());
});
it('saves timezone edits when deferring, without requiring an integration',async()=>{
  mount();await userEvent.setup().clear(screen.getByLabelText('Display timezone'));await userEvent.setup().type(screen.getByLabelText('Display timezone'),'Europe/London');
  await click('Save for later');expect(state.status).toBe('deferred');expect(state.drafts.timeZone).toBe('Europe/London');
});
it('never starts OAuth after a progress revision conflict',async()=>{
  mount({...state,currentStep:'calendars'});conflict=true;await click('Connect Google Calendar');
  expect(await screen.findByText(/progress could not be saved/)).toBeVisible();expect(nav.startGoogle).not.toHaveBeenCalled();
});
it('lets a deferred user reload the winning progress after a resume conflict',async()=>{
  state={...state,status:'deferred',currentStep:'canvas'};mount();conflict=true;
  await click('Resume setup');expect(await screen.findByText(/progress changed/i)).toBeVisible();
  await click('Reload saved progress');expect(screen.getByRole('heading',{name:'Setup saved for later'})).toBeVisible();
  await click('Resume setup');expect(screen.getByRole('heading',{name:'Ed'})).toBeVisible();
});
it('reuses metadata-only saved candidates and refreshes after success without deleting a newer candidate',async()=>{
  saved=true;mount({...state,currentStep:'canvas'});
  expect(await screen.findByText('Saved privately')).toBeVisible();
  expect(screen.getByLabelText('Canvas calendar feed URL')).toHaveValue('');
  await click('Test connection');expect(await screen.findByText(/2 assignments/)).toBeVisible();
  await click('Connect Canvas');
  await waitFor(()=>expect(nav.refresh).toHaveBeenCalled());
  expect(requests.some(r=>r.method==='DELETE')).toBe(false);
  expect(requests.filter(r=>r.path==='/api/settings/onboarding/draft'&&r.method==='GET').length).toBeGreaterThan(1);
  expect(screen.getByText('Saved privately')).toBeVisible();
  expect(state.currentStep).toBe('canvas');
  await click('Continue');
  for(let i=0;i<4;i++)await click('Skip');
  await click('Finish setup');expect(state.status).toBe('completed');
  expect(nav.push).toHaveBeenCalledWith('/upcoming');expect(requests.some(r=>r.path.includes('/disconnect'))).toBe(false);
});

it('explicit reload adopts winning public drafts and the next save retains them until a fresh edit',async()=>{
  state={...state,drafts:{timeZone:'America/Los_Angeles',edCourseIds:['123'],gradescopeCourseIds:['123']}};mount();
  const user=userEvent.setup();await user.clear(screen.getByLabelText('Display timezone'));await user.type(screen.getByLabelText('Display timezone'),'Europe/London');
  state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu',edCourseIds:['456'],gradescopeCourseIds:['456']}});
  await click('Continue');expect(await screen.findByText(/progress changed/i)).toBeVisible();
  await click('Reload saved progress');expect(screen.getByLabelText('Display timezone')).toHaveValue('Asia/Kathmandu');
  await click('Continue');expect(state.drafts).toEqual({timeZone:'Asia/Kathmandu',edCourseIds:['456'],gradescopeCourseIds:['456']});
  await click('Back');await user.clear(screen.getByLabelText('Display timezone'));await user.type(screen.getByLabelText('Display timezone'),'Europe/Paris');
  await click('Continue');expect(state.drafts).toEqual({timeZone:'Europe/Paris',edCourseIds:['456'],gradescopeCourseIds:['456']});
});

it('reload uses accepted timezone metadata when the winner has no timezone draft',async()=>{
  mount();state=applyOnboardingCommand(state,{type:'visit',step:'timezone'});serverTimeZone='Europe/London';
  await click('Continue');await click('Reload saved progress');expect(screen.getByLabelText('Display timezone')).toHaveValue('Europe/London');
  await click('Continue');expect(state.drafts.timeZone).toBe('Europe/London');
});

it.each(['ed','gradescope'] as const)('reload updates mounted %s selections and the next public/provider save retains the winner',async provider=>{
  nav.withCourses=true;state={...state,currentStep:provider,drafts:{timeZone:'UTC',edCourseIds:['123'],gradescopeCourseIds:['123']}};mount();
  const losing=screen.getByRole('checkbox',{name:'Synthetic course 123'}),winning=screen.getByRole('checkbox',{name:'Synthetic course 456'});
  expect(losing).toBeChecked();expect(winning).not.toBeChecked();
  state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu',edCourseIds:['456'],gradescopeCourseIds:['456']}});
  await click('Save selection');expect(await screen.findByText(/progress changed/i)).toBeVisible();await click('Reload saved progress');
  expect(screen.getByRole('checkbox',{name:'Synthetic course 123'})).toBe(losing);expect(losing).not.toBeChecked();expect(winning).toBeChecked();
  await click('Save selection');expect(state.drafts).toEqual({timeZone:'Asia/Kathmandu',edCourseIds:['456'],gradescopeCourseIds:['456']});
  expect(provider==='ed'?nav.saveEd:nav.saveGradescope).toHaveBeenCalledWith(['456']);
  await userEvent.setup().click(losing);await userEvent.setup().click(winning);await click('Save selection');
  expect(state.drafts[provider==='ed'?'edCourseIds':'gradescopeCourseIds']).toEqual(['123']);
  expect(state.drafts[provider==='ed'?'gradescopeCourseIds':'edCourseIds']).toEqual(['456']);
  expect(provider==='ed'?nav.saveEd:nav.saveGradescope).toHaveBeenLastCalledWith(['123']);
});

it('reload retains fresh secret memory while replacing public drafts and reading only private availability',async()=>{
  state={...state,currentStep:'canvas',drafts:{timeZone:'UTC'}};saved=true;mount();
  const input=screen.getByLabelText('Canvas calendar feed URL'),secret='https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=reload-memory-only';
  await userEvent.setup().type(input,secret);state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu',edCourseIds:['456']}});
  await click('Continue');await click('Reload saved progress');expect(screen.getByLabelText('Canvas calendar feed URL')).toBe(input);expect(input).toHaveValue(secret);
  expect(document.documentElement.outerHTML).not.toContain('reload-memory-only');expect(localStorage.length+sessionStorage.length).toBe(0);
  expect(requests.filter(r=>r.path==='/api/settings/onboarding/draft').every(r=>r.method==='GET')).toBe(true);
  await click('Continue');expect(state.drafts).toEqual({timeZone:'Asia/Kathmandu',edCourseIds:['456']});
});

it.each([false,true])('defer and remount/resume retain an explicit submission choice from accepted %s',async accepted=>{
  enabled=accepted;state={...state,currentStep:'submission-status'};const view=mount();
  await userEvent.setup().click(screen.getByRole('checkbox',{name:'Enable browser submission refresh'}));await click('Save for later');
  expect(enabled).toBe(!accepted);expect(state.status).toBe('deferred');
  const preferenceIndex=requests.findIndex(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT');
  expect(preferenceIndex).toBeGreaterThan(requests.findIndex(r=>r.path==='/api/settings/onboarding'&&r.method==='PATCH'));
  expect((requests[preferenceIndex+1].body.command as OnboardingCommand).type).toBe('defer');
  view.unmount();mount();await click('Resume setup');expect(screen.getByRole('checkbox',{name:'Enable browser submission refresh'})).toHaveProperty('checked',!accepted);
});

it.each([false,true])('Skip does not write a changed local choice over accepted submission preference %s',async accepted=>{
  enabled=accepted;state={...state,currentStep:'submission-status'};mount();
  await userEvent.setup().click(screen.getByRole('checkbox',{name:'Enable browser submission refresh'}));await click('Skip');
  expect(enabled).toBe(accepted);expect(requests.filter(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT')).toHaveLength(0);expect(state.currentStep).toBe('gradescope');
});

it.each([false,true])('stale Continue cannot write accepted submission preference %s and reload reads its winner',async accepted=>{
  enabled=accepted;state={...state,currentStep:'submission-status'};mount();
  const checkbox=screen.getByRole('checkbox',{name:'Enable browser submission refresh'});await userEvent.setup().click(checkbox);
  state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu'}});
  await click('Continue');expect(await screen.findByText(/progress changed/i)).toBeVisible();
  expect(requests.filter(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT')).toHaveLength(0);expect(enabled).toBe(accepted);
  await click('Reload saved progress');expect(checkbox).toHaveProperty('checked',accepted);
  expect(requests.some(r=>r.path==='/api/settings/submission-status'&&r.method==='GET')).toBe(true);
  await click('Continue');expect(enabled).toBe(accepted);expect(state.currentStep).toBe('gradescope');
  const preferenceIndex=requests.findIndex(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT');
  expect((requests[preferenceIndex-1].body.command as OnboardingCommand).type).toBe('visit');
  expect((requests[preferenceIndex+1].body.command as OnboardingCommand)).toEqual({type:'visit',step:'gradescope'});
});

it.each([false,true])('reload reads the current preference when another tab changes initial metadata %s',async initial=>{
  enabled=initial;state={...state,currentStep:'submission-status'};mount();
  enabled=!initial;state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu'}});
  await click('Continue');expect(requests.filter(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT')).toHaveLength(0);expect(enabled).toBe(!initial);
  await click('Reload saved progress');expect(screen.getByRole('checkbox',{name:'Enable browser submission refresh'})).toHaveProperty('checked',!initial);
  await click('Continue');expect(enabled).toBe(!initial);
});

it.each([false,true])('stale defer cannot write accepted submission preference %s',async accepted=>{
  enabled=accepted;state={...state,currentStep:'submission-status'};mount();await userEvent.setup().click(screen.getByRole('checkbox',{name:'Enable browser submission refresh'}));
  state=applyOnboardingCommand(state,{type:'save-draft',drafts:{timeZone:'Asia/Kathmandu'}});await click('Save for later');
  expect(await screen.findByText(/progress changed/i)).toBeVisible();expect(enabled).toBe(accepted);expect(state.status).toBe('active');
  expect(requests.filter(r=>r.path==='/api/settings/submission-status'&&r.method==='PUT')).toHaveLength(0);
});
