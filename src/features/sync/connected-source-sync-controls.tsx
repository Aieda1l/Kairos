"use client";
import {getRecoveryNotice,readRecoveryBody,recoveryFromResponse,type RecoveryNotice} from "@/lib/recovery/presentation";
import {syncAllAdmissionSchema,type SyncAllAdmission,type SyncAllStep} from "@/lib/sync-all/types";

import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Alert} from "@/components/ui/alert";
import {useSubmissionStatusSync} from "@/features/submission-status/submission-status-provider";
import {useGradescope} from "@/features/gradescope/gradescope-provider";
import {useEd} from "@/features/ed/ed-provider";
import {useCalendarSync} from "@/features/calendars/calendar-provider";

async function responseMessage(response:Response,fallback:string):Promise<string>{
  try{
    const body=await readRecoveryBody(response);
    return recoveryFromResponse(body,response)?.message??fallback;
  }catch{
    return fallback;
  }
}

export function ConnectedSourceSyncControls({
  canvasConnected,
}:{canvasConnected:boolean}){
  const router=useRouter();
  const submission=useSubmissionStatusSync();
  const gradescope=useGradescope();
  const ed=useEd();
  const calendars=useCalendarSync();
  const [running,setRunning]=useState(false);
  const [canvasError,setCanvasError]=useState("");
  const [stepErrors,setStepErrors]=useState<Partial<Record<SyncAllStep,string>>>({});
  const [admissionError,setAdmissionError]=useState<RecoveryNotice|null>(null);
  const retryUntil=useRef(0);
  const [retryWaiting,setRetryWaiting]=useState(false);
  function admissionFailure(notice:RecoveryNotice|null){
    retryUntil.current=notice?.retryAfterSeconds?Date.now()+notice.retryAfterSeconds*1000:0;
    setRetryWaiting(Boolean(notice?.retryAfterSeconds));
    setAdmissionError(notice);
  }
  async function runStep(step:SyncAllStep,work:()=>Promise<void>){
    try{await work();}catch{
      const message=getRecoveryNotice('SERVICE_UNAVAILABLE')?.message??'Synchronization could not be completed. Retry later.';
      setStepErrors(previous=>({...previous,[step]:message}));
    }
  }
  useEffect(()=>{
    if(!admissionError?.retryAfterSeconds)return;
    const timer=window.setTimeout(()=>setRetryWaiting(false),admissionError.retryAfterSeconds*1000);
    return ()=>window.clearTimeout(timer);
  },[admissionError]);

  const hasAnySource=canvasConnected||Boolean(gradescope.connection)||Boolean(ed.connection);
  const sourceBusy=
    (canvasConnected&&submission.phase==="syncing")||
    (Boolean(gradescope.connection)&&gradescope.phase==="syncing")||
    (Boolean(ed.connection)&&ed.phase==="syncing");

  if(!hasAnySource)return null;

  const sourceWarnings=[
    ...Object.entries(stepErrors).filter(([step])=>step!=='calendars').map(([step,message])=>{
      const labels:Record<string,string>={'canvas-deadlines':'Canvas deadlines','canvas-submissions':'Canvas submissions',gradescope:'Gradescope',ed:'Ed'};
      return `${labels[step]}: ${message}`;
    }),
    canvasError&&"Canvas deadlines: "+canvasError,
    canvasConnected&&["error","partial"].includes(submission.phase)&&submission.message
      ?"Canvas submissions: "+submission.message
      :"",
    gradescope.connection&&["error","partial"].includes(gradescope.phase)&&gradescope.message
      ?"Gradescope: "+gradescope.message
      :"",
    ed.connection&&["error","partial"].includes(ed.phase)&&ed.message
      ?"Ed: "+ed.message
      :"",
  ].filter(Boolean) as string[];

  const calendarWarnings=calendars.connections.flatMap(connection=>{
    const phase=calendars.phaseFor(connection.id);
    const message=calendars.messageFor(connection.id);
    return phase==="error"&&message
      ?["Calendar destinations: "+message]
      :[];
  });
  if(stepErrors.calendars)calendarWarnings.push('Calendar destinations: '+stepErrors.calendars);

  async function syncAll(){
    if(running||sourceBusy||Date.now()<retryUntil.current)return;
    setRunning(true);
    setCanvasError("");
    setStepErrors({});
    const releaseCalendarHold=calendars.holdAutomaticSync?.();

    try{
      let admitted:SyncAllAdmission;
      try{
      const response=await fetch('/api/sync-all/start',{method:'POST'});
      const body=await readRecoveryBody(response);
      if(!response.ok){
        const notice=recoveryFromResponse(body,response,'sync-all')??getRecoveryNotice('SERVICE_UNAVAILABLE',{key:'sync-all'});
        admissionFailure(notice);
        return;
      }
      const admission=syncAllAdmissionSchema.safeParse(body);
      if(!admission.success||Date.parse(admission.data.expiresAt)<=Date.now()){
        admissionFailure(getRecoveryNotice('INVALID_RESULT',{key:'sync-all'}));return;
      }
      admissionFailure(null);
      admitted=admission.data;
      }catch{
        admissionFailure(getRecoveryNotice('SERVICE_UNAVAILABLE',{key:'sync-all'}));return;
      }
      const {runId,steps}=admitted;
      const options={deferCalendarSync:true,syncAllRunId:runId};
      if(steps.includes('canvas-deadlines')){
        try{
          const response=await fetch("/api/sources/canvas/sync",{
            method:"POST",
            headers:{"x-kairos-calendar-sync":"defer","x-kairos-sync-all-run":runId},
          });
          if(!response.ok){
            setCanvasError(await responseMessage(response,"Canvas deadline sync failed."));
          }
        }catch{
          setCanvasError("Canvas deadline sync failed.");
        }

      }
      if(steps.includes('canvas-submissions'))await runStep('canvas-submissions',()=>submission.syncNow(options));
      if(steps.includes('gradescope')){
        await runStep('gradescope',()=>gradescope.syncNow(options));
      }
      if(steps.includes('ed')){
        await runStep('ed',()=>ed.syncNow(options));
      }

      if(steps.includes('calendars'))await runStep('calendars',()=>calendars.syncAll(runId));
      router.refresh();
    }finally{
      releaseCalendarHold?.();
      setRunning(false);
    }
  }

  const syncing=running||sourceBusy;

  return <div className="flex flex-wrap items-start gap-3">
    <Button
      type="button"
      disabled={syncing||retryWaiting}
      onClick={()=>void syncAll()}
    >
      <RefreshCw size={17} className={syncing?"animate-spin":""} aria-hidden="true"/>
      {syncing?"Syncing…":"Sync All"}
    </Button>
    {admissionError&&<Alert className="basis-full">{admissionError.message}</Alert>}
    {sourceWarnings.length>0&&(
      <Alert className="basis-full">
        {sourceWarnings.join(" · ")}
      </Alert>
    )}
    {calendarWarnings.length>0&&(
      <Alert className="basis-full">
        {calendarWarnings.join(" · ")}
      </Alert>
    )}
  </div>;
}
