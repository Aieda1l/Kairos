"use client";
import {syncAllRequestInit} from '@/lib/sync-all/client';
import {getRecoveryNotice,recoveryFromResponse,RecoveryRequestError,type RecoveryNotice} from "@/lib/recovery/presentation";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {CalendarConnection,CalendarSyncStatus} from "@/lib/calendar/types";

const STALE_AFTER_MS=15*60*1000;

const OAUTH_ERROR_MESSAGES:Record<string,string>={
  CALENDAR_CONFIG_MISSING:"Microsoft Calendar app credentials or permissions are misconfigured. Check the Entra client ID, client secret value, tenant, and Web redirect URL.",
  CALENDAR_AUTH_EXPIRED:"Microsoft Calendar rejected the authorization. Start a new connection, and verify the registered redirect URL if this persists.",
  CALENDAR_PERMISSION_DENIED:"Microsoft connected, but Graph denied calendar access. Check the Calendar app's delegated Calendars.ReadWrite permission, user/admin consent, and Outlook/Exchange mailbox access.",
  CALENDAR_AUTH_REQUIRED:"Microsoft Calendar needs renewed consent. Start the connection again.",
  CALENDAR_NETWORK_ERROR:"Kairos could not reach Microsoft during calendar authorization. Try again.",
  CALENDAR_RATE_LIMITED:"Microsoft is temporarily limiting requests. Try again later.",
  CALENDAR_UPSTREAM_ERROR:"Microsoft Calendar could not be connected. Check the Entra configuration and try again.",
};
const GOOGLE_OAUTH_ERROR_MESSAGES:Record<string,string>={
  CALENDAR_CONFIG_MISSING:'Google Calendar is temporarily unavailable. Try again later.',
  CALENDAR_AUTH_EXPIRED:'Google Calendar rejected the authorization. Start a new connection.',
  CALENDAR_PERMISSION_DENIED:'Google Calendar did not allow calendar access. Check permissions and connect again.',
  CALENDAR_AUTH_REQUIRED:'Google Calendar authorization was not completed.',
  CALENDAR_NETWORK_ERROR:'Kairos could not reach Google during calendar authorization. Try again.',
  CALENDAR_RATE_LIMITED:'Google is temporarily limiting requests. Try again later.',
  CALENDAR_UPSTREAM_ERROR:'Google Calendar could not be connected. Try again later.',
};

type CalendarPhase="idle"|"testing"|"connecting"|"syncing"|"success"|"error";
type CalendarRecoveryOperation='authorize'|'test-icloud'|'connect-icloud'|'sync'|'sync-all'|'remove-events'|'disconnect';
type CalendarState={phase:CalendarPhase;message:string;recovery?:RecoveryNotice|null;operation?:CalendarRecoveryOperation};
type CalendarSyncContextValue={
  connections:CalendarConnection[];
  phaseFor(id:string):CalendarPhase;
  messageFor(id:string):string;
  recoveryFor(id:string):RecoveryNotice|null;
  recoveryOperationFor(id:string):CalendarRecoveryOperation|null;
  startGoogle(connectionId?:string,returnTo?:'/onboarding'):Promise<void>;
  startMicrosoft(connectionId?:string,returnTo?:'/onboarding'):Promise<void>;
  refreshAccepted():Promise<void>;
  testIcloud(username:string,secret:string):Promise<boolean>;
  connectIcloud(username:string,secret:string):Promise<boolean>;
  syncConnection(id:string):Promise<void>;
  syncAll(runId?:string):Promise<void>;
  removeEvents(id:string):Promise<void>;
  disconnect(id:string):Promise<void>;
};

const Context=createContext<CalendarSyncContextValue|null>(null);

async function readJson(response:Response):Promise<Record<string,unknown>>{
  try{
    const body=await response.json();
    return body&&typeof body==="object"&&!Array.isArray(body)
      ?body as Record<string,unknown>
      :{};
  }catch{
    return {};
  }
}


function isConnectionStale(connection:CalendarConnection,now=Date.now()):boolean{
  if(!connection.enabled)return false;
  if(!connection.lastSyncCompletedAt)return true;
  const completed=Date.parse(connection.lastSyncCompletedAt);
  return !Number.isFinite(completed)||now-completed>=STALE_AFTER_MS;
}

function resultStatus(value:unknown):Exclude<CalendarSyncStatus,"never">|null{
  return value==="success"||value==="partial"||value==="error"?value:null;
}

function countValue(body:Record<string,unknown>,key:string):number{
  const value=body[key];
  return typeof value==="number"&&Number.isFinite(value)&&value>=0?value:0;
}

function syncSuccessMessage(
  connection:CalendarConnection,
  body:Record<string,unknown>,
):string{
  const created=countValue(body,"createdCount");
  const updated=countValue(body,"updatedCount");
  const deleted=countValue(body,"deletedCount");
  const unchanged=countValue(body,"unchangedCount");
  const failed=countValue(body,"failedCount");
  const counts=`${created} created, ${updated} updated, ${deleted} deleted, ${unchanged} unchanged, ${failed} failed`;
  const destination=connection.provider==="microsoft"
    ?" Check Outlook's secondary Kairos calendar if events are not visible in your primary calendar."
    :"";
  return `${connection.label} synchronized: ${counts}.${destination}`;
}

export function CalendarSyncProvider({
  initialConnections,
  children,
}:{
  initialConnections:CalendarConnection[];
  children:ReactNode;
}){
  const [connections,setConnections]=useState(initialConnections);
  const [states,setStates]=useState<Record<string,CalendarState>>({});
  const connectionsRef=useRef(connections);
  const blockedUntil=useRef<Record<string,number>>({});
  const busyUntil=useRef<Record<string,number>>({});
  const completionVersion=useRef<Record<string,number>>({});
  const syncAllPromiseRef=useRef<Promise<void>|null>(null);

  useEffect(()=>{
    connectionsRef.current=connections;
  },[connections]);

  const recordCompletion=useCallback((id:string)=>{
    completionVersion.current[id]=(completionVersion.current[id]??0)+1;
    delete busyUntil.current[id];
  },[]);
  const setLocal=useCallback((id:string,state:CalendarState)=>{
    const previousDeadline=blockedUntil.current[id]??0;
    const incomingDeadline=state.recovery?.retryAfterSeconds?Date.now()+state.recovery.retryAfterSeconds*1000:0;
    if(state.recovery?.retryAfterSeconds){
      const target=state.recovery.waitForCompletion?busyUntil:blockedUntil;
      target.current[id]=Math.max(target.current[id]??0,incomingDeadline);
    }
    if(state.recovery?.requiresSettlement)blockedUntil.current[id]=Infinity;
    setStates(current=>{
      const prior=current[id];
      if(prior?.recovery?.requiresSettlement&&!state.recovery?.requiresSettlement&&blockedUntil.current[id]===Infinity)return current;
      const priorTimed=prior?.recovery?.retryAfterSeconds&&!prior.recovery.waitForCompletion;
      const incomingTimed=state.recovery?.retryAfterSeconds&&!state.recovery.waitForCompletion;
      // Preserve an existing restriction, not an unrelated error that preceded
      // the restriction introduced by this response. Longer new limits replace it.
      if(!state.recovery?.requiresSettlement&&priorTimed&&Date.now()<previousDeadline&&(state.phase==='success'||state.phase==='error')&&(!incomingTimed||incomingDeadline<=previousDeadline))return current;
      return {...current,[id]:state};
    });
  },[]);

  useEffect(()=>{
    const url=new URL(window.location.href);
    const provider=url.searchParams.get('calendarProvider');
    if(provider!=='google'&&provider!=='microsoft')return;
    const code=url.searchParams.get("calendarError");
    if(!code)return;
    const messages=provider==='google'?GOOGLE_OAUTH_ERROR_MESSAGES:OAUTH_ERROR_MESSAGES;
    const message=provider==='microsoft'&&code==="CALENDAR_AUTH_EXPIRED"&&url.searchParams.get("calendarStage")==="calendar_setup"
      ?"Microsoft signed in successfully, but Outlook rejected calendar access. Try a fresh connection and confirm this Microsoft account can open Outlook Calendar."
      :Object.hasOwn(messages,code)
      ?messages[code]
      :provider==='google'?'Google Calendar could not be connected. Try again.':'Microsoft Calendar could not be connected. Try again.';
    const connection=connectionsRef.current.find(item=>item.provider===provider);
    setLocal(connection?.id??provider,{phase:"error",message});
    url.searchParams.delete("calendarProvider");
    url.searchParams.delete("calendarError");
    url.searchParams.delete("calendarStage");
    window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
  },[setLocal]);

  const phaseFor=(id:string):CalendarPhase=>states[id]?.phase??"idle";
  const messageFor=(id:string):string=>states[id]?.message??"";
  const recoveryFor=(id:string):RecoveryNotice|null=>states[id]?.recovery??getRecoveryNotice(connections.find(item=>item.id===id)?.lastErrorCode,{key:id});
  const recoveryOperationFor=(id:string):CalendarRecoveryOperation|null=>states[id]?.operation??null;
  function canAttempt(id:string){
    const connection=connectionsRef.current.find(item=>item.id===id);
    return connection?.lastErrorCode!=="SYNC_RECOVERY_REQUIRED"&&Date.now()>=Math.max(blockedUntil.current[id]??0,busyUntil.current[id]??0);
  }
  function requestFailure(body:Record<string,unknown>,response:Response,key:string,fallback:string):never{
    const recovery=recoveryFromResponse(body,response,key);
    if(body.code==="SYNC_RECOVERY_REQUIRED"||body.errorCode==="SYNC_RECOVERY_REQUIRED")blockedUntil.current[key]=Infinity;
    throw new RecoveryRequestError(recovery,fallback);
  }

  const applySyncResult=useCallback((row:Record<string,unknown>):void=>{
    if(typeof row.connectionId!=="string")return;
    const status=resultStatus(row.status);
    if(!status)return;
    if(status==='success'||status==='partial')recordCompletion(row.connectionId);
    const completedAt=typeof row.completedAt==="string"?row.completedAt:null;
    const errorCode=typeof row.errorCode==="string"?row.errorCode:null;

    const nextConnections=connectionsRef.current.map(connection=>{
      if(connection.id!==row.connectionId)return connection;
      return {
        ...connection,
        lastSyncCompletedAt:
          status==="success"||status==="partial"
            ?completedAt??connection.lastSyncCompletedAt
            :connection.lastSyncCompletedAt,
        lastSyncStatus:status,
        lastErrorCode:errorCode,
      };
    });
    connectionsRef.current=nextConnections;
    setConnections(nextConnections);
  },[recordCompletion]);

  async function refreshAccepted(){
    const response=await fetch('/api/calendars',{cache:'no-store'});
    const body=await readJson(response);
    if(!response.ok||!Array.isArray(body.connections))throw new Error('Calendar connections could not be loaded.');
    const accepted=body.connections as CalendarConnection[];
    connectionsRef.current=accepted;setConnections(accepted);
  }
  async function startOAuth(provider:"google"|"microsoft",connectionId?:string,returnTo?:'/onboarding'){
    const key=connectionId??provider;
    if(!canAttempt(key))return;
    setLocal(key,{phase:"connecting",message:""});
    try{
      const response=await fetch(`/api/calendars/${provider}/start`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({...(connectionId?{connectionId}:{}),...(returnTo?{returnTo}:{})}),
      });
      const body=await readJson(response);
      if(!response.ok){
        requestFailure(body,response,key,"Calendar authorization could not start.");
      }
      const authorizationUrl=typeof body.authorizationUrl==="string"?body.authorizationUrl:"";
      if(!/^https:\/\//.test(authorizationUrl)){
        throw new Error("Calendar authorization returned an invalid URL.");
      }
      window.location.assign(authorizationUrl);
    }catch(error){
      setLocal(key,{
        operation:'authorize',
        phase:"error",
        message:error instanceof RecoveryRequestError?error.message:"Calendar authorization could not start.",
        recovery:error instanceof RecoveryRequestError?error.notice:getRecoveryNotice("SERVICE_UNAVAILABLE"),
      });
    }
  }

  async function testIcloud(username:string,secret:string):Promise<boolean>{
    const key=connections.find(item=>item.provider==='caldav')?.id??'caldav';
    if(!canAttempt(key))return false;
    setLocal(key,{phase:"testing",message:""});
    try{
      const response=await fetch("/api/calendars/caldav/test",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({username,secret}),
      });
      const body=await readJson(response);
      if(!response.ok){
        requestFailure(body,response,key,"iCloud Calendar could not be tested.");
      }
      setLocal(key,{phase:"success",message:"iCloud Calendar credentials work."});
      return true;
    }catch(error){
      setLocal(key,{
        operation:'test-icloud',
        phase:"error",
        message:error instanceof RecoveryRequestError?error.message:"iCloud Calendar could not be tested.",
        recovery:error instanceof RecoveryRequestError?error.notice:getRecoveryNotice("SERVICE_UNAVAILABLE"),
      });
      return false;
    }
  }

  async function connectIcloud(username:string,secret:string):Promise<boolean>{
    const existing=connections.find(item=>item.provider==="caldav");
    const key=existing?.id??"caldav";
    if(!canAttempt(key))return false;
    setLocal(key,{phase:"connecting",message:""});
    try{
      const response=await fetch("/api/calendars/caldav/connect",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          username,
          secret,
          ...(existing?{connectionId:existing.id}:{}),
        }),
      });
      const body=await readJson(response);
      if(!response.ok){
        requestFailure(body,response,key,"iCloud Calendar could not be connected.");
      }
      const connection=body.connection as CalendarConnection|undefined;
      if(!connection?.id){
        throw new Error("iCloud Calendar returned an invalid connection.");
      }
      setConnections(current=>
        current.some(item=>item.id===connection.id)
          ?current.map(item=>item.id===connection.id?connection:item)
          :[...current,connection],
      );
      setLocal(connection.id,{phase:"success",message:"iCloud Calendar connected."});
      setLocal("caldav",{phase:"success",message:"iCloud Calendar connected."});
      return true;
    }catch(error){
      setLocal(key,{
        operation:'connect-icloud',
        phase:"error",
        message:error instanceof RecoveryRequestError?error.message:"iCloud Calendar could not be connected.",
        recovery:error instanceof RecoveryRequestError?error.notice:getRecoveryNotice("SERVICE_UNAVAILABLE"),
      });
      return false;
    }
  }

  async function syncConnection(id:string){
    const connection=connections.find(item=>item.id===id);
    if(!connection||!canAttempt(id))return;
    const startedVersion=completionVersion.current[id]??0;
    setLocal(id,{phase:"syncing",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/sync`,{method:"POST"});
      const body=await readJson(response);
      const recovery=recoveryFromResponse(body,response,id);
      if(recovery?.waitForCompletion&&(completionVersion.current[id]??0)!==startedVersion)return;
      applySyncResult(body);
      if(!response.ok||body.status==="error"){
        if(body.code==="SYNC_RECOVERY_REQUIRED"||body.errorCode==="SYNC_RECOVERY_REQUIRED")blockedUntil.current[id]=Infinity;
        setLocal(id,{operation:'sync',phase:"error",message:`${connection.label} could not be synchronized. ${recovery?.message??'Retry later; saved data is retained.'}`,recovery});
        return;
      }
      setLocal(id,{
        ...(body.status==='partial'?{operation:'sync' as const}:{}),
        recovery:body.status==='partial'?recovery:null,
        phase:body.status==="partial"?"error":"success",
        message:body.status==="partial"
          ?recovery?.message??`${connection.label} synchronized with warnings.`
          :syncSuccessMessage(connection,body),
      });
    }catch{
      setLocal(id,{operation:'sync',phase:"error",message:`${connection.label} could not be synchronized. Retry later; saved data is retained.`,recovery:getRecoveryNotice("SERVICE_UNAVAILABLE",{key:id})});
    }
  }

  const syncAll=useCallback(async(runId?:string):Promise<void>=>{
    while(syncAllPromiseRef.current){
      const pending=syncAllPromiseRef.current;
      if(runId===undefined)return pending;
      // An admitted pass must reconcile the source writes preceding this run,
      // so joining a batch that started earlier cannot satisfy its step.
      await pending;
      if(syncAllPromiseRef.current===pending)syncAllPromiseRef.current=null;
    }

    const run=(async()=>{
      const current=connectionsRef.current.filter(connection=>connection.enabled);
      if(!current.some(connection=>canAttempt(connection.id)))return;
      // sync-all cannot exclude a blocked destination; wait instead of bypassing backoff.
      if(current.some(connection=>!canAttempt(connection.id)))return;
      const startedVersions=new Map(current.map(connection=>[connection.id,completionVersion.current[connection.id]??0]));
      try{
        const response=await fetch("/api/calendars/sync-all",{method:"POST",...syncAllRequestInit({syncAllRunId:runId})});
        const body=await readJson(response);
        if(!response.ok){
          for(const connection of current){
            const recovery=recoveryFromResponse(body,response,connection.id);
            if(recovery?.waitForCompletion&&(completionVersion.current[connection.id]??0)!==startedVersions.get(connection.id))continue;
            if(body.code==="SYNC_RECOVERY_REQUIRED")blockedUntil.current[connection.id]=Infinity;
            setLocal(connection.id,{operation:'sync-all',phase:"error",message:recovery?.message??"Calendar synchronization failed. Retry later.",recovery});
          }
          return;
        }

        if(Array.isArray(body.results)){
          for(const result of body.results){
            if(!result||typeof result!=="object"||Array.isArray(result))continue;
            const row=result as Record<string,unknown>;
            if(typeof row.connectionId!=="string")continue;
            const connection=current.find(item=>item.id===row.connectionId);
            if(!connection)continue;
            const status=resultStatus(row.status);
            const recovery=status==="success"?null:recoveryFromResponse(row,undefined,connection.id);
            if(recovery?.waitForCompletion&&(completionVersion.current[connection.id]??0)!==startedVersions.get(connection.id))continue;
            applySyncResult(row);
            if(row.errorCode==="SYNC_RECOVERY_REQUIRED")blockedUntil.current[connection.id]=Infinity;
            setLocal(connection.id,{
              ...(status!=='success'?{operation:'sync-all' as const}:{}),
              recovery,
              phase:status==="success"?"success":"error",
              message:status==="success"
                ?`${connection.label} synchronized.`
                :status==="partial"
                  ?recovery?.message??`${connection.label} synchronized with warnings.`
                  :`${connection.label} could not be synchronized. ${recovery?.message??"Retry later; saved data is retained."}`,
            });
          }
        }
      }catch{
        for(const connection of current){
          setLocal(connection.id,{
            operation:'sync-all',
            phase:"error",
            message:`${connection.label} could not be synchronized. Retry later; saved data is retained.`,
            recovery:getRecoveryNotice("SERVICE_UNAVAILABLE",{key:connection.id}),
          });
        }
      }
    })();

    syncAllPromiseRef.current=run;
    try{
      await run;
    }finally{
      if(syncAllPromiseRef.current===run){
        syncAllPromiseRef.current=null;
      }
    }
  },[applySyncResult,setLocal]);

  useEffect(()=>{
    const checkStale=()=>{
      if(document.visibilityState!=="visible")return;
      if(!connectionsRef.current.some(connection=>isConnectionStale(connection))){
        return;
      }
      void syncAll();
    };

    checkStale();
    document.addEventListener("visibilitychange",checkStale);
    return ()=>document.removeEventListener("visibilitychange",checkStale);
  },[connections.length,syncAll]);

  async function removeEvents(id:string){
    const connection=connections.find(item=>item.id===id);
    if(!connection||!canAttempt(id))return;
    setLocal(id,{phase:"syncing",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/remove-events`,{method:"POST"});
      const body=await readJson(response);
      if(!response.ok){
        requestFailure(body,response,id,"Generated calendar events could not be removed.");
      }
      setLocal(id,{
        phase:"success",
        message:"Generated Kairos events removed. The calendar connection remains.",
      });
    }catch(error){
      setLocal(id,{
        operation:'remove-events',
        phase:"error",
        message:error instanceof RecoveryRequestError
          ?error.message
          :"Generated calendar events could not be removed.",
        recovery:error instanceof RecoveryRequestError?error.notice:getRecoveryNotice("SERVICE_UNAVAILABLE"),
      });
    }
  }

  async function disconnect(id:string){
    const connection=connections.find(item=>item.id===id);
    if(!connection)return;
    setLocal(id,{phase:"connecting",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/disconnect`,{method:"POST"});
      const body=await readJson(response);
      if(!response.ok){
        requestFailure(body,response,id,"Calendar could not be disconnected.");
      }
      setConnections(current=>current.filter(item=>item.id!==id));
      setLocal(id,{
        phase:"success",
        message:"Calendar disconnected locally. Remote calendar data was not deleted.",
      });
    }catch(error){
      setLocal(id,{
        operation:'disconnect',
        phase:"error",
        message:error instanceof RecoveryRequestError?error.message:"Calendar could not be disconnected.",
        recovery:error instanceof RecoveryRequestError?error.notice:getRecoveryNotice("SERVICE_UNAVAILABLE"),
      });
    }
  }

  return <Context.Provider value={{
    connections,
    phaseFor,
    messageFor,
    recoveryFor,
    recoveryOperationFor,
    startGoogle:(id,returnTo)=>startOAuth("google",id,returnTo),
    startMicrosoft:(id,returnTo)=>startOAuth("microsoft",id,returnTo),
    refreshAccepted,
    testIcloud,
    connectIcloud,
    syncConnection,
    syncAll,
    removeEvents,
    disconnect,
  }}>{children}</Context.Provider>;
}

export function useCalendarSync(){
  const value=useContext(Context);
  if(!value)throw new Error("useCalendarSync must be used within CalendarSyncProvider.");
  return value;
}
