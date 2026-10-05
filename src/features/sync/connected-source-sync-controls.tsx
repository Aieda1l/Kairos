"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SubmissionStatusControl } from "@/features/submission-status/submission-status-control";
import { useGradescope } from "@/features/gradescope/gradescope-provider";
import { useEd } from "@/features/ed/ed-provider";
import { SyncButton } from "@/features/sync/sync-button";

function formatUpdatedAt(value:string|null):string{
  return value?new Date(value).toLocaleString():"Never";
}

function SourceSyncCard({
  label,
  lastSuccessfulAt,
  message,
  syncing,
  disabled,
  buttonLabel,
  onSync,
}:{
  label:string;
  lastSuccessfulAt:string|null;
  message:string;
  syncing:boolean;
  disabled:boolean;
  buttonLabel:string;
  onSync:()=>Promise<void>;
}){
  return <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="min-w-0">
      <p className="text-sm text-[var(--muted)]">
        {label} · {lastSuccessfulAt?"Updated "+formatUpdatedAt(lastSuccessfulAt):"Never updated"}
      </p>
      {message&&<p role="status" className="mt-1 text-sm">{message}</p>}
    </div>
    <Button
      type="button"
      variant="secondary"
      disabled={disabled||syncing}
      onClick={()=>void onSync()}
    >
      <RefreshCw size={17} className={syncing?"animate-spin":""} aria-hidden="true"/>
      {syncing?"Syncing…":buttonLabel}
    </Button>
  </div>;
}

export function ConnectedSourceSyncControls({
  canvasConnected,
  canvasLastSyncCompletedAt,
}:{
  canvasConnected:boolean;
  canvasLastSyncCompletedAt:string|null;
}){
  const router=useRouter();
  const gradescope=useGradescope();
  const ed=useEd();
  const [canvasMessage,setCanvasMessage]=useState("");
  const gradescopeHasEnabledCourse=gradescope.courses.some(course=>course.enabled);
  const edHasEnabledCourse=ed.courses.some(course=>course.enabled);

  const hasAnySource=canvasConnected||Boolean(gradescope.connection)||Boolean(ed.connection);
  if(!hasAnySource)return null;

  return <div className="grid gap-3 lg:grid-cols-2">
    {canvasConnected&&<>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm text-[var(--muted)]">
          {canvasLastSyncCompletedAt
            ?"Canvas deadlines · Synced "+new Date(canvasLastSyncCompletedAt).toLocaleString()
            :"Canvas deadlines · Not synced yet"}
        </p>
        <SyncButton
          onComplete={()=>{setCanvasMessage("Canvas sync complete.");router.refresh();}}
          onError={setCanvasMessage}
        />
        {canvasMessage&&<Alert className="basis-full">{canvasMessage}</Alert>}
      </div>
      <SubmissionStatusControl/>
    </>}

    {gradescope.connection&&<SourceSyncCard
      label="Gradescope"
      lastSuccessfulAt={gradescope.lastSuccessfulAt}
      message={gradescope.message}
      syncing={gradescope.phase==="syncing"}
      disabled={!gradescopeHasEnabledCourse}
      buttonLabel={gradescopeHasEnabledCourse?"Sync Gradescope":"Select a course first"}
      onSync={gradescope.syncNow}
    />}

    {ed.connection&&<SourceSyncCard
      label="Ed"
      lastSuccessfulAt={ed.lastSuccessfulAt}
      message={ed.message}
      syncing={ed.phase==="syncing"}
      disabled={!edHasEnabledCourse}
      buttonLabel={edHasEnabledCourse?"Sync Ed":"Select a course first"}
      onSync={ed.syncNow}
    />}
  </div>;
}
