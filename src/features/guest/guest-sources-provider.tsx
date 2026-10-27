"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {createGuestCredentials} from "@/lib/guest/credentials";
import {GuestDataError,type GuestSafeCode} from "@/lib/guest/errors";
import {createGuestBridgeReader} from "@/lib/guest/sync/bridge-reader";
import {createGuestSyncCoordinator,type GuestRunOptions} from "@/lib/guest/sync/coordinator";
import type {GuestSourceActionOutcome} from "@/lib/guest/sync/source-actions";
import {createGuestTransientClient} from "@/lib/guest/sync/transient-client";
import type {GuestRunReport,GuestSecretChoice,GuestSnapshot} from "@/lib/guest/types";
import {useGuest,useGuestStoreLifecycle} from "./guest-provider";

type Coordinator=ReturnType<typeof createGuestSyncCoordinator>;
type Action=()=>Promise<GuestSourceActionOutcome>;
type SourceState={busy:boolean;report:GuestRunReport|null;actionOutcome:GuestSourceActionOutcome|null;verificationRequired:boolean;verified:boolean;secretAvailable:Record<string,boolean>;draftEpoch:number};
type SourceContext=SourceState & {
  ready:boolean;siteKey:string;
  run:(input?:GuestRunOptions)=>Promise<void>;
  connectCanvas:(choice:GuestSecretChoice)=>Promise<GuestSourceActionOutcome>;
  connectEd:(choice:GuestSecretChoice)=>Promise<GuestSourceActionOutcome>;
  connectGradescope:()=>Promise<GuestSourceActionOutcome>;
  restoreSecret:(id:string,choice:GuestSecretChoice)=>Promise<GuestSourceActionOutcome>;
  refreshCourses:(id:string)=>Promise<GuestSourceActionOutcome>;
  setEnabledCourses:(id:string,ids:string[])=>Promise<GuestSourceActionOutcome>;
  forgetCredential:(id:string)=>Promise<GuestSourceActionOutcome>;
  disconnect:(id:string)=>Promise<GuestSourceActionOutcome>;
  verify:(proof:string)=>Promise<void>;cancelVerification:()=>void;
};
type Owned={coordinator:Coordinator;active:boolean;busy:boolean;pending:Action|null;verification:boolean;dispose:()=>void;availability:()=>Promise<void>;execute:(action:Action,retryable?:boolean)=>Promise<GuestSourceActionOutcome>;run:(options:GuestRunOptions)=>Promise<void>;verify:(proof:string)=>Promise<void>;cancel:(clearDrafts?:boolean)=>void};
const Context=createContext<SourceContext|null>(null);
const initial=():SourceState=>({busy:false,report:null,actionOutcome:null,verificationRequired:false,verified:false,secretAvailable:{},draftEpoch:0});
const failure=(code:GuestSafeCode):GuestSourceActionOutcome=>({status:"failed",code,connectionId:null});
const uuid=()=>crypto.randomUUID();
const clock={now:()=>Date.now(),setTimeout:(callback:()=>void,delay:number)=>window.setTimeout(callback,delay),clearTimeout:(handle:unknown)=>window.clearTimeout(handle as number)};
const codeOf=(error:unknown):GuestSafeCode=>error instanceof GuestDataError?error.code:"INVALID_RESULT";
function staleSources(snapshot:GuestSnapshot){
  return snapshot.connections.filter(c=>c.enabled&&(c.kind==="canvas"?snapshot.preferences.automaticCanvas:c.kind==="gradescope"&&snapshot.preferences.automaticGradescope)).filter(c=>{
    const state=snapshot.syncStates.find(s=>s.sourceConnectionId===c.id&&s.stage===(c.kind==="canvas"?"canvas-status":"gradescope"));
    return !state?.hasSuccessfulCheck||!state.lastSuccessfulAt||Date.now()-Date.parse(state.lastSuccessfulAt)>=15*60_000;
  }).map(c=>c.kind);
}

/** One coordinator and private vault for the provider-owned store/dataset lifecycle. */
export function GuestSourcesProvider({children,siteKey}:{children:ReactNode;siteKey:string}){
  const lifecycle=useGuestStoreLifecycle(),guest=useGuest();
  const owned=useRef<Owned|null>(null),snapshot=useRef<GuestSnapshot|null>(null);
  const [state,setState]=useState<SourceState>(initial);
  const [ready,setReady]=useState<typeof lifecycle>(null);
  useEffect(()=>{snapshot.current=guest.phase==="ready"?guest.snapshot:null;void owned.current?.availability();},[guest]);

  useEffect(()=>{
    if(!lifecycle?.isActive())return;
    const {store}=lifecycle,credentials=createGuestCredentials(store),transient=createGuestTransientClient();
    const coordinator=createGuestSyncCoordinator({store,credentials,transient,bridge:createGuestBridgeReader(),clock,uuid,pageEpoch:uuid()});
    let bootstrap:AbortController|null=null,availabilityVersion=0,verificationVersion=0;
    const current=()=>session.active&&lifecycle.isActive()&&owned.current===session;
    const publish=(patch:Partial<SourceState>)=>{if(current())setState(value=>({...value,...patch}));};
    function cancel(clearDrafts=false){
      verificationVersion++;bootstrap?.abort();session.pending=null;session.verification=false;
      publish({verificationRequired:false,verified:false});
      if(clearDrafts&&current())setState(value=>({...value,draftEpoch:value.draftEpoch+1}));
    }
    async function availability(){
      const version=++availabilityVersion;
      try{
        const saved=await store.read();if(!current()||saved.datasetId!==lifecycle!.datasetId)return;
        const pairs=await Promise.all(saved.connections.filter(c=>c.kind!=="gradescope").map(async c=>[c.id,(await credentials.get(c.id,c.generation))!==null] as const));
        if(current()&&version===availabilityVersion)publish({secretAvailable:Object.fromEntries(pairs)});
      }catch{/* Existing storage recovery owns unreadable local data. */}
    }
    async function execute(action:Action,retryable=true):Promise<GuestSourceActionOutcome>{
      if(!current())return failure("GUEST_INTERRUPTED");if(session.busy)return failure("GUEST_BUSY");
      session.busy=true;cancel();publish({busy:true,actionOutcome:null});
      let result:GuestSourceActionOutcome;
      try{result=await action();}catch(error){result=failure(codeOf(error));}
      if(!current()){session.busy=false;return failure("GUEST_INTERRUPTED");}
      if(current()){
        if(result.code==="GUEST_SESSION_REQUIRED"){
          session.pending=retryable?action:null;session.verification=true;
          publish({verificationRequired:true});
        }
        publish({actionOutcome:result});void availability();
      }
      session.busy=false;publish({busy:false});return result;
    }
    async function run(options:GuestRunOptions){
      if(!current()||session.busy)return;
      session.busy=true;cancel();publish({busy:true,report:null,actionOutcome:null});
      try{
        const report=await coordinator.run(options);
        if(report.outcomes.some(o=>o.code==="GUEST_SESSION_REQUIRED")){session.verification=true;publish({verificationRequired:true});}
        publish({report});
      }catch(error){publish({actionOutcome:failure(codeOf(error))});}
      finally{session.busy=false;publish({busy:false});void availability();}
    }
    async function verify(proof:string){
      if(!current()||!session.verification||session.busy||!proof)return;
      session.busy=true;const retry=session.pending;session.pending=null;publish({busy:true,actionOutcome:null});
      const version=verificationVersion;const controller=new AbortController();bootstrap=controller;
      try{
        await transient.bootstrap({schemaVersion:1,requestId:uuid(),turnstileToken:proof},controller.signal);
        if(!current()||version!==verificationVersion)return;
        session.verification=false;publish({verificationRequired:false,verified:!retry});
        session.busy=false;
        // Only an explicit server rejection before provider work is safe to retry.
        // A mixed/uncertain run is never replayed; the user starts a new run.
        if(retry)await execute(retry);
      }catch(error){if(current()&&version===verificationVersion){session.pending=retry;session.verification=true;publish({verificationRequired:true,actionOutcome:failure(codeOf(error))});}}
      finally{if(bootstrap===controller)bootstrap=null;session.busy=false;publish({busy:false});}
    }
    function dispose(){
      if(!session.active)return;session.active=false;availabilityVersion++;session.pending=null;
      verificationVersion++;bootstrap?.abort();coordinator.stop();credentials.clear();
    }
    const session:Owned={coordinator,active:true,busy:false,pending:null,verification:false,dispose,availability,execute,run,verify,cancel};
    owned.current=session;
    const retire=lifecycle.onRetire(dispose);
    const hide=()=>{if(document.visibilityState==="hidden")cancel(true);};
    const pagehide=()=>{cancel(true);};document.addEventListener("visibilitychange",hide);window.addEventListener("pagehide",pagehide);
    // Defer until the effect has survived StrictMode's setup/cleanup pass.
    queueMicrotask(()=>{
      if(!current())return;
      setState(initial());setReady(lifecycle);void availability();
      const saved=snapshot.current;
      if(saved?.datasetId===lifecycle.datasetId){const sources=staleSources(saved);if(sources.length)void run({automatic:true,sources});}
    });
    return ()=>{retire();dispose();document.removeEventListener("visibilitychange",hide);window.removeEventListener("pagehide",pagehide);if(owned.current===session)owned.current=null;};
  },[lifecycle]);

  // Bind rendered callbacks to their dataset lifecycle; a retained callback must
  // never redirect an old draft/action into a newly imported or cleared dataset.
  const currentOwned=()=>ready===lifecycle&&lifecycle?.isActive()?owned.current:null;
  const action=(invoke:(coordinator:Coordinator)=>Promise<GuestSourceActionOutcome>,retryable=true)=>{
    const session=currentOwned();if(!session?.active)return Promise.resolve(failure("GUEST_INTERRUPTED"));
    return session.execute(()=>invoke(session.coordinator),retryable);
  };
  return <Context.Provider value={{...(ready===lifecycle?state:initial()),ready:ready===lifecycle&&!!lifecycle?.isActive(),siteKey,
    run:(options={})=>currentOwned()?.run(options)??Promise.resolve(),
    connectCanvas:choice=>action(c=>c.connectCanvas(choice)),connectEd:choice=>action(c=>c.connectEd(choice)),connectGradescope:()=>action(c=>c.connectGradescope()),
    restoreSecret:(id,choice)=>action(c=>c.restoreSecret(id,choice)),refreshCourses:id=>action(c=>c.refreshCourses(id)),setEnabledCourses:(id,ids)=>action(c=>c.setEnabledCourses(id,ids),false),
    forgetCredential:id=>action(c=>c.forgetCredential(id),false),disconnect:id=>action(c=>c.disconnect(id),false),
    verify:proof=>currentOwned()?.verify(proof)??Promise.resolve(),cancelVerification:()=>currentOwned()?.cancel(true),
  }}>{children}</Context.Provider>;
}
export function useGuestSources(){const value=useContext(Context);if(!value)throw Error("GuestSourcesProvider is required.");return value;}
