"use client";

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

type CalendarPhase="idle"|"testing"|"connecting"|"syncing"|"success"|"error";
type CalendarState={phase:CalendarPhase;message:string};
type CalendarSyncContextValue={
  connections:CalendarConnection[];
  phaseFor(id:string):CalendarPhase;
  messageFor(id:string):string;
  startGoogle(connectionId?:string):Promise<void>;
  startMicrosoft(connectionId?:string):Promise<void>;
  testIcloud(username:string,secret:string):Promise<boolean>;
  connectIcloud(username:string,secret:string):Promise<boolean>;
  syncConnection(id:string):Promise<void>;
  syncAll():Promise<void>;
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

function bodyMessage(body:Record<string,unknown>,fallback:string){
  return typeof body.message==="string"&&body.message.trim()
    ?body.message
    :fallback;
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
  const syncAllPromiseRef=useRef<Promise<void>|null>(null);

  useEffect(()=>{
    connectionsRef.current=connections;
  },[connections]);

  const setLocal=useCallback((id:string,state:CalendarState)=>{
    setStates(current=>({...current,[id]:state}));
  },[]);

  const phaseFor=(id:string):CalendarPhase=>states[id]?.phase??"idle";
  const messageFor=(id:string):string=>states[id]?.message??"";

  const applySyncResult=useCallback((row:Record<string,unknown>):void=>{
    if(typeof row.connectionId!=="string")return;
    const status=resultStatus(row.status);
    if(!status)return;
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
  },[]);

  async function startOAuth(provider:"google"|"microsoft",connectionId?:string){
    const key=connectionId??provider;
    setLocal(key,{phase:"connecting",message:""});
    try{
      const response=await fetch(`/api/calendars/${provider}/start`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(connectionId?{connectionId}:{}),
      });
      const body=await readJson(response);
      if(!response.ok){
        throw new Error(bodyMessage(body,"Calendar authorization could not start."));
      }
      const authorizationUrl=typeof body.authorizationUrl==="string"?body.authorizationUrl:"";
      if(!/^https:\/\//.test(authorizationUrl)){
        throw new Error("Calendar authorization returned an invalid URL.");
      }
      window.location.assign(authorizationUrl);
    }catch(error){
      setLocal(key,{
        phase:"error",
        message:error instanceof Error?error.message:"Calendar authorization could not start.",
      });
    }
  }

  async function testIcloud(username:string,secret:string):Promise<boolean>{
    setLocal("caldav",{phase:"testing",message:""});
    try{
      const response=await fetch("/api/calendars/caldav/test",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({username,secret}),
      });
      const body=await readJson(response);
      if(!response.ok){
        throw new Error(bodyMessage(body,"iCloud Calendar could not be tested."));
      }
      setLocal("caldav",{phase:"success",message:"iCloud Calendar credentials work."});
      return true;
    }catch(error){
      setLocal("caldav",{
        phase:"error",
        message:error instanceof Error?error.message:"iCloud Calendar could not be tested.",
      });
      return false;
    }
  }

  async function connectIcloud(username:string,secret:string):Promise<boolean>{
    const existing=connections.find(item=>item.provider==="caldav");
    const key=existing?.id??"caldav";
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
        throw new Error(bodyMessage(body,"iCloud Calendar could not be connected."));
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
        phase:"error",
        message:error instanceof Error?error.message:"iCloud Calendar could not be connected.",
      });
      return false;
    }
  }

  async function syncConnection(id:string){
    const connection=connections.find(item=>item.id===id);
    if(!connection)return;
    setLocal(id,{phase:"syncing",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/sync`,{method:"POST"});
      const body=await readJson(response);
      applySyncResult(body);
      if(!response.ok||body.status==="error"){
        setLocal(id,{phase:"error",message:`${connection.label} could not be synchronized.`});
        return;
      }
      setLocal(id,{
        phase:body.status==="partial"?"error":"success",
        message:body.status==="partial"
          ?`${connection.label} synchronized with warnings.`
          :syncSuccessMessage(connection,body),
      });
    }catch{
      setLocal(id,{phase:"error",message:`${connection.label} could not be synchronized.`});
    }
  }

  const syncAll=useCallback(async():Promise<void>=>{
    if(syncAllPromiseRef.current){
      return syncAllPromiseRef.current;
    }

    const run=(async()=>{
      const current=connectionsRef.current;
      try{
        const response=await fetch("/api/calendars/sync-all",{method:"POST"});
        const body=await readJson(response);
        if(!response.ok)throw new Error("Calendar synchronization failed.");

        if(Array.isArray(body.results)){
          for(const result of body.results){
            if(!result||typeof result!=="object"||Array.isArray(result))continue;
            const row=result as Record<string,unknown>;
            if(typeof row.connectionId!=="string")continue;
            const connection=current.find(item=>item.id===row.connectionId);
            if(!connection)continue;
            applySyncResult(row);
            const status=resultStatus(row.status);
            setLocal(connection.id,{
              phase:status==="success"?"success":"error",
              message:status==="success"
                ?`${connection.label} synchronized.`
                :status==="partial"
                  ?`${connection.label} synchronized with warnings.`
                  :`${connection.label} could not be synchronized.`,
            });
          }
        }
      }catch{
        for(const connection of current){
          setLocal(connection.id,{
            phase:"error",
            message:`${connection.label} could not be synchronized.`,
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
    if(!connection)return;
    setLocal(id,{phase:"syncing",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/remove-events`,{method:"POST"});
      const body=await readJson(response);
      if(!response.ok){
        throw new Error(bodyMessage(body,"Generated calendar events could not be removed."));
      }
      setLocal(id,{
        phase:"success",
        message:"Generated Kairos events removed. The calendar connection remains.",
      });
    }catch(error){
      setLocal(id,{
        phase:"error",
        message:error instanceof Error
          ?error.message
          :"Generated calendar events could not be removed.",
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
        throw new Error(bodyMessage(body,"Calendar could not be disconnected."));
      }
      setConnections(current=>current.filter(item=>item.id!==id));
      setLocal(id,{
        phase:"success",
        message:"Calendar disconnected locally. Remote calendar data was not deleted.",
      });
    }catch(error){
      setLocal(id,{
        phase:"error",
        message:error instanceof Error?error.message:"Calendar could not be disconnected.",
      });
    }
  }

  return <Context.Provider value={{
    connections,
    phaseFor,
    messageFor,
    startGoogle:id=>startOAuth("google",id),
    startMicrosoft:id=>startOAuth("microsoft",id),
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
