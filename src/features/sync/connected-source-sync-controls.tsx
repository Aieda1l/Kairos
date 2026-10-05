"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useSubmissionStatusSync } from "@/features/submission-status/submission-status-provider";
import { useGradescope } from "@/features/gradescope/gradescope-provider";
import { useEd } from "@/features/ed/ed-provider";

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
    submission.phase==="syncing"||
    gradescope.phase==="syncing"||
    ed.phase==="syncing";

  if(!hasAnySource)return null;

  const warnings=[
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

  async function syncAll(){
    if(running||sourceBusy)return;
    setRunning(true);
    setCanvasError("");

    try{
      if(canvasConnected){
        try{
          const response=await fetch("/api/sources/canvas/sync",{method:"POST"});
          if(!response.ok){
            setCanvasError(await responseMessage(response,"Canvas deadline sync failed."));
          }
        }catch{
          setCanvasError("Canvas deadline sync failed.");
        }

        await submission.syncNow();
      }

      if(gradescopeEligible)await gradescope.syncNow();
      if(edEligible)await ed.syncNow();

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
    {warnings.length>0&&(
      <Alert className="basis-full">
        {warnings.join(" · ")}
      </Alert>
    )}
  </div>;
}
