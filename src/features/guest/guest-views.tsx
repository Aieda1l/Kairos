"use client";
import Link from "next/link";
import {AssignmentExplorer} from "@/features/assignments/assignment-explorer";
import {AssignmentTable} from "@/features/assignments/assignment-table";
import {AssignmentCalendar} from "@/features/assignments/assignment-calendar";
import {projectGuestAssignments} from "@/lib/guest/projection";
import {useGuest} from "./guest-provider";
import {GuestSources} from "./guest-sources";
import {GuestSyncControls} from "./guest-sync-controls";
import {GuestSettings} from "./guest-settings";

export function GuestViews({view}:{view:"upcoming"|"assignments"|"calendar"|"sources"|"settings"}) {
  const guest=useGuest();
  if(view==="settings")return <GuestSettings/>;
  if(guest.phase==="loading")return <p role="status" className="p-4 text-[var(--muted)]">Loading saved coursework from this browser…</p>;
  if(guest.phase==="error")return <div role="alert" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"><h1 className="text-xl font-semibold">Browser storage is unavailable</h1><p className="mt-2">Kairos could not read your saved coursework. Check that this browser allows site storage, then reload. No temporary unsaved workspace has been opened.</p><p className="mt-2 text-sm text-[var(--muted)]">If storage remains unreadable, open <Link href="/guest/settings" className="underline underline-offset-4">Guest settings for recovery</Link>. Browser site data removal clears local coursework and may also sign you out of your account.</p></div>;
  const {snapshot}=guest;
  const {timeZone,filters,sort}=snapshot.preferences;
  const assignments=projectGuestAssignments(snapshot);
  const changeFilters=(value:typeof filters)=>{void guest.savePreferences({filters:value});};
  return <div key={snapshot.datasetId} className="space-y-5">
    <div><h1 className="text-2xl font-semibold capitalize">{view}</h1><p className="mt-1 text-sm text-[var(--muted)]">Times shown in {timeZone}</p></div>
    {guest.actionError&&<p role="alert" className="rounded-xl border border-[var(--border)] p-4">{guest.actionError}</p>}
    {view==="upcoming"&&<AssignmentExplorer assignments={assignments} timeZone={timeZone} canvasConnected={snapshot.connections.some(c=>c.kind==="canvas"&&c.enabled)} syncControls={<GuestSyncControls/>} sourcesHref="/guest/sources" filters={filters} onFiltersChange={changeFilters}/>}
    {view==="assignments"&&<><GuestSyncControls/><AssignmentTable assignments={assignments} timeZone={timeZone} filters={filters} onFiltersChange={changeFilters} sort={sort} onSortChange={value=>{void guest.savePreferences({sort:value});}}/></>}
    {view==="calendar"&&<AssignmentCalendar assignments={assignments} timeZone={timeZone}/>}
    {view==="sources"&&<GuestSources/>}
  </div>;
}
