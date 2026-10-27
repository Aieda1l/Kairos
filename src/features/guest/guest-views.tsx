"use client";
import Link from "next/link";
import {AssignmentExplorer} from "@/features/assignments/assignment-explorer";
import {AssignmentTable} from "@/features/assignments/assignment-table";
import {AssignmentCalendar} from "@/features/assignments/assignment-calendar";
import {projectGuestAssignments} from "@/lib/guest/projection";
import {useGuest} from "./guest-provider";
import {GuestSources} from "./guest-sources";
import {GuestSyncControls} from "./guest-sync-controls";

export function GuestViews({view}:{view:"upcoming"|"assignments"|"calendar"|"sources"|"settings"}) {
  const guest=useGuest();
  if(guest.phase==="loading")return <p role="status" className="p-4 text-[var(--muted)]">Loading saved coursework from this browser…</p>;
  if(guest.phase==="error")return <div role="alert" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"><h1 className="text-xl font-semibold">Browser storage is unavailable</h1><p className="mt-2">Kairos could not read your saved coursework. Check that this browser allows site storage, then reload. No temporary unsaved workspace has been opened.</p><p className="mt-2 text-sm text-[var(--muted)]">If storage remains unreadable, use your browser’s site data settings to recover or clear Kairos data. Clearing site data removes local coursework.</p></div>;
  const {snapshot}=guest;
  const {timeZone,filters,sort}=snapshot.preferences;
  const assignments=projectGuestAssignments(snapshot);
  const changeFilters=(value:typeof filters)=>{void guest.savePreferences({filters:value});};
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold capitalize">{view}</h1><p className="mt-1 text-sm text-[var(--muted)]">Times shown in {timeZone}</p></div>
    {guest.actionError&&<p role="alert" className="rounded-xl border border-[var(--border)] p-4">{guest.actionError}</p>}
    {view==="upcoming"&&<AssignmentExplorer assignments={assignments} timeZone={timeZone} canvasConnected={snapshot.connections.some(c=>c.kind==="canvas"&&c.enabled)} syncControls={<GuestSyncControls/>} sourcesHref="/guest/sources" filters={filters} onFiltersChange={changeFilters}/>}
    {view==="assignments"&&<><GuestSyncControls/><AssignmentTable assignments={assignments} timeZone={timeZone} filters={filters} onFiltersChange={changeFilters} sort={sort} onSortChange={value=>{void guest.savePreferences({sort:value});}}/></>}
    {view==="calendar"&&<AssignmentCalendar assignments={assignments} timeZone={timeZone}/>}
    {view==="sources"&&<GuestSources/>}
    {view==="settings"&&<section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"><h2 className="font-semibold">Device settings are coming in the next guest release</h2><p className="mt-2 text-[var(--muted)]">Your assignment filters and sort order are saved locally. Timezone, backup, recovery, and source settings controls are not available here yet. Browser site data removal deletes this local workspace.</p><Link href="/guest/sources" className="mt-4 inline-flex min-h-11 items-center underline underline-offset-4">Guest sources</Link></section>}
  </div>;
}
