"use client";
import {Button} from "@/components/ui/button";
import {guestSafeMessage} from "@/lib/guest/errors";
import type {GuestStageOutcome} from "@/lib/guest/types";
import {useGuestSources} from "./guest-sources-provider";
import {GuestVerification} from "./guest-verification";

const names={"canvas-feed":"Canvas feed","canvas-status":"Canvas status",gradescope:"Gradescope",ed:"Ed"};
function Outcome({outcome:o}:{outcome:GuestStageOutcome}){
  if(o.code==="GUEST_NOT_CONNECTED")return null;
  const canvas=o.stage==="canvas-status",courses=o.stage==="ed"||o.stage==="gradescope";
  return <li className="space-y-1">
    <p className="font-medium">{names[o.stage]} {o.status==="success"?"sync complete":o.status==="partial"?"partially updated":o.status==="skipped"?"not checked":"sync incomplete"}</p>
    <p className="text-sm text-[var(--muted)]">{canvas?`${o.updatedCount} of ${o.updatedCount+o.ignoredCount+o.failedCount+o.pendingCount} statuses updated; ${o.ignoredCount} unchanged; ${o.failedCount} failed; ${o.pendingCount} pending`:
      courses?`${o.updatedCount} assignments updated; ${o.failedCount} failed ${o.failedCount===1?"course":"courses"}; ${o.pendingCount} pending ${o.pendingCount===1?"course":"courses"}`:
      `${o.updatedCount} assignments updated; ${o.failedCount} invalid items; ${o.pendingCount} pending reads`}</p>
    {!canvas&&o.ignoredCount>0&&<p className="text-sm text-[var(--muted)]">{o.ignoredCount} assignments unchanged because newer data is already saved.</p>}
    {o.code&&<p className="text-sm">{guestSafeMessage(o.code)}</p>}
  </li>;
}
export function GuestSyncControls(){
  const sources=useGuestSources(),outcomes=sources.report?.outcomes??[];
  return <section aria-label="Guest source sync" className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><Button type="button" disabled={!sources.ready||sources.busy} onClick={()=>{void sources.run();}}>{sources.busy?"Syncing sources…":"Sync sources"}</Button><p className="text-sm text-[var(--muted)]">Canvas feed and Ed refresh when you choose Sync. Automatic checks use open Canvas and Gradescope tabs.</p></div>
    {sources.busy&&<div><Button type="button" variant="secondary" onClick={sources.stop}>Stop waiting</Button><p role="status">Previously saved coursework remains available. An already-dispatched extension read may continue in the source tab.</p></div>}
    {sources.actionOutcome?.code&&<p role="alert">{guestSafeMessage(sources.actionOutcome.code)}</p>}
    {outcomes.length>0&&<div role="status" aria-live="polite" aria-atomic="true" className="rounded-xl border border-[var(--border)] p-4"><ul className="space-y-3">{outcomes.map(o=><Outcome key={o.stage} outcome={o}/>)}</ul>{outcomes.some(o=>o.status!=="success"&&o.code!=="GUEST_NOT_CONNECTED")&&<p className="mt-3 text-sm text-[var(--muted)]">Saved coursework is retained. Failed and pending items have not been updated by this run.</p>}</div>}
    {sources.verificationRequired&&<GuestVerification siteKey={sources.siteKey} busy={sources.busy} onProof={proof=>{void sources.verify(proof);}} onCancel={sources.cancelVerification}/>}
    {sources.verified&&<p role="status">Verified. Run sync again to continue.</p>}
  </section>;
}
