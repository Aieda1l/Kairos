"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubmissionStatusSync } from "./submission-status-provider";

function formatUpdatedAt(value:string|null):string {
  return value?new Date(value).toLocaleString():"Never";
}

export function SubmissionStatusControl(){
  const sync=useSubmissionStatusSync();
  const syncing=sync.phase==="syncing";
  const notice=sync.message||(!sync.extensionDetected&&!syncing?"Firefox extension not detected":"");

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="min-w-0">
        <p className="text-sm text-[var(--muted)]">
          {sync.lastSuccessfulAt
            ? "Canvas submissions · Updated "+formatUpdatedAt(sync.lastSuccessfulAt)
            : "Canvas submissions · Never updated"}
        </p>
        {notice&&<p role="status" className="mt-1 text-sm">{notice}</p>}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={syncing}
        onClick={()=>void sync.syncNow()}
      >
        <RefreshCw size={17} aria-hidden="true"/>
        {syncing?"Syncing submission status…":"Sync submission status"}
      </Button>
    </div>
  );
}
