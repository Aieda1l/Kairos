"use client";
import {useGuest} from "./guest-provider";
import {GuestSourceCards} from "./guest-source-cards";
import {GuestSyncControls} from "./guest-sync-controls";

export function GuestSources(){
  const guest=useGuest();
  return <div className="space-y-5">
    <p className="text-sm text-[var(--muted)]">Source credentials and responses temporarily pass through the server for Canvas feed and Ed reads. Coursework is saved in this browser; credentials stay in memory unless you choose device storage.</p>
    <GuestSyncControls/>
    {guest.phase==="ready"&&<div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-[var(--border)] p-4">{(["Canvas","Gradescope"] as const).map(name=>{
      const field=name==="Canvas"?"automaticCanvas":"automaticGradescope";
      return <label key={field} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={guest.snapshot.preferences[field]} onChange={event=>{void guest.savePreferences({[field]:event.target.checked});}}/>Check {name} automatically when opened (after 15 minutes)</label>;
    })}</div>}
    <GuestSourceCards/>
  </div>;
}
