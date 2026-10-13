"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {Alert} from '@/components/ui/alert';
import {CanvasSourceCard} from '@/features/sources/canvas-source-card';
import {EdSourceCard} from '@/features/sources/ed-source-card';
import {GradescopeSourceCard} from '@/features/sources/gradescope-source-card';
import {CalendarDestinations} from '@/features/sources/calendar-destinations';
import {TimezoneControl} from '@/features/settings/timezone-control';
import {FirefoxSetupStep} from './firefox-setup-step';
import {PrivateDraftProvider,type DraftKind,type PrivateDraftSession} from './private-drafts';
import {onboardingStateSchema} from '@/lib/onboarding/state';
import {providerRecoveryMessage} from '@/lib/abuse/client-errors';
import {validateTimeZone} from '@/lib/dates/validate-timezone';
import {navigateDocument} from '@/lib/browser-navigation';
import type {OnboardingCommand,OnboardingStep,OnboardingState,IntegrationStep} from '@/lib/onboarding/types';
import type {SourceConnection} from '@/lib/assignments/types';
import type {FirefoxDistribution} from '@/lib/extension-distribution';
import type {SecretDraft} from '@/lib/onboarding/secret-draft';
const steps:OnboardingStep[]=['timezone','firefox','canvas','submission-status','gradescope','ed','calendars','finish'];
const titles=['Timezone','Firefox','Canvas','Submission status','Gradescope','Ed','Calendar destinations','Finish'];
class SetupRequestError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function request(path:string,method='GET',body?:unknown):Promise<Record<string,unknown>>{
  const response=await fetch(path,{method,cache:'no-store',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new SetupRequestError(response.status===409?'Setup progress changed. Reload saved progress before continuing.':providerRecoveryMessage(data)??'Setup could not be saved. Try again.',response.status);
  return data;
}
export function OnboardingWizard({initialState,initialTimeZone,canvasConnection,submissionEnabled,distribution}:{initialState:OnboardingState;initialTimeZone:string;canvasConnection:SourceConnection|null;submissionEnabled:boolean;distribution:FirefoxDistribution}){
  const router=useRouter();
  const [state,setState]=useState(initialState),stateRef=useRef(initialState);
  const [timeZone,setTimeZone]=useState(initialState.drafts.timeZone??initialTimeZone);
  const [enabled,setEnabled]=useState(submissionEnabled),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState<DraftKind[]>([]);
  const inputs=useRef<Partial<Record<DraftKind,Record<string,string>>>>({});
  const metadataSequence=useRef(0),mutation=useRef(false),heading=useRef<HTMLHeadingElement>(null);
  const conflicted=useRef(false);
  const [selections,setSelections]=useState({gradescope:initialState.drafts.gradescopeCourseIds,ed:initialState.drafts.edCourseIds});
  const index=steps.indexOf(state.currentStep);
  async function refreshMetadata(){
    const sequence=++metadataSequence.current;
    const body=await request('/api/settings/onboarding/draft');
    if(sequence===metadataSequence.current&&Array.isArray(body.drafts))setSaved(body.drafts.flatMap(item=>item&&typeof item==='object'&&'kind' in item&&['canvas','ed','caldav'].includes(String(item.kind))?[item.kind as DraftKind]:[]));
  }
  useEffect(()=>{const sequence=metadataSequence;void refreshMetadata().catch(()=>setError('Saved input availability could not be loaded. Try again.'));return ()=>{sequence.current++;};},[]);
  useEffect(()=>{heading.current?.focus();},[state.currentStep]);
  async function patch(command:OnboardingCommand){
    if(conflicted.current)throw new Error('Setup progress changed. Reload saved progress before continuing.');
    try{
      const body=await request('/api/settings/onboarding','PATCH',{command,expectedRevision:stateRef.current.revision});
      const next=onboardingStateSchema.parse(body.state);stateRef.current=next;setState(next);return next;
    }catch(error){
      if(error instanceof SetupRequestError&&error.status===409)conflicted.current=true;
      // Read the winner but keep the visible edits and step until the user
      // chooses Reload. Never blindly replay a conflicting command.
      try{const body=await request('/api/settings/onboarding');stateRef.current=onboardingStateSchema.parse(body.state);}catch{}
      throw error;
    }
  }
  async function exclusive<T>(action:()=>Promise<T>):Promise<T>{
    if(mutation.current)throw new Error('Setup is still saving. Try again when it finishes.');mutation.current=true;setBusy(true);setError('');
    try{return await action();}catch(e){setError(e instanceof Error?e.message:'Setup could not be saved. Try again.');throw e;}finally{mutation.current=false;setBusy(false);}
  }
  async function run(action:()=>Promise<void>){
    try{await exclusive(action);}catch{/* The visible error retains the current step and edits. */}
  }
  async function progress(drafts?:{gradescopeCourseIds?:string[];edCourseIds?:string[]}){
    const snapshot={timeZone:validateTimeZone(timeZone),...(selections.gradescope?{gradescopeCourseIds:selections.gradescope}:{}),...(selections.ed?{edCourseIds:selections.ed}:{}),...drafts};
    if(Object.keys(snapshot).length)await patch({type:'save-draft',drafts:snapshot});
    await patch({type:'visit',step:state.currentStep});
  }
  async function save(input:SecretDraft){await request('/api/settings/onboarding/draft','PUT',input);await refreshMetadata();}
  async function saveFresh(){
    const canvas=inputs.current.canvas,ed=inputs.current.ed,caldav=inputs.current.caldav;
    if(canvas?.feedUrl)await save({kind:'canvas',feedUrl:canvas.feedUrl});
    if(ed?.token)await save({kind:'ed',token:ed.token});
    if(caldav?.username&&caldav.secret)await save({kind:'caldav',username:caldav.username,secret:caldav.secret});
  }
  const session:PrivateDraftSession={saved,read:(kind,field)=>inputs.current[kind]?.[field]??'',edit:(kind,field,value)=>{inputs.current[kind]={...inputs.current[kind],[field]:value};},save:input=>exclusive(()=>save(input)),
    courseIds:provider=>selections[provider],selectCourses:(provider,ids)=>{setSelections(current=>({...current,[provider]:ids}));},run:exclusive,
    discard:kind=>exclusive(async()=>{await request('/api/settings/onboarding/draft','DELETE',{kind});await refreshMetadata();}),progress:drafts=>exclusive(()=>progress(drafts)),
    use:(kind,action,input,connectionId)=>exclusive(async()=>{
      await progress();if(input)await save(input);
      const body=await request('/api/settings/onboarding/draft','POST',{kind,action,...(connectionId?{connectionId}:{})});
      if(action==='connect'){
        inputs.current[kind]={};
        // Atomic server cleanup is already conditional on the selected envelope.
        // Read metadata instead of deleting a possibly newer candidate.
        try{await refreshMetadata();}catch{setError('Connected, but saved input availability could not be refreshed. Reload saved progress.');}
        finally{router.refresh();}
      }
      return body;
    }),
  };
  async function advance(skip=false){
    if(state.currentStep==='timezone'){
      const zone=validateTimeZone(timeZone);await patch({type:'save-draft',drafts:{timeZone:zone}});await request('/api/settings/timezone','PUT',{timeZone:zone});
    }
    if(skip)await patch({type:'skip',step:state.currentStep as IntegrationStep});
    await progress();
    if(state.currentStep==='submission-status'&&!skip)await request('/api/settings/submission-status','PUT',{enabled});
    await patch({type:'visit',step:steps[index+1]});
  }
  async function reloadProgress(){
    const [body,timezone,preference]=await Promise.all([
      request('/api/settings/onboarding'),request('/api/settings/timezone'),request('/api/settings/submission-status'),
    ]);
    const latest=onboardingStateSchema.parse(body.state);
    if(typeof timezone.timeZone!=='string'||typeof preference.enabled!=='boolean')throw new Error('Saved setup preferences could not be loaded.');
    const restoredTimeZone=validateTimeZone(latest.drafts.timeZone??timezone.timeZone);
    await refreshMetadata();
    stateRef.current=latest;setState(latest);setTimeZone(restoredTimeZone);setEnabled(preference.enabled);
    setSelections({gradescope:latest.drafts.gradescopeCourseIds,ed:latest.drafts.edCourseIds});conflicted.current=false;
  }
  const errorPanel=error&&<Alert className="mt-4" role="alert">{error}<Button className="mt-2" variant="secondary" disabled={busy} onClick={()=>void run(reloadProgress)}>Reload saved progress</Button></Alert>;
  if(state.status==='completed')return <section><h1 className="text-2xl font-semibold">Setup complete</h1><a href="/upcoming" className="inline-flex min-h-11 items-center underline">Go to Upcoming</a></section>;
  if(state.status==='deferred')return <section><h1 className="text-2xl font-semibold">Setup saved for later</h1><p className="my-4">Resume where you left off. Every integration is optional.</p><Button disabled={busy} onClick={()=>void run(async()=>{await patch({type:'resume'});})}>Resume setup</Button>{errorPanel}</section>;
  return <PrivateDraftProvider value={session}><div className="max-w-3xl">
    <header className="mb-6"><p className="text-sm text-[var(--muted)]">Step {index+1} of 8 · Optional setup</p><h1 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight">Welcome to Kairos</h1><p className="mt-2 text-[var(--muted)]">Connect what you use, or skip every integration and start with Upcoming.</p></header>
    <ol aria-label="Setup steps" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted)]">{steps.map((step,i)=><li key={step} aria-current={state.currentStep===step?'step':undefined}>{i+1}. {titles[i]}</li>)}</ol>
    <fieldset disabled={busy} className="min-w-0">
      {state.currentStep==='timezone'&&<section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="mb-4 text-lg font-semibold">Timezone</h2><TimezoneControl value={timeZone} onChange={setTimeZone}/></section>}
      {state.currentStep==='firefox'&&<FirefoxSetupStep distribution={distribution}/>}
      {state.currentStep==='canvas'&&<CanvasSourceCard connection={canvasConnection} onConnected={async()=>{await progress();router.refresh();}}/>}
      {state.currentStep==='submission-status'&&<section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-semibold">Submission status</h2><p className="my-3 text-sm text-[var(--muted)]">Optionally refresh Canvas submission status through Firefox and an open signed-in Canvas tab.</p><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable browser submission refresh</label></section>}
      {state.currentStep==='gradescope'&&<GradescopeSourceCard/>}
      {state.currentStep==='ed'&&<EdSourceCard/>}
      {state.currentStep==='calendars'&&<CalendarDestinations beforeOAuth={async()=>{await saveFresh();await progress();}} returnTo="/onboarding"/>}
      {state.currentStep==='finish'&&<section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-semibold">Ready when you are</h2><p className="mt-2">Your working connections stay connected. You can manage sources and calendars later.</p></section>}
      <div className="mt-6 flex flex-wrap gap-3"><Button variant="secondary" disabled={index===0} onClick={()=>void run(async()=>{await patch({type:'visit',step:steps[index-1]});})}>Back</Button>
        {index===7?<Button onClick={()=>void run(async()=>{await patch({type:'finish'});navigateDocument('/upcoming');})}>Finish setup</Button>:<Button onClick={()=>void run(()=>advance())}>Continue</Button>}
        {index>0&&index<7&&<Button variant="secondary" onClick={()=>void run(()=>advance(true))}>Skip</Button>}
        <Button variant="secondary" onClick={()=>void run(async()=>{await saveFresh();await progress();if(state.currentStep==='submission-status')await request('/api/settings/submission-status','PUT',{enabled});await patch({type:'defer'});navigateDocument('/upcoming');})}>Save for later</Button>
      </div>
    </fieldset>
    {errorPanel}
  </div></PrivateDraftProvider>;
}
