"use client";
import {getRecoveryNotice,recoveryFromResponse,readRecoveryBody,RecoveryRequestError,type RecoveryNotice} from '@/lib/recovery/presentation';
import {RecoveryPrompts} from '@/features/recovery/recovery-prompts';
import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SyncSummary } from "@/lib/sync/types";
import { Button } from "@/components/ui/button";
import {MemoryInput,PrivateDraftControls,usePrivateDrafts} from "@/features/onboarding/private-drafts";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { SourceStatus } from "./source-status";
import { SyncSummaryView } from "@/features/sync/sync-summary";
import { navigateDocument } from "@/lib/browser-navigation";

export function CanvasSourceCard({connection:initial,onConnected}:{connection:SourceConnection|null;onConnected?:(connection:SourceConnection)=>Promise<void>}):React.JSX.Element{
  const router=useRouter();
  const drafts=usePrivateDrafts();
  const [localConnection,setConnection]=useState(initial);
  const connection=drafts?initial:localConnection;
  const [feedUrl,setFeedUrl]=useState(drafts?.read('canvas','feedUrl')??"");
  const [busy,setBusy]=useState<"test"|"connect"|"sync"|null>(null);
  const [recovery,setRecovery]=useState<RecoveryNotice|null>(getRecoveryNotice(initial?.lastErrorCode,{key:'canvas'}));
  const retryUntil=useRef(0),retryAction=useRef<'test'|'connect'|'sync'>('sync');
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [summary,setSummary]=useState<SyncSummary|null>(null);
  const candidate=feedUrl.trim()?{kind:'canvas' as const,feedUrl}:null;
  const hasInput=Boolean(candidate||drafts?.saved.includes('canvas'));

  async function call(path:string,sync=false){
    const response=await fetch(path,{
      method:"POST",
      ...(sync?{}:{headers:{"content-type":"application/json"},body:JSON.stringify({feedUrl})}),
    });
    const body=await readRecoveryBody(response);
    if(!response.ok){
      const notice=recoveryFromResponse(body,response,'canvas');
      if(notice?.retryAfterSeconds)retryUntil.current=Date.now()+notice.retryAfterSeconds*1000;
      if(body.code==='SYNC_RECOVERY_REQUIRED')retryUntil.current=Infinity;
      throw new RecoveryRequestError(notice,'Canvas request failed. Previously saved data was kept.');
    }
    return body;
  }

  async function test(){
    if(Date.now()<retryUntil.current)return;
    retryAction.current='test';setRecovery(null);
    setBusy("test");
    setError("");
    setMessage("");
    try{
      const body=drafts?await drafts.use('canvas','test',candidate??undefined):await call("/api/sources/canvas/test");
      setMessage(`Connection works · ${body.itemCount??body.count??0} assignments found.`);
    }catch(e){
      failed(e,'Canvas could not be tested. Previously saved data was kept.');
    }finally{
      setBusy(null);
    }
  }

  async function connect(){
    if(Date.now()<retryUntil.current)return;
    retryAction.current='connect';setRecovery(null);
    setBusy("connect");
    setError("");
    try{
      if(drafts){
        await drafts.use('canvas','connect',candidate??undefined);
        setMessage('Canvas connected. You can continue or finish setup.');
      }else{
        const body=await call("/api/sources/canvas/connect");
        const accepted=body.connection as SourceConnection;
        setConnection(accepted);setSummary(body.sync as SyncSummary);
        if(onConnected)await onConnected(accepted);else navigateDocument("/upcoming");
      }
      setFeedUrl("");
    }catch(e){
      failed(e,'Canvas could not be connected. Previously saved data was kept.');
    }finally{
      setBusy(null);
    }
  }

  function failed(error:unknown,fallback:string){
    const notice=error instanceof RecoveryRequestError?error.notice:drafts?null:getRecoveryNotice('SERVICE_UNAVAILABLE',{key:'canvas'});
    setRecovery(notice);setError(notice?'':fallback);
  }
  async function sync(){
    if(busy||Date.now()<retryUntil.current||connection?.lastErrorCode==='SYNC_RECOVERY_REQUIRED')return;
    retryAction.current='sync';setBusy('sync');setRecovery(null);setError('');
    try{setSummary(await call('/api/sources/canvas/sync',true) as SyncSummary);router.refresh();}
    catch(error){failed(error,'Canvas sync failed. Previously saved data was kept.');}
    finally{setBusy(null);}
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Canvas</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Use your private Canvas calendar feed. Your UW password is never requested.</p>
        </div>
        <SourceStatus connection={connection}/>
      </div>
      <div className="mt-5">
        <Label htmlFor="canvas-feed">Canvas calendar feed URL</Label>
        <MemoryInput
          id="canvas-feed"
          type="url"
          autoComplete="off"
          value={feedUrl}
          onValueChange={value=>{setFeedUrl(value);drafts?.edit('canvas','feedUrl',value);}}
          placeholder="https://canvas.uw.edu/feeds/calendars/…"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={test} disabled={!hasInput||busy!==null}>{busy==="test"?"Testing…":"Test connection"}</Button>
        <Button onClick={connect} disabled={!hasInput||busy!==null}>{busy==="connect"?"Connecting…":"Connect Canvas"}</Button>
        {connection&&<Button variant="secondary" onClick={()=>void sync()} disabled={busy!==null}>{busy==='sync'?'Syncing…':'Sync Now'}</Button>}
      </div>
      <PrivateDraftControls kind="canvas" input={candidate} busy={busy!==null} onError={setError}/>
      {message&&<Alert className="mt-4">{message}</Alert>}
      {error&&<Alert className="mt-4 border-[var(--danger)]">{error}</Alert>}
      {recovery&&<div className="mt-4"><RecoveryPrompts notices={[recovery]} onRetry={()=>retryAction.current==='test'?test():retryAction.current==='connect'?connect():sync()}/></div>}
      {summary&&<div className="mt-4"><SyncSummaryView summary={summary}/></div>}
    </section>
  );
}
