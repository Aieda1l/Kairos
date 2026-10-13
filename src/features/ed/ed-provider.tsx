"use client";
import {syncAllRequestInit} from '@/lib/sync-all/client';
import type {SyncAllOptions} from '@/lib/sync-all/types';
import {recoveryFromResponse,type RecoveryNotice} from "@/lib/recovery/presentation";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

export type EdPhase="idle"|"testing"|"connecting"|"refreshing"|"syncing"|"success"|"partial"|"error";

type EdRecoveryOperation='test'|'connect'|'refresh'|'selection'|'sync';
type EdContextValue=SubmissionStatusSyncState<string>&{
  connection:SourceConnection|null;
  courses:SourceCourse[];
  phase:EdPhase;
  message:string;
  recovery:RecoveryNotice|null;
  recoveryOperation:EdRecoveryOperation|null;
  testToken(token:string):Promise<boolean>;
  connect(token:string):Promise<boolean>;
  refreshCourses():Promise<void>;
  refreshAccepted():Promise<void>;
  saveEnabledCourses(ids:string[]):Promise<void>;
  syncNow(options?:SyncAllOptions):Promise<void>;
};

const Context=createContext<EdContextValue|null>(null);

async function readJson(response:Response):Promise<Record<string,unknown>>{
  let body:unknown;
  try{body=await response.json();}catch{body=null;}
  if(!body||typeof body!=="object"||Array.isArray(body))return {};
  return body as Record<string,unknown>;
}


function courseCountMessage(count:number):string{
  return `Ed token is valid · ${count} ${count===1?"course":"courses"} found.`;
}

export function EdProvider({
  connection:initialConnection,
  initialCourses,
  initialSyncState,
  children,
}:{
  connection:SourceConnection|null;
  initialCourses:SourceCourse[];
  initialSyncState:SubmissionStatusSyncState<string>;
  children:ReactNode;
}){
  const router=useRouter();
  const [connection,setConnection]=useState(initialConnection);
  const [courses,setCourses]=useState(initialCourses);
  const [syncState,setSyncState]=useState(initialSyncState);
  const [phase,setPhase]=useState<EdPhase>("idle");
  const [message,setMessage]=useState("");
  const [recovery,setRecovery]=useState<RecoveryNotice|null>(null);
  const blockedUntil=useRef(0);
  const [recoveryOperation,setRecoveryOperation]=useState<EdRecoveryOperation|null>(null);
  function errorMessage(body:Record<string,unknown>,fallback:string,response:Response|undefined,operation:EdRecoveryOperation):string{
    setRecoveryOperation(operation);
    const notice=recoveryFromResponse(body,response,'ed');setRecovery(notice);
    if(notice?.retryAfterSeconds)blockedUntil.current=Date.now()+notice.retryAfterSeconds*1000;
    if(body.code==='SYNC_RECOVERY_REQUIRED')blockedUntil.current=Infinity;
    return notice?.message??fallback;
  }

  async function refreshAccepted(){
    const response=await fetch('/api/sources/ed/courses',{cache:'no-store'});
    const body=await readJson(response);
    if(!response.ok)throw new Error('Ed connection could not be loaded.');
    setConnection(body.connection as SourceConnection|null);
    setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
  }

  async function testToken(token:string):Promise<boolean>{
    if(Date.now()<blockedUntil.current)return false;
    setRecovery(null);setRecoveryOperation(null);
    setPhase("testing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/test",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed token could not be tested.",response,"test"));
        return false;
      }
      const count=typeof body.itemCount==="number"?body.itemCount:0;
      setPhase("success"); setMessage(courseCountMessage(count));
      return true;
    }catch{
      setPhase("error"); setMessage(errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed token could not be tested.",undefined,"test"));
      return false;
    }
  }

  async function connect(token:string):Promise<boolean>{
    if(Date.now()<blockedUntil.current)return false;
    setRecovery(null);setRecoveryOperation(null);
    setPhase("connecting"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/connect",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed could not be connected.",response,"connect"));
        return false;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed connected. Choose the courses Kairos should sync.");
      router.refresh();
      return true;
    }catch{
      setPhase("error"); setMessage(errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed could not be connected.",undefined,"connect"));
      return false;
    }
  }

  async function refreshCourses():Promise<void>{
    if(Date.now()<blockedUntil.current)return ;
    setRecovery(null);setRecoveryOperation(null);
    setPhase("refreshing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/refresh",{method:"POST"});
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed courses could not be refreshed.",response,"refresh"));
        return;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed courses refreshed.");
      router.refresh();
    }catch{
      setPhase("error"); setMessage(errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed courses could not be refreshed.",undefined,"refresh"));
    }
  }

  async function saveEnabledCourses(ids:string[]):Promise<void>{
    if(Date.now()<blockedUntil.current)return ;
    setRecovery(null);setRecoveryOperation(null);
    setMessage("");
    try{
      const response=await fetch("/api/sources/ed/courses",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({enabledCourseIds:ids}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed course selection could not be saved.",response,"selection"));
        return;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed course selection saved.");
      router.refresh();
    }catch{
      setPhase("error"); setMessage(errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed course selection could not be saved.",undefined,"selection"));
    }
  }

  async function syncNow(options?:SyncAllOptions):Promise<void>{
    if(Date.now()<blockedUntil.current)return ;
    setRecovery(null);setRecoveryOperation(null);
    setPhase("syncing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/sync",{
        method:"POST",
        ...syncAllRequestInit(options),
      });
      const body=await readJson(response);
      if(typeof body.lastAttemptedAt==="string"||body.lastAttemptedAt===null){
        setSyncState({
          lastAttemptedAt:body.lastAttemptedAt as string|null,
          lastSuccessfulAt:(typeof body.lastSuccessfulAt==="string"||body.lastSuccessfulAt===null)?body.lastSuccessfulAt as string|null:null,
          lastErrorCode:(typeof body.lastErrorCode==="string"||body.lastErrorCode===null)?body.lastErrorCode as string|null:null,
          updatedCount:typeof body.statusUpdatedCount==="number"?body.statusUpdatedCount:0,
          failedCount:typeof body.failedCourseCount==="number"?body.failedCourseCount:0,
        });
      }
      if(body.lastErrorCode==="PARTIAL_SYNC"){
        setPhase("partial");
        setMessage('Some Ed courses could not be refreshed. '+errorMessage(body,"Previously saved data was kept.",response,"sync"));
      }else if(!response.ok){
        setPhase("error");
        setMessage(errorMessage(body,"Ed sync could not be completed.",response,"sync"));
      }else{
        setPhase("success");
        setMessage("Ed sync complete.");
      }
      router.refresh();
    }catch{
      setPhase("error"); setMessage(errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed sync could not be completed.",undefined,"sync"));
    }
  }

  return <Context.Provider value={{
    ...syncState,
    connection,courses,phase,message,recovery,recoveryOperation,
    testToken,connect,refreshCourses,refreshAccepted,saveEnabledCourses,syncNow,
  }}>{children}</Context.Provider>;
}

export function useEd():EdContextValue{
  const value=useContext(Context);
  if(!value)throw new Error("useEd must be used within EdProvider.");
  return value;
}
