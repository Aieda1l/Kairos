"use client";
import { useEffect,useRef, useState } from "react";
import {useRouter} from 'next/navigation';
import { Button } from "@/components/ui/button";
import {TimezoneControl} from '@/features/settings/timezone-control';
import { Alert } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSubmissionStatusSync } from "@/features/submission-status/submission-status-provider";
import {useCalendarSync} from '@/features/calendars/calendar-provider';
import {useEd} from '@/features/ed/ed-provider';
import {useGradescope} from '@/features/gradescope/gradescope-provider';
import {SignOutControl} from '@/features/account/sign-out-control';
import {getRecoveryNotice,recoveryFromResponse,readRecoveryBody,type RecoveryNotice} from '@/lib/recovery/presentation';
import {RecoveryPrompts} from '@/features/recovery/recovery-prompts';
import type {AccountSummary} from '@/lib/account/account-summary';
import type {SourceConnection} from '@/lib/assignments/types';
import {DeleteAccountControl} from "@/features/account/delete-account-control";


function DiagnosticRow({label,value}:{label:string;value:string}){
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
type SettingsAction={type:'load'|'timezone'|'preference';enabled?:boolean};

export function SettingsContent({account={name:null,email:null,identityProvider:"unknown"},canvasConnection=null}:{account?:AccountSummary;canvasConnection?:SourceConnection|null}){
  const submissionSync=useSubmissionStatusSync();
  const router=useRouter();
  const calendars=useCalendarSync(),ed=useEd(),gradescope=useGradescope();
  const [enabled,setEnabled]=useState(submissionSync.automaticEnabled);
  const [preferenceSaving,setPreferenceSaving]=useState(false);
  const [recovery,setRecovery]=useState<RecoveryNotice|null>(null);
  const retryBlocked=useRef<Record<string,boolean>>({});
  const retryTimers=useRef<Record<string,number>>({});
  const retryAction=useRef<SettingsAction>({type:'load'});
  const retryLoad=useRef<()=>Promise<void>>(async()=>{});
  const sources=[canvasConnection,ed.connection,gradescope.connection].filter((source):source is SourceConnection=>Boolean(source));
  const browserRelevant=(submissionSync.enabled&&enabled)||(gradescope.connection?.enabled&&gradescope.courses.some(course=>course.enabled));
  function sourceRecovery(source:SourceConnection){
    if(source.kind==='gradescope'){
      // Provider recovery is fresh feedback. Persisted browser errors need an enabled feature.
      return gradescope.recovery??(source.enabled&&gradescope.courses.some(course=>course.enabled)?getRecoveryNotice(source.lastErrorCode,{key:'settings-source-gradescope'}):null);
    }
    const code=source.lastErrorCode;
    const browserError=code?.startsWith('EXTENSION_')||code?.startsWith('CANVAS_')||code==='UNRECOGNIZED_STATUS';
    if(source.kind==='canvas'&&browserError&&!(source.enabled&&submissionSync.enabled&&enabled))return null;
    return getRecoveryNotice(code,{key:'settings-source-'+source.kind});
  }
  function failed(body:unknown,response:Response|undefined,action:SettingsAction){
    retryAction.current=action;
    const notice=recoveryFromResponse(body,response,'settings-'+action.type);
    setRecovery(notice);
    if(notice?.retryAfterSeconds){
      const type=action.type;
      window.clearTimeout(retryTimers.current[type]);retryBlocked.current[type]=true;
      retryTimers.current[type]=window.setTimeout(()=>{retryBlocked.current[type]=false;},notice.retryAfterSeconds*1000);
    }
    setMessage(notice?.message??'Settings could not be saved. Try again.');
  }
  async function savePreference(next:boolean){
    if(preferenceSaving||retryBlocked.current.preference)return;
    setPreferenceSaving(true);setMessage('');setRecovery(null);
    try{
      const response=await fetch('/api/settings/submission-status',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:next})});
      const body=await readRecoveryBody(response);
      if(!response.ok||typeof body.enabled!=='boolean'){failed(body,response,{type:'preference',enabled:next});return;}
      setEnabled(body.enabled);
      router.refresh();
      setMessage('Submission refresh preference saved.');
    }catch{failed({code:'SERVICE_UNAVAILABLE'},undefined,{type:'preference',enabled:next});}
    finally{setPreferenceSaving(false);}
  }
  const [timeZone,setTimeZone]=useState("America/Los_Angeles");
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    let mounted=true;
    async function load(){
      if(retryBlocked.current.load)return;
      try{
        const response=await fetch('/api/settings/timezone',{cache:'no-store'});const body=await readRecoveryBody(response);
        if(!mounted)return;
        if(!response.ok){failed(body,response,{type:'load'});return;}
        if(typeof body.timeZone==='string'){
          setTimeZone(body.timeZone);
          // A concurrent successful read cannot dismiss an unrelated write failure.
          setRecovery(current=>current?.key==='settings-load'?null:current);
        }
      }catch{if(mounted)failed({code:'SERVICE_UNAVAILABLE'},undefined,{type:'load'});}
    }
    retryLoad.current=load;
    void load();
    const timers=retryTimers.current;
    return ()=>{mounted=false;Object.values(timers).forEach(window.clearTimeout);};
  },[]);

  async function save(){
    if(retryBlocked.current.timezone)return;
    setSaving(true);setMessage('');setRecovery(null);
    try{
      const response=await fetch('/api/settings/timezone',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({timeZone})});
      const body=await readRecoveryBody(response);
      if(response.ok&&typeof body.timeZone==='string'){setTimeZone(body.timeZone);setMessage('Timezone saved: '+body.timeZone);}
      else failed(body,response,{type:'timezone'});
    }catch{failed({code:'SERVICE_UNAVAILABLE'},undefined,{type:'timezone'});}
    finally{setSaving(false);}
  }
  async function retrySettings(){
    const action=retryAction.current;
    if(action.type==='load')await retryLoad.current();
    else if(action.type==='preference')await savePreference(Boolean(action.enabled));
    else await save();
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <p className="text-sm text-[var(--muted)]">Preferences</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>
      <div className="space-y-5">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="mb-4 font-medium">Account</h2>
          <dl><DiagnosticRow label="Name" value={account.name??'Not provided'}/><DiagnosticRow label="Email" value={account.email??'Not provided'}/><DiagnosticRow label="Identity provider" value={account.identityProvider==='google'?'Google':account.identityProvider==='microsoft'?'Microsoft':'Unknown'}/></dl>
          <p className="my-4 text-sm text-[var(--muted)]">Calendar permissions are connected separately from your Kairos identity.</p>
          <SignOutControl/>
        </section>
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="mb-4 font-medium">Connections</h2>
          <dl><DiagnosticRow label="Sources" value={sources.length?sources.map(source=>source.kind==='canvas'?'Canvas':source.kind==='ed'?'Ed':'Gradescope').join(', '):'None connected'}/><DiagnosticRow label="Calendar destinations" value={calendars.connections.length?calendars.connections.map(connection=>connection.provider==='google'?'Google Calendar':connection.provider==='microsoft'?'Microsoft Calendar':'Apple iCloud Calendar').join(', '):'None connected'}/></dl>
          <p className="mt-3 text-sm text-[var(--muted)]">Review sources to retry a temporary failure, renew expired consent, or choose recovery for a missing calendar.</p>
          <a href="/sources" className="inline-flex min-h-11 items-center text-sm underline">Manage sources and calendars</a>
          <RecoveryPrompts notices={[
            ...sources.flatMap(source=>{const notice=sourceRecovery(source);return notice?[{...notice,href:notice.href??'/sources'}]:[];}),
            ...(!gradescope.connection&&gradescope.recovery?[{...gradescope.recovery,href:gradescope.recovery.href??'/sources'}]:[]),
            ...calendars.connections.flatMap(connection=>{const notice=calendars.recoveryFor(connection.id);return notice?[{...notice,href:notice.href??'/sources'}]:[];}),
          ]}/>
        </section>
        <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div>
            <h2 className="font-medium">Appearance</h2>
            <p className="mb-2 text-sm text-[var(--muted)]">Choose the theme that is easiest to read.</p>
            <ThemeToggle/>
          </div>
          <div>
            <div className="flex flex-wrap gap-2">
              <TimezoneControl value={timeZone} onChange={setTimeZone} disabled={saving}/>
              <Button onClick={save} disabled={saving}>{saving?"Saving…":"Save timezone"}</Button>
            </div>
          </div>
          {message&&!recovery&&<Alert role="status">{message}</Alert>}
          {recovery&&<RecoveryPrompts notices={[recovery]} onRetry={retrySettings}/>}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="mb-4">
            <h2 className="font-medium">Submission status</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Firefox reads status from an open signed-in Canvas tab; Kairos never stores your Canvas session.</p>
          </div>
          <dl>
            <DiagnosticRow label="Automatic refresh" value={enabled===false?'Off':'On'}/>
            <DiagnosticRow label="Refresh when older than" value="15 minutes"/>
            <DiagnosticRow
              label="Last successful refresh"
              value={submissionSync.lastSuccessfulAt?new Date(submissionSync.lastSuccessfulAt).toLocaleString():"Never"}
            />
            <DiagnosticRow
              label="Firefox extension"
              value={submissionSync.extensionDetected||gradescope.extensionDetected?"Connected":browserRelevant?"Not detected":"Not needed for current features"}
            />
          </dl>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={enabled} disabled={preferenceSaving} onChange={event=>void savePreference(event.target.checked)}/>Enable browser submission refresh</label>
          <p className="mt-3 text-sm text-[var(--muted)]">The public Firefox add-on listing is pending review. Check the extension popup locally for version details.</p>
        </section>

        <DeleteAccountControl/>
      </div>
    </div>
  );
}
