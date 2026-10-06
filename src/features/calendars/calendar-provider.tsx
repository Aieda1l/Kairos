"use client";

import {createContext,useContext,useState,type ReactNode} from "react";
import type {CalendarConnection} from "@/lib/calendar/types";

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
  try{const body=await response.json();return body&&typeof body==="object"&&!Array.isArray(body)?body as Record<string,unknown>:{};}catch{return {};}
}
function bodyMessage(body:Record<string,unknown>,fallback:string){return typeof body.message==="string"&&body.message.trim()?body.message:fallback;}

export function CalendarSyncProvider({initialConnections,children}:{initialConnections:CalendarConnection[];children:ReactNode}){
  const [connections,setConnections]=useState(initialConnections);
  const [states,setStates]=useState<Record<string,CalendarState>>({});
  const setLocal=(id:string,state:CalendarState)=>setStates(current=>({...current,[id]:state}));
  const phaseFor=(id:string):CalendarPhase=>states[id]?.phase??"idle";
  const messageFor=(id:string):string=>states[id]?.message??"";

  async function startOAuth(provider:"google"|"microsoft",connectionId?:string){
    const key=connectionId??provider; setLocal(key,{phase:"connecting",message:""});
    try{
      const response=await fetch(`/api/calendars/${provider}/start`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(connectionId?{connectionId}:{})});
      const body=await readJson(response);
      if(!response.ok)throw new Error(bodyMessage(body,"Calendar authorization could not start."));
      const authorizationUrl=typeof body.authorizationUrl==="string"?body.authorizationUrl:"";
      if(!/^https:\/\//.test(authorizationUrl))throw new Error("Calendar authorization returned an invalid URL.");
      window.location.assign(authorizationUrl);
    }catch(error){setLocal(key,{phase:"error",message:error instanceof Error?error.message:"Calendar authorization could not start."});}
  }

  async function testIcloud(username:string,secret:string):Promise<boolean>{
    setLocal("caldav",{phase:"testing",message:""});
    try{
      const response=await fetch("/api/calendars/caldav/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,secret})});
      const body=await readJson(response); if(!response.ok)throw new Error(bodyMessage(body,"iCloud Calendar could not be tested."));
      setLocal("caldav",{phase:"success",message:"iCloud Calendar credentials work."}); return true;
    }catch(error){setLocal("caldav",{phase:"error",message:error instanceof Error?error.message:"iCloud Calendar could not be tested."});return false;}
  }

  async function connectIcloud(username:string,secret:string):Promise<boolean>{
    const existing=connections.find(item=>item.provider==="caldav"); const key=existing?.id??"caldav"; setLocal(key,{phase:"connecting",message:""});
    try{
      const response=await fetch("/api/calendars/caldav/connect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,secret,...(existing?{connectionId:existing.id}:{})})});
      const body=await readJson(response); if(!response.ok)throw new Error(bodyMessage(body,"iCloud Calendar could not be connected."));
      const connection=body.connection as CalendarConnection|undefined; if(!connection?.id)throw new Error("iCloud Calendar returned an invalid connection.");
      setConnections(current=>current.some(item=>item.id===connection.id)?current.map(item=>item.id===connection.id?connection:item):[...current,connection]);
      setLocal(connection.id,{phase:"success",message:"iCloud Calendar connected."}); setLocal("caldav",{phase:"success",message:"iCloud Calendar connected."}); return true;
    }catch(error){setLocal(key,{phase:"error",message:error instanceof Error?error.message:"iCloud Calendar could not be connected."});return false;}
  }

  async function syncConnection(id:string){
    const connection=connections.find(item=>item.id===id); if(!connection)return; setLocal(id,{phase:"syncing",message:""});
    try{
      const response=await fetch(`/api/calendars/${id}/sync`,{method:"POST"}); const body=await readJson(response);
      if(!response.ok||body.status==="error"){setLocal(id,{phase:"error",message:`${connection.label} could not be synchronized.`});return;}
      setLocal(id,{phase:body.status==="partial"?"error":"success",message:body.status==="partial"?`${connection.label} synchronized with warnings.`:`${connection.label} synchronized.`});
    }catch{setLocal(id,{phase:"error",message:`${connection.label} could not be synchronized.`});}
  }

  async function syncAll(){
    try{
      const response=await fetch("/api/calendars/sync-all",{method:"POST"}); const body=await readJson(response);
      if(!response.ok)throw new Error("Calendar synchronization failed.");
      if(Array.isArray(body.results))for(const result of body.results){
        if(!result||typeof result!=="object")continue; const row=result as Record<string,unknown>; if(typeof row.connectionId!=="string")continue;
        const connection=connections.find(item=>item.id===row.connectionId); if(!connection)continue;
        setLocal(connection.id,{phase:row.status==="success"?"success":"error",message:row.status==="success"?`${connection.label} synchronized.`:`${connection.label} could not be synchronized.`});
      }
    }catch{for(const connection of connections)setLocal(connection.id,{phase:"error",message:`${connection.label} could not be synchronized.`});}
  }

  async function removeEvents(id:string){
    const connection=connections.find(item=>item.id===id); if(!connection)return; setLocal(id,{phase:"syncing",message:""});
    try{const response=await fetch(`/api/calendars/${id}/remove-events`,{method:"POST"});const body=await readJson(response);if(!response.ok)throw new Error(bodyMessage(body,"Generated calendar events could not be removed."));setLocal(id,{phase:"success",message:"Generated Kairos events removed. The calendar connection remains."});}
    catch(error){setLocal(id,{phase:"error",message:error instanceof Error?error.message:"Generated calendar events could not be removed."});}
  }

  async function disconnect(id:string){
    const connection=connections.find(item=>item.id===id); if(!connection)return; setLocal(id,{phase:"connecting",message:""});
    try{const response=await fetch(`/api/calendars/${id}/disconnect`,{method:"POST"});const body=await readJson(response);if(!response.ok)throw new Error(bodyMessage(body,"Calendar could not be disconnected."));setConnections(current=>current.filter(item=>item.id!==id));setLocal(id,{phase:"success",message:"Calendar disconnected locally. Remote calendar data was not deleted."});}
    catch(error){setLocal(id,{phase:"error",message:error instanceof Error?error.message:"Calendar could not be disconnected."});}
  }

  return <Context.Provider value={{connections,phaseFor,messageFor,startGoogle:id=>startOAuth("google",id),startMicrosoft:id=>startOAuth("microsoft",id),testIcloud,connectIcloud,syncConnection,syncAll,removeEvents,disconnect}}>{children}</Context.Provider>;
}
export function useCalendarSync(){const value=useContext(Context);if(!value)throw new Error("useCalendarSync must be used within CalendarSyncProvider.");return value;}
