"use client";

import Script from "next/script";
import {useActionState,useCallback,useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import type {AuthActionState,IdentityProvider} from "@/lib/auth/initiation";
import {submitPublicSignIn} from './submit-public-sign-in';
import {PUBLIC_AUTH_CHALLENGE_ACTION} from '@/lib/auth/challenge-action';

type Turnstile={render:(element:HTMLElement,options:Record<string,unknown>)=>string;reset:(id:string)=>void;remove:(id:string)=>void};
function widget():Turnstile|undefined{return (window as unknown as {turnstile?:Turnstile}).turnstile;}

export function AuthInitiationForm({siteKey,returnTo,action}:{
  siteKey:string;returnTo:string;action?:(provider:IdentityProvider,data:FormData)=>Promise<AuthActionState>;
}){
  const element=useRef<HTMLDivElement>(null),id=useRef<string|null>(null);
  const [ready,setReady]=useState(false),[token,setToken]=useState("");
  const refresh=useCallback(()=>{setToken("");if(id.current)widget()?.reset(id.current);},[]);
  const [state,submit,pending]=useActionState(async(_previous:AuthActionState|null,data:FormData)=>{
    const providers=data.getAll('provider'),provider=providers[0];
    if(providers.length!==1||(provider!=='google'&&provider!=='microsoft-entra-id'))return {code:'AUTH_PROVIDER_INVALID',message:'Choose a sign-in provider and try again.'};
    try{return await (action?action(provider,data):submitPublicSignIn(provider,data,{fetch:(...args)=>window.fetch(...args),navigate:url=>window.location.assign(url),origin:window.location.origin}));}finally{refresh();}
  },null);
  useEffect(()=>{
    const api=widget();if(!ready||!element.current||!api)return;
    const widgetId=api.render(element.current,{
      sitekey:siteKey,action:PUBLIC_AUTH_CHALLENGE_ACTION,appearance:"interaction-only",size:"compact",
      "response-field":false,callback:(value:string)=>setToken(value),"expired-callback":refresh,
      "error-callback":()=>setToken(""),"timeout-callback":refresh,
    });
    id.current=widgetId;
    return ()=>{api.remove(widgetId);id.current=null;};
  },[ready,refresh,siteKey]);
  return <form action={submit} className="space-y-3">
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setReady(true)}/>
    <input type="hidden" name="cf-turnstile-response" value={token}/>
    <input type="hidden" name="returnTo" value={returnTo}/>
    <div ref={element} aria-label="Human verification" className="relative mx-auto h-[140px] w-[150px]"/>
    <p role="status" className="text-sm text-[var(--muted)]">{token?'Verification complete. Choose either sign-in provider.':'Complete verification to continue.'}</p>
    {state&&<p role="alert" className="text-sm text-red-600">{state.message}</p>}
    <Button className="w-full" type="submit" name="provider" value="google" disabled={!token||pending}>Continue with Google</Button>
    <Button className="w-full" type="submit" name="provider" value="microsoft-entra-id" variant="secondary" disabled={!token||pending}>Continue with Microsoft</Button>
    {pending&&<p role="status" className="text-sm">Signing in…</p>}
  </form>;
}
