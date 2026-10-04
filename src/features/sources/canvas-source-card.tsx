"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SyncSummary } from "@/lib/sync/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { SourceStatus } from "./source-status";
import { SyncButton } from "@/features/sync/sync-button";
import { SyncSummaryView } from "@/features/sync/sync-summary";

export function CanvasSourceCard({connection:initial}:{connection:SourceConnection|null}){
  const router=useRouter();
  const [connection,setConnection]=useState(initial);
  const [feedUrl,setFeedUrl]=useState("");
  const [busy,setBusy]=useState<"test"|"connect"|null>(null);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [summary,setSummary]=useState<SyncSummary|null>(null);

  async function call(path:string){
    const response=await fetch(path,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({feedUrl}),
    });
    const body=await response.json();
    if(!response.ok) throw new Error(body.message??"Canvas request failed.");
    return body;
  }

  async function test(){
    setBusy("test");
    setError("");
    setMessage("");
    try{
      const body=await call("/api/sources/canvas/test");
      setMessage(`Connection works · ${body.itemCount} assignments found.`);
    }catch(e){
      setError(e instanceof Error?e.message:"Canvas could not be tested.");
    }finally{
      setBusy(null);
    }
  }

  async function connect(){
    setBusy("connect");
    setError("");
    try{
      const body=await call("/api/sources/canvas/connect");
      setConnection(body.connection);
      setSummary(body.sync);
      setFeedUrl("");
      router.push("/upcoming");
      router.refresh();
    }catch(e){
      setError(e instanceof Error?e.message:"Canvas could not be connected.");
    }finally{
      setBusy(null);
    }
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
        <Input
          id="canvas-feed"
          type="url"
          autoComplete="off"
          value={feedUrl}
          onChange={e=>setFeedUrl(e.target.value)}
          placeholder="https://canvas.uw.edu/feeds/calendars/…"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={test} disabled={!feedUrl||busy!==null}>{busy==="test"?"Testing…":"Test connection"}</Button>
        <Button onClick={connect} disabled={!feedUrl||busy!==null}>{busy==="connect"?"Connecting…":"Connect Canvas"}</Button>
        {connection&&<SyncButton onComplete={s=>{setSummary(s);router.refresh();}} onError={setError}/>}
      </div>
      {message&&<Alert className="mt-4">{message}</Alert>}
      {error&&<Alert className="mt-4 border-[var(--danger)]">{error}</Alert>}
      {summary&&<div className="mt-4"><SyncSummaryView summary={summary}/></div>}
    </section>
  );
}
