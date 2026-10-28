"use client";
import {useEffect,useId,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {parseGuestBackup,serializeGuestBackup} from "@/lib/guest/backup";
import {GuestDataError,guestSafeMessage} from "@/lib/guest/errors";
import {GUEST_MAX_IMPORT_BYTES} from "@/lib/guest/limits";
import {createGuestTransientClient} from "@/lib/guest/sync/transient-client";
import type {GuestBackupV1} from "@/lib/guest/types";
import {useGuest,useGuestDatasetChange,useGuestStoreLifecycle} from "./guest-provider";

function endGuestSession(){
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),5000);
  void createGuestTransientClient().endSession(controller.signal).catch(()=>{}).finally(()=>window.clearTimeout(timer));
}
export function GuestBackupControls(){
  const guest=useGuest(),changeDataset=useGuestDatasetChange(),lifecycle=useGuestStoreLifecycle(),id=useId();
  const [preview,setPreview]=useState<{backup:GuestBackupV1;datasetId:string}|null>(null);
  const [clearId,setClearId]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const reading=useRef(0),mounted=useRef(true);
  const restoreFocus=useRef<"import"|"clear"|null>(null);
  const importRef=useRef<HTMLInputElement>(null),clearRef=useRef<HTMLButtonElement>(null),previewRef=useRef<HTMLDivElement>(null),clearPreviewRef=useRef<HTMLDivElement>(null);
  const datasetId=guest.phase==="ready"?guest.snapshot.datasetId:guest.phase==="error"?guest.identity?.datasetId:null;
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(preview)previewRef.current?.focus();},[preview]);
  useEffect(()=>{if(clearId)clearPreviewRef.current?.focus();},[clearId]);
  useEffect(()=>{if(!busy&&restoreFocus.current){(restoreFocus.current==="import"?importRef.current:clearRef.current)?.focus();restoreFocus.current=null;}},[busy]);
  async function importFile(file:File){
    const version=++reading.current,owner=lifecycle;
    setPreview(null);setClearId(null);setError(null);setMessage(null);
    if(!owner?.isActive())return;
    try{
      if(file.size>GUEST_MAX_IMPORT_BYTES){setError("Choose a guest backup no larger than 10 MiB.");return;}
      const backup=parseGuestBackup(await file.text());
      if(mounted.current&&version===reading.current&&owner.isActive())setPreview({backup,datasetId:owner.datasetId});
    }catch(e){if(mounted.current&&version===reading.current&&owner.isActive())setError(guestSafeMessage(e instanceof GuestDataError?e.code:"INVALID_BACKUP"));}
  }
  async function exportFile(){
    const owner=lifecycle;if(!owner?.isActive())return;setError(null);
    try{
      const saved=await owner.store.read();if(!owner.isActive()||saved.datasetId!==owner.datasetId)return;
      const url=URL.createObjectURL(new Blob([serializeGuestBackup(saved,new Date().toISOString())],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="kairos-guest-backup.json";document.body.append(link);
      try{link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),0);}
    }catch{if(mounted.current)setError("The backup could not be exported. Check browser storage and try again.");}
  }
  async function confirm(backup:GuestBackupV1|null,expectedId:string){
    if(busy)return;reading.current++;setBusy(true);setError(null);setMessage(null);
    const accepted=await changeDataset(backup,expectedId);
    if(accepted&&!backup)endGuestSession();
    if(!mounted.current)return;
    restoreFocus.current=backup?"import":"clear";
    setBusy(false);setPreview(null);setClearId(null);
    if(accepted)setMessage(backup?"Backup imported. Re-enter source credentials before syncing.":"Guest data cleared from this browser. Account data and sign-in are unchanged.");
    else setError("Local data could not be changed. Your last saved dataset was retained. Check browser storage and try again.");
  }
  if(guest.phase==="loading")return <p role="status">Loading browser storage…</p>;
  if(!datasetId)return <p>Browser storage identity could not be read. Check storage permissions and reload. If needed, use your browser’s site data settings to clear Kairos data. This removes local coursework and may also sign you out of your account.</p>;
  const snapshot=guest.phase==="ready"?guest.snapshot:null;
  return <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="text-lg font-semibold">Backup and local data</h2>
    <p className="text-sm text-[var(--muted)]">Backups contain private coursework and grades, but no credentials. Keep them somewhere private. Browser data loss has no server restore. Import replaces this guest workspace; it does not transfer data into an account.</p>
    {snapshot&&<><Button disabled={busy||!lifecycle?.isActive()} onClick={()=>{void exportFile();}}>Export guest backup</Button>
      <div className="space-y-2"><label htmlFor={`${id}-file`} className="block font-medium">Import guest backup</label><input ref={importRef} id={`${id}-file`} type="file" accept=".json,application/json" className="min-h-11 max-w-full" disabled={busy||!lifecycle?.isActive()} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void importFile(file);}}/><p className="text-sm text-[var(--muted)]">JSON backup, up to 10 MiB. Review the preview before replacing anything.</p></div></>}
    {preview?.datasetId===datasetId&&<div ref={previewRef} tabIndex={-1} role="region" aria-label="Backup replacement preview" className="space-y-3 rounded-xl border border-[var(--border)] p-4">
      <p>{preview.backup.data.connections.length} sources, {preview.backup.data.courses.length} courses, {preview.backup.data.assignments.length} assignments, {preview.backup.data.statuses.length} statuses in this backup.</p>
      <p>Replace all local guest coursework and preferences? This clears saved credentials and stops pending work.</p>
      <div className="flex flex-wrap gap-3"><Button variant="danger" disabled={busy} onClick={()=>{void confirm(preview.backup,preview.datasetId);}}>Replace local data</Button><Button variant="secondary" disabled={busy} onClick={()=>{setPreview(null);importRef.current?.focus();}}>Cancel import</Button></div>
    </div>}
    <div><Button ref={clearRef} variant="danger" disabled={busy} onClick={()=>{setPreview(null);setClearId(datasetId);setError(null);setMessage(null);}}>Clear guest data</Button></div>
    {clearId===datasetId&&<div ref={clearPreviewRef} tabIndex={-1} role="region" aria-label="Clear guest data confirmation" className="space-y-3 rounded-xl border border-[var(--border)] p-4">
      <p>{snapshot?`${snapshot.connections.length} sources, ${snapshot.courses.length} courses, ${snapshot.assignments.length} assignments and ${snapshot.statuses.length} statuses will be removed.`:"Saved coursework is unreadable; counts are unavailable. This clears the guest workspace identified by its readable storage metadata."}</p>
      <p>Clear guest coursework, preferences and remembered credentials from this browser? Export a backup first if you need these records. This does not delete account data, sign out of an account, revoke provider access, or erase downloaded backups.</p>
      <div className="flex flex-wrap gap-3"><Button variant="danger" disabled={busy} onClick={()=>{void confirm(null,clearId);}}>Confirm clear guest data</Button><Button variant="secondary" disabled={busy} onClick={()=>{setClearId(null);clearRef.current?.focus();}}>Cancel clear</Button></div>
    </div>}
    {busy&&<p role="status">Saving local changes…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
