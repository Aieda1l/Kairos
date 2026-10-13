'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {getRecoveryNotice,type RecoveryNotice} from '@/lib/recovery/presentation';
import {useCalendarSync} from '@/features/calendars/calendar-provider';
import {useEd} from '@/features/ed/ed-provider';
import {useGradescope} from '@/features/gradescope/gradescope-provider';
import {useSubmissionStatusSync} from '@/features/submission-status/submission-status-provider';

function Notice({notice,onRetry}:{notice:RecoveryNotice;onRetry?:(key:string)=>void|Promise<void>}){
  const [dismissed,setDismissed]=useState(false);
  const [waiting,setWaiting]=useState(Boolean(notice.retryAfterSeconds));
  useEffect(()=>{
    if(!notice.retryAfterSeconds)return;
    const timer=window.setTimeout(()=>setWaiting(false),notice.retryAfterSeconds*1000);
    return ()=>window.clearTimeout(timer);
  },[notice.retryAfterSeconds]);
  if(dismissed)return null;
  const labels:Record<RecoveryNotice['action'],string>={connect:'Connect','verify-extension':'Verify extension','sign-in-and-retry':'Sign in and retry',retry:'Retry',reconnect:'Reconnect',recreate:'Review recreation'};
  const label=notice.key==='resume'?'Resume setup':notice.href==='/support'?'Recovery and support':labels[notice.action];
  return <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
    <p className="min-w-0 flex-1">{notice.message}</p>
    {notice.href?<a className="inline-flex min-h-11 items-center underline underline-offset-4" href={notice.href}>{label}</a>:onRetry&&<Button variant="secondary" disabled={waiting} onClick={()=>void onRetry(notice.key)}>{label}</Button>}
    <Button variant="ghost" aria-label="Dismiss guidance" onClick={()=>setDismissed(true)}>Dismiss</Button>
  </div>;
}
export function RecoveryPrompts({notices,onRetry}:{notices:RecoveryNotice[];onRetry?:(key:string)=>void|Promise<void>}){
  return <div className="space-y-2">{notices.map(notice=><Notice key={notice.key+notice.message} notice={notice} onRetry={onRetry}/>)}</div>;
}
type SourceHealth={kind:'canvas'|'ed'|'gradescope';enabled:boolean;lastSyncCompletedAt:string|null;lastErrorCode:string|null};
export function ReturningRecoveryPrompts({initialSources,onboarding}:{initialSources:SourceHealth[];onboarding:{status:'active'|'deferred'|'completed';revision:number}}){
  const ed=useEd(),gradescope=useGradescope(),submission=useSubmissionStatusSync(),calendars=useCalendarSync();
  const sources=[...initialSources.filter(source=>source.kind==='canvas'),...[ed.connection,gradescope.connection].flatMap(source=>source?[source]:[])];
  const canvasBrowserEnabled=submission.enabled&&submission.automaticEnabled;
  const gradescopeBrowserEnabled=gradescope.connection?.enabled&&gradescope.courses.some(course=>course.enabled);
  const notices:RecoveryNotice[]=[];
  if(onboarding.status==='deferred')notices.push({key:'resume',message:'Your optional setup is saved for later. Resume when ready.',action:'connect',href:'/onboarding'});
  else if(!sources.some(source=>source.enabled))notices.push({key:'no-source',message:'No source is connected. Connect an optional source when ready; you can keep using Kairos.',action:'connect',href:'/sources'});
  for(const source of sources.filter(source=>source.enabled)){
    const current=source.kind==='ed'?ed:source.kind==='gradescope'?gradescope:submission;
    const code=current.lastErrorCode??source.lastErrorCode;
    const browserRelevant=source.kind==='canvas'?canvasBrowserEnabled:source.kind==='gradescope'?gradescopeBrowserEnabled:false;
    const browserCode=typeof code==='string'&&(code.startsWith('EXTENSION_')||code.startsWith('CANVAS_'));
    const candidate=current.recovery??getRecoveryNotice(code,{key:'source-'+source.kind});
    const notice=!browserRelevant&&(browserCode||candidate?.action==='verify-extension')?null:candidate;
    if(notice)notices.push({...notice,href:notice.href??'/sources'});
    else if(!source.lastSyncCompletedAt&&!current.lastSuccessfulAt)notices.push({key:'first-sync-'+source.kind,message:`${source.kind==='canvas'?'Canvas':source.kind==='ed'?'Ed':'Gradescope'} has no successful sync yet. Review the connection and try a sync when ready.`,action:'retry',href:'/sources'});
  }
  for(const calendar of calendars.connections.filter(connection=>connection.enabled)){
    const notice=calendars.recoveryFor(calendar.id)??getRecoveryNotice(calendar.lastErrorCode,{key:'calendar-'+calendar.provider});
    if(notice)notices.push({...notice,href:notice.href??'/sources'});
    else if(!calendar.lastSyncCompletedAt)notices.push({key:'first-calendar-sync-'+calendar.provider,message:'Your calendar destination has no successful sync yet. Review it when ready.',action:'retry',href:'/sources'});
  }
  const browserEnabled=canvasBrowserEnabled||gradescopeBrowserEnabled;
  const checked=submission.extensionChecked||gradescope.extensionChecked;
  if(browserEnabled&&checked&&!submission.extensionDetected&&!gradescope.extensionDetected){
    if(!notices.some(notice=>notice.action==='verify-extension'))notices.push(getRecoveryNotice('EXTENSION_UNAVAILABLE')!);
  }
  return <RecoveryPrompts notices={notices}/>;
}
