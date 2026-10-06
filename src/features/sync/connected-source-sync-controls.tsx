"use client";

import {useState} from "react";
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
    const body=await response.json() as {message?:unknown};
    return typeof body.message==="string"&&body.message.trim()?body.message:fallback;
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

  const gradescopeEligible=Boolean(
    gradescope.connection&&gradescope.courses.some(course=>course.enabled),
  );
  const edEligible=Boolean(
    ed.connection&&ed.courses.some(course=>course.enabled),
  );
  const hasAnySource=canvasConnected||Boolean(gradescope.connection)||Boolean(ed.connection);
  const sourceBusy=
    (canvasConnected&&submission.phase==="syncing")||
    (Boolean(gradescope.connection)&&gradescope.phase==="syncing")||
    (Boolean(ed.connection)&&ed.phase==="syncing");

  if(!hasAnySource)return null;

  const sourceWarnings=[
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

  async function syncAll(){
    if(running||sourceBusy)return;
    setRunning(true);
    setCanvasError("");

    try{
      if(canvasConnected){
        try{
          const response=await fetch("/api/sources/canvas/sync",{
            method:"POST",
            headers:{"x-kairos-calendar-sync":"defer"},
          });
          if(!response.ok){
            setCanvasError(await responseMessage(response,"Canvas deadline sync failed."));
          }
        }catch{
          setCanvasError("Canvas deadline sync failed.");
        }

        await submission.syncNow({deferCalendarSync:true});
      }

      if(gradescopeEligible){
        await gradescope.syncNow({deferCalendarSync:true});
      }
      if(edEligible){
        await ed.syncNow({deferCalendarSync:true});
      }

      await calendars.syncAll();
      router.refresh();
    }finally{
      setRunning(false);
    }
  }

  const syncing=running||sourceBusy;

  return <div className="flex flex-wrap items-start gap-3">
    <Button
      type="button"
      disabled={syncing}
      onClick={()=>void syncAll()}
    >
      <RefreshCw size={17} className={syncing?"animate-spin":""} aria-hidden="true"/>
      {syncing?"Syncing…":"Sync All"}
    </Button>
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
