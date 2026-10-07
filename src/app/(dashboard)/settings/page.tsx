"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSubmissionStatusSync } from "@/features/submission-status/submission-status-provider";
import {DeleteAccountControl} from "@/features/account/delete-account-control";

const zones=["America/Los_Angeles","America/Denver","America/Chicago","America/New_York","UTC"];

function DiagnosticRow({label,value}:{label:string;value:string}){
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function SettingsPage(){
  const submissionSync=useSubmissionStatusSync();
  const [timeZone,setTimeZone]=useState("America/Los_Angeles");
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    fetch("/api/settings/timezone")
      .then(r=>r.json())
      .then(d=>d.timeZone&&setTimeZone(d.timeZone))
      .catch(()=>setMessage("Timezone settings could not be loaded."));
  },[]);

  async function save(){
    setSaving(true);
    setMessage("");
    try{
      const r=await fetch("/api/settings/timezone",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({timeZone}),
      });
      const d=await r.json();
      setMessage(r.ok?"Timezone saved: "+d.timeZone:d.message??"Timezone could not be saved.");
    }finally{
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <p className="text-sm text-[var(--muted)]">Preferences</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>
      <div className="space-y-5">
        <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div>
            <h2 className="font-medium">Appearance</h2>
            <p className="mb-2 text-sm text-[var(--muted)]">Choose the theme that is easiest to read.</p>
            <ThemeToggle/>
          </div>
          <div>
            <Label htmlFor="timezone">Display timezone</Label>
            <div className="flex flex-wrap gap-2">
              <Select id="timezone" value={timeZone} onChange={e=>setTimeZone(e.target.value)}>
                {zones.map(z=><option key={z}>{z}</option>)}
              </Select>
              <Button onClick={save} disabled={saving}>{saving?"Saving…":"Save timezone"}</Button>
            </div>
          </div>
          {message&&<Alert>{message}</Alert>}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="mb-4">
            <h2 className="font-medium">Submission status</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Firefox reads status from an open signed-in Canvas tab; Kairos never stores your Canvas session.</p>
          </div>
          <dl>
            <DiagnosticRow label="Automatic refresh" value="On"/>
            <DiagnosticRow label="Refresh when older than" value="15 minutes"/>
            <DiagnosticRow
              label="Last successful refresh"
              value={submissionSync.lastSuccessfulAt?new Date(submissionSync.lastSuccessfulAt).toLocaleString():"Never"}
            />
            <DiagnosticRow
              label="Firefox extension"
              value={submissionSync.extensionDetected?"Connected":"Not detected"}
            />
          </dl>
        </section>

        <DeleteAccountControl/>
      </div>
    </div>
  );
}
