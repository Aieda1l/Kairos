"use client";
import {createContext,useContext,useEffect,useRef,useSyncExternalStore,type InputHTMLAttributes,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import type {SecretDraft} from '@/lib/onboarding/secret-draft';
export type DraftKind=SecretDraft['kind'];
export type PrivateDraftSession={
  saved:DraftKind[];
  read(kind:DraftKind,field:string):string;
  edit(kind:DraftKind,field:string,value:string):void;
  save(input:SecretDraft):Promise<void>;
  discard(kind:DraftKind):Promise<void>;
  use(kind:DraftKind,action:'test'|'connect',input?:SecretDraft,connectionId?:string):Promise<Record<string,unknown>>;
  progress(drafts?:{gradescopeCourseIds?:string[];edCourseIds?:string[]}):Promise<void>;
  courseIds(provider:'gradescope'|'ed'):string[]|undefined;
  selectCourses(provider:'gradescope'|'ed',ids:string[]):void;
  run<T>(action:()=>Promise<T>):Promise<T>;
};
const Context=createContext<PrivateDraftSession|null>(null);
export function PrivateDraftProvider({value,children}:{value:PrivateDraftSession;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export function usePrivateDrafts(){return useContext(Context);}
// The value lives in memory and the input's live property, never in an HTML
// value attribute. This also avoids serializing a fresh secret on Back.
const subscribeReady=()=>()=>{};
const clientReady=()=>true;
const serverReady=()=>false;
export function MemoryInput({value,onValueChange,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'defaultValue'>&{value:string;onValueChange:(value:string)=>void}){
  // Pre-hydration edits have no React change handler and could be erased by the
  // initial live-value effect. Make the field editable only after hydration.
  const ready=useSyncExternalStore(subscribeReady,clientReady,serverReady);
  const ref=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(ref.current&&ref.current.value!==value)ref.current.value=value;},[value]);
  return <input {...props} disabled={!ready||props.disabled} ref={ref} onChange={e=>onValueChange(e.target.value)} className={props.className??'min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2'}/>;
}
export function PrivateDraftControls({kind,input,busy,onError}:{kind:DraftKind;input:SecretDraft|null;busy:boolean;onError:(message:string)=>void}){
  const drafts=usePrivateDrafts();if(!drafts)return null;
  async function run(action:()=>Promise<void>){try{await action();}catch{onError('Saved input could not be updated. Try again.');}}
  return <div className="mt-3 flex flex-wrap items-center gap-3">
    {drafts.saved.includes(kind)&&<span className="text-sm">Saved privately</span>}
    <Button variant="secondary" disabled={busy||!input} onClick={()=>void run(()=>drafts.save(input!))}>{drafts.saved.includes(kind)?'Replace saved input':'Save privately'}</Button>
    {drafts.saved.includes(kind)&&<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>drafts.discard(kind))}>Discard saved input</Button>}
    <p className="w-full text-xs text-[var(--muted)]">Saved input stays on the server and is never displayed again. Leave the fields empty to reuse it.</p>
  </div>;
}
