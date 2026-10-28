"use client";
import {useEffect,useId,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import {MemoryInput} from "@/features/onboarding/private-drafts";
import type {SourceCourse,SourceKind} from "@/lib/sources/types";
import type {GuestConnection} from "@/lib/guest/types";
import {useGuest,useGuestStoreLifecycle} from "./guest-provider";
import {useGuestSources} from "./guest-sources-provider";

const names={canvas:"Canvas",gradescope:"Gradescope",ed:"Ed"};
function CredentialForm({kind,connection}:{kind:"canvas"|"ed";connection?:GuestConnection}){
  const sources=useGuestSources(),id=useId();
  const lifecycle=useGuestStoreLifecycle(),form=useRef<HTMLFormElement>(null),draft=useRef({value:"",remember:false});
  const [value,setValue]=useState(""),[remember,setRemember]=useState(false);
  useEffect(()=>{
    const clear=()=>{draft.current={value:"",remember:false};const input=form.current?.querySelector<HTMLInputElement>('input[type="password"]');if(input)input.value="";setValue("");setRemember(false);};
    const hide=()=>{if(document.visibilityState==="hidden")clear();};
    const unsubscribe=lifecycle?.onRetire(clear);
    window.addEventListener("pagehide",clear);document.addEventListener("visibilitychange",hide);
    return ()=>{unsubscribe?.();clear();window.removeEventListener("pagehide",clear);document.removeEventListener("visibilitychange",hide);};
  },[lifecycle]);
  const label=kind==="canvas"?"Canvas calendar feed URL":"Ed API token",name=names[kind];
  return <form ref={form} className="space-y-3" onSubmit={event=>{
    event.preventDefault();if(!draft.current.value||sources.busy||!sources.ready)return;
    const choice={...draft.current};
    void (connection?sources.restoreSecret(connection.id,choice):kind==="canvas"?sources.connectCanvas(choice):sources.connectEd(choice)).then(result=>{
      if(result.status==="success"||result.code==="GUEST_SESSION_REQUIRED"){draft.current={value:"",remember:false};setValue("");setRemember(false);}
    });
  }}>
    <Label htmlFor={id}>{label}</Label>
    <MemoryInput id={id} type="password" value={value} onValueChange={value=>{draft.current.value=value;setValue(value);}} maxLength={4096} required autoComplete="off" spellCheck={false} disabled={!sources.ready||sources.busy} aria-describedby={`${id}-help`}/>
    <p id={`${id}-help`} className="text-sm text-[var(--muted)]">{connection?(sources.secretAvailable[connection.id]?"A credential is available for this source. Enter a new one to replace it.":"Re-enter your credential to refresh this source."):"Kept in memory unless you choose to remember it on this device."} Remembered credentials are plaintext in this browser profile. {connection&&"Update only for the same source account; saved coursework stays. To switch accounts, disconnect this source first. Forgetting a credential keeps coursework."}</p>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={remember} disabled={sources.busy} onChange={event=>{draft.current.remember=event.target.checked;setRemember(event.target.checked);}}/>Remember {name} credential on this device</label>
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!sources.ready||sources.busy||!value}>{connection?`Update ${name} credential`:`Connect ${name}`}</Button>
      {connection&&<Button type="button" variant="secondary" disabled={!sources.ready||sources.busy} onClick={()=>{draft.current={value:"",remember:false};setValue("");setRemember(false);void sources.forgetCredential(connection.id);}}>Forget {name} credential</Button>}</div>
  </form>;
}
function CourseSelection({connection,courses}:{connection:GuestConnection;courses:SourceCourse[]}){
  const sources=useGuestSources(),name=names[connection.kind];
  const [selected,setSelected]=useState(()=>courses.filter(c=>c.enabled).map(c=>c.externalCourseId));
  return <form className="space-y-3" onSubmit={event=>{event.preventDefault();void sources.setEnabledCourses(connection.id,selected);}}>
    <fieldset disabled={!sources.ready||sources.busy} className="space-y-2"><legend className="font-medium">Choose {name} courses</legend>
      {courses.map(c=><label key={c.id} className="flex min-h-11 items-center gap-3 break-words"><input type="checkbox" checked={selected.includes(c.externalCourseId)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,c.externalCourseId]:ids.filter(id=>id!==c.externalCourseId))}/><span className="min-w-0 [overflow-wrap:anywhere]">{c.shortName??c.fullName}</span></label>)}
      {!courses.length&&<p className="text-sm text-[var(--muted)]">No courses discovered. Open your signed-in source tab or check your credential, then refresh courses.</p>}
    </fieldset>
    <div className="flex flex-wrap gap-3"><Button type="submit" variant="secondary" disabled={!sources.ready||sources.busy}>Save {name} courses</Button><Button type="button" variant="secondary" disabled={!sources.ready||sources.busy} onClick={()=>{void sources.refreshCourses(connection.id);}}>Refresh {name} courses</Button></div>
    <p className="text-sm text-[var(--muted)]">New courses start unchecked. Refresh keeps your saved course selection and coursework.</p>
  </form>;
}
function SourceCard({kind,connection,courses,onDisconnected}:{kind:SourceKind;connection?:GuestConnection;courses:SourceCourse[];onDisconnected:(kind:SourceKind)=>void}){
  const sources=useGuestSources(),guest=useGuest(),name=names[kind],heading=useId();
  const [confirming,setConfirming]=useState(false),disconnectRef=useRef<HTMLButtonElement>(null),confirmRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(confirming)confirmRef.current?.focus();},[confirming]);
  const count=guest.phase==="ready"?guest.snapshot.assignments.filter(a=>a.sourceConnectionId===connection?.id).length:0;
  return <section aria-labelledby={heading} data-source-kind={kind} tabIndex={-1} className="min-w-0 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
    <div><h2 id={heading} className="text-lg font-semibold">{name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{connection?"Connected in this browser":kind==="gradescope"?"Open Gradescope in a signed-in tab with the Kairos extension to discover your courses.":kind==="canvas"?"Import your UW Canvas calendar feed. The extension adds live submission status.":"Use your Ed API token to discover and select courses. No extension is needed."}</p></div>
    {kind!=="gradescope"&&<CredentialForm key={`credential:${sources.draftEpoch}`} kind={kind} connection={connection}/>}
    {kind==="gradescope"&&!connection&&<Button type="button" disabled={!sources.ready||sources.busy} onClick={()=>{void sources.connectGradescope();}}>Connect Gradescope</Button>}
    {connection&&kind!=="canvas"&&<CourseSelection key={`courses:${connection.generation}`} connection={connection} courses={courses}/>}
    {connection&&<div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={!sources.ready||sources.busy} onClick={()=>{void sources.run({sources:[kind]});}}>Sync {name}</Button><Button ref={disconnectRef} type="button" variant="danger" disabled={!sources.ready||sources.busy} onClick={()=>setConfirming(true)}>Disconnect {name}</Button></div>}
    {connection&&confirming&&<div ref={confirmRef} tabIndex={-1} className="space-y-3 rounded-xl border border-[var(--border)] p-4"><p>Remove {name}, its credential, {courses.length} courses and {count} assignments from this browser? Other sources and original provider records stay.</p><div className="flex flex-wrap gap-3"><Button variant="danger" disabled={!sources.ready||sources.busy} onClick={()=>{void sources.disconnect(connection.id).then(result=>{if(result.status==="success"){setConfirming(false);onDisconnected(kind);}});}}>Confirm disconnect {name}</Button><Button variant="secondary" disabled={sources.busy} onClick={()=>{setConfirming(false);disconnectRef.current?.focus();}}>Cancel disconnect</Button></div></div>}
  </section>;
}
export function GuestSourceCards(){
  const guest=useGuest(),cardsRef=useRef<HTMLDivElement>(null);
  const [focusRequest,setFocusRequest]=useState<{kind:SourceKind}|null>(null);
  const focusedRequest=useRef<typeof focusRequest>(null);
  useEffect(()=>{
    if(focusRequest&&focusRequest!==focusedRequest.current&&guest.phase==="ready"&&!guest.snapshot.connections.some(c=>c.kind===focusRequest.kind)){
      const card=cardsRef.current?.querySelector<HTMLElement>(`[data-source-kind="${focusRequest.kind}"]`);
      if(card){card.focus();focusedRequest.current=focusRequest;}
    }
  },[focusRequest,guest]);
  if(guest.phase!=="ready")return null;
  return <div ref={cardsRef} className="grid min-w-0 gap-5">{(["canvas","gradescope","ed"] as const).map(kind=>{
    const c=guest.snapshot.connections.find(c=>c.kind===kind);
    return <SourceCard key={`${guest.snapshot.datasetId}:${c?.id??kind}`} kind={kind} connection={c} onDisconnected={kind=>setFocusRequest({kind})} courses={guest.snapshot.courses.filter(course=>course.sourceConnectionId===c?.id)}/>;
  })}</div>;
}
