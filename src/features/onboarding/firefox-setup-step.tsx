"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Alert} from '@/components/ui/alert';
import type {FirefoxDistribution} from '@/lib/extension-distribution';
import {pingKairosExtension} from '@/features/submission-status/extension-bridge';
export function FirefoxSetupStep({distribution}:{distribution:FirefoxDistribution}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function check(){setBusy(true);try{const info=await pingKairosExtension();setMessage(`Firefox extension detected. Canvas tab: ${info.canvasTabDetected?'open':'not open'}. Gradescope tab: ${info.gradescopeTabDetected?'open':'not open'}. Check the extension popup for the installed version.`);}catch{setMessage('Firefox extension not detected. You can continue or skip this step.');}finally{setBusy(false);}}
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-semibold">Firefox</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">Firefox {distribution.minimumVersion}+ and the Kairos extension can read submission status and Gradescope from signed-in tabs. Canvas calendar feeds and Ed work without Firefox.</p>
    {distribution.state==='available'&&distribution.installUrl?<a className="mt-4 inline-flex min-h-11 items-center underline" href={distribution.installUrl} target="_blank" rel="noreferrer">Install from Mozilla Add-ons</a>:<p className="mt-4">Version 0.4.0 was submitted and is awaiting review. A public Mozilla Add-ons installation link is not available yet.</p>}
    <Button className="mt-4" variant="secondary" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check extension'}</Button>{message&&<Alert className="mt-4">{message}</Alert>}
  </section>;
}
