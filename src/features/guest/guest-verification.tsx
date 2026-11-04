"use client";
import Script from "next/script";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";

type Turnstile={render:(element:HTMLElement,options:Record<string,unknown>)=>string;reset:(id:string)=>void;remove:(id:string)=>void};
const widget=()=>(window as unknown as {turnstile?:Turnstile}).turnstile;
export function GuestVerification({siteKey,onProof,onCancel,busy=false}:{siteKey:string;onProof:(proof:string)=>void;onCancel:()=>void;busy?:boolean}){
  const element=useRef<HTMLDivElement>(null),id=useRef<string|null>(null);
  const [ready,setReady]=useState(false),[proof,setProof]=useState("");
  useEffect(()=>{
    const api=widget();if(!ready||!element.current||!api||!siteKey)return;
    let active=true;
    const clear=()=>{if(active)setProof("");};
    const widgetId=api.render(element.current,{sitekey:siteKey,action:"guest_sync",size:"compact","response-field":false,
      callback:(token:string)=>{if(active)setProof(token);},"expired-callback":clear,"error-callback":clear,"timeout-callback":clear});
    id.current=widgetId;
    return ()=>{active=false;api.remove(widgetId);id.current=null;};
  },[ready,siteKey]);
  return <section aria-label="Guest verification" className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <h2 className="font-semibold">Verify to use live source reads</h2>
    <p className="text-sm text-[var(--muted)]">Verification enables temporary guest access. Saved coursework stays in this browser.</p>
    {siteKey?<><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setReady(true)}/><div ref={element} aria-label="Guest human verification" className="min-h-[140px] w-[150px]"/></>:<p role="alert">Verification is temporarily unavailable. Try again later.</p>}
    <form onSubmit={event=>{event.preventDefault();if(!proof||busy)return;const token=proof;setProof("");if(id.current)widget()?.reset(id.current);onProof(token);}} className="flex flex-wrap gap-3">
      <Button type="submit" disabled={!proof||busy}>Verify and continue</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={()=>{setProof("");onCancel();}}>Cancel verification</Button>
    </form>
  </section>;
}
