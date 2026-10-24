"use client";
import {syncAllRequestInit} from '@/lib/sync-all/client';
import type {SyncAllOptions} from '@/lib/sync-all/types';
import {getRecoveryNotice,recoveryFromResponse,type RecoveryNotice} from "@/lib/recovery/presentation";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

export type EdPhase="idle"|"testing"|"connecting"|"refreshing"|"syncing"|"success"|"partial"|"error";
export type EdSyncAttemptResult={
  status:'completed'|'partial'|'failed'|'blocked';
  message:string;
  recovery:RecoveryNotice|null;
};

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
  syncNow(options?:SyncAllOptions):Promise<EdSyncAttemptResult>;
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

const ED_SYNC_ERROR_CODES=['ED_AUTH_INVALID','ED_NETWORK_ERROR','ED_RATE_LIMITED','ED_UPSTREAM_ERROR','ED_PARSE_ERROR','ED_COURSE_UNAVAILABLE','PARTIAL_SYNC','ED_NOT_CONNECTED','ED_NO_COURSES_ENABLED'] as const;
type EdResultState=SubmissionStatusSyncState<typeof ED_SYNC_ERROR_CODES[number]>;
function projectSyncState(body:Record<string,unknown>):EdResultState|null{
  const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
  const errorCode=ED_SYNC_ERROR_CODES.find(code=>code===body.lastErrorCode);
  if(!timestamp(body.lastAttemptedAt)
    ||(body.lastSuccessfulAt!==null&&!timestamp(body.lastSuccessfulAt))
    ||(body.lastErrorCode!==null&&!errorCode)
    ||!count(body.statusUpdatedCount)||!count(body.failedCourseCount))return null;
  const lastErrorCode=errorCode??null;
  if(lastErrorCode===null||lastErrorCode==='PARTIAL_SYNC'){
    if(body.lastSuccessfulAt===null||Date.parse(body.lastSuccessfulAt)<Date.parse(body.lastAttemptedAt))return null;
    if(lastErrorCode===null?body.failedCourseCount!==0:body.failedCourseCount===0)return null;
  }
  return {
    lastAttemptedAt:body.lastAttemptedAt,lastSuccessfulAt:body.lastSuccessfulAt,lastErrorCode,
    updatedCount:body.statusUpdatedCount,failedCount:body.failedCourseCount,
  };
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
  const cooldownUntil=useRef(0);
  const attemptedSyncAllRuns=useRef(new Set<string>());
  const [recoveryOperation,setRecoveryOperation]=useState<EdRecoveryOperation|null>(null);
  function errorMessage(body:Record<string,unknown>,fallback:string,response:Response|undefined,operation:EdRecoveryOperation):string{
    setRecoveryOperation(operation);
    const notice=recoveryFromResponse(body,response,'ed');setRecovery(notice);
    if(notice?.retryAfterSeconds){
      cooldownUntil.current=Date.now()+notice.retryAfterSeconds*1000;
      if(blockedUntil.current!==Infinity)blockedUntil.current=cooldownUntil.current;
    }
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

  async function syncNow(options?:SyncAllOptions):Promise<EdSyncAttemptResult>{
    // A fresh manual admission may ask the guarded endpoint to recheck ownership.
    // Accepted connection reads and elapsed time cannot settle uncertain provider work.
    const freshAdmission=Boolean(options?.syncAllRunId&&!attemptedSyncAllRuns.current.has(options.syncAllRunId));
    if(Date.now()<cooldownUntil.current||(Date.now()<blockedUntil.current&&!(blockedUntil.current===Infinity&&freshAdmission))){
      const notice=Date.now()>=cooldownUntil.current&&blockedUntil.current===Infinity
        ?getRecoveryNotice('SYNC_RECOVERY_REQUIRED',{key:'ed'})
        :recovery??getRecoveryNotice('RATE_LIMITED',{key:'ed'});
      const blockedMessage=notice?.message??'Ed sync is unavailable. Retry later.';
      setPhase('error');setMessage(blockedMessage);setRecovery(notice);setRecoveryOperation('sync');
      return {status:'blocked',message:blockedMessage,recovery:notice};
    }
    if(options?.syncAllRunId)attemptedSyncAllRuns.current.add(options.syncAllRunId);
    setRecovery(null);setRecoveryOperation(null);
    setPhase("syncing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/sync",{
        method:"POST",
        ...syncAllRequestInit(options),
      });
      const body=await readJson(response);
      const resultState=projectSyncState(body);
      const completedResult=response.ok&&resultState&&(resultState.lastErrorCode===null||resultState.lastErrorCode==='PARTIAL_SYNC');
      if(resultState&&(completedResult||(resultState.lastErrorCode!==null&&resultState.lastErrorCode!=='PARTIAL_SYNC'))){
        setSyncState(previous=>({...resultState,lastSuccessfulAt:completedResult?resultState.lastSuccessfulAt:previous.lastSuccessfulAt??resultState.lastSuccessfulAt}));
      }
      if(!completedResult){
        const failureBody=response.ok?{code:resultState?.lastErrorCode??'INVALID_RESULT'}:body;
        const failureMessage=errorMessage(failureBody,'Ed sync could not be completed.',response,'sync');
        const notice=recoveryFromResponse(failureBody,response,'ed');
        setPhase('error');setMessage(failureMessage);
        router.refresh();
        return {status:notice?.requiresSettlement||notice?.retryAfterSeconds?'blocked':'failed',message:failureMessage,recovery:notice};
      }
      if(body.lastErrorCode==="PARTIAL_SYNC"){
        blockedUntil.current=0;cooldownUntil.current=0;
        setPhase("partial");
        const partialMessage='Some Ed courses could not be refreshed. '+errorMessage(body,"Previously saved data was kept.",response,"sync");
        setMessage(partialMessage);
        router.refresh();
        return {status:'partial',message:partialMessage,recovery:recoveryFromResponse(body,response,'ed')};
      }else{
        blockedUntil.current=0;cooldownUntil.current=0;
        setPhase("success");
        setMessage("Ed sync complete.");
      }
      router.refresh();
      return {status:'completed',message:'Ed sync complete.',recovery:null};
    }catch{
      const failureMessage=errorMessage({code:"SERVICE_UNAVAILABLE"},"Ed sync could not be completed.",undefined,"sync");
      setPhase("error");setMessage(failureMessage);
      return {status:'failed',message:failureMessage,recovery:getRecoveryNotice('SERVICE_UNAVAILABLE',{key:'ed'})};
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
