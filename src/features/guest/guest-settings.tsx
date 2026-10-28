"use client";
import Link from "next/link";
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {ThemeToggle} from "@/components/theme-toggle";
import {TimezoneControl} from "@/features/settings/timezone-control";
import {validateTimeZone} from "@/lib/dates/validate-timezone";
import {useGuest} from "./guest-provider";
import {GuestBackupControls} from "./guest-backup-controls";

function TimezoneSettings({initial}:{initial:string}){
  const guest=useGuest(),[draft,setDraft]=useState({base:initial,value:initial}),[saving,setSaving]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const zone=draft.base===initial?draft.value:initial;
  let valid=true;try{validateTimeZone(zone);}catch{valid=false;}
  return <form className="space-y-3" onSubmit={event=>{event.preventDefault();if(!valid||saving)return;setSaving(true);setMessage("");setError("");void guest.savePreferences({timeZone:zone}).then(saved=>{setSaving(false);if(saved)setMessage("Timezone saved in this browser.");else setError("Timezone could not be saved. Check browser storage and try again.");});}}>
    <TimezoneControl value={zone} onChange={value=>{setDraft({base:initial,value});setMessage("");}} disabled={saving}/>
    <Button type="submit" disabled={!valid||saving}>Save timezone</Button>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </form>;
}
export function GuestSettings(){
  const guest=useGuest();
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Settings</h1>
    {guest.phase==="ready"&&<section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"><h2 className="text-lg font-semibold">Display preferences</h2><p className="text-sm text-[var(--muted)]">Timezone, filters and source preferences belong to this guest workspace. Theme is shared across this browser.</p><ThemeToggle/><TimezoneSettings key={guest.snapshot.datasetId} initial={guest.snapshot.preferences.timeZone}/></section>}
    <GuestBackupControls/>
    <p><Link href="/guest/sources" className="inline-flex min-h-11 items-center underline underline-offset-4">Manage guest sources and credentials</Link></p>
    <nav aria-label="Guest help" className="flex flex-wrap gap-4">{["Privacy","Terms","Support"].map(name=><Link key={name} href={`/${name.toLowerCase()}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{name}</Link>)}</nav>
  </div>;
}
