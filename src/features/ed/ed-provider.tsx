"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

export type EdPhase="idle"|"testing"|"connecting"|"refreshing"|"syncing"|"success"|"partial"|"error";

type EdContextValue=SubmissionStatusSyncState<string>&{
  connection:SourceConnection|null;
  courses:SourceCourse[];
  phase:EdPhase;
  message:string;
  testToken(token:string):Promise<boolean>;
  connect(token:string):Promise<boolean>;
  refreshCourses():Promise<void>;
  saveEnabledCourses(ids:string[]):Promise<void>;
  syncNow(options?:{deferCalendarSync?:boolean}):Promise<void>;
};

const Context=createContext<EdContextValue|null>(null);

async function readJson(response:Response):Promise<Record<string,unknown>>{
  let body:unknown;
  try{body=await response.json();}catch{body=null;}
  if(!body||typeof body!=="object"||Array.isArray(body))return {};
  return body as Record<string,unknown>;
}

function errorMessage(body:Record<string,unknown>,fallback:string):string{
  return typeof body.message==="string"&&body.message.trim()?body.message:fallback;
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

  async function testToken(token:string):Promise<boolean>{
    setPhase("testing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/test",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed token could not be tested."));
        return false;
      }
      const count=typeof body.itemCount==="number"?body.itemCount:0;
      setPhase("success"); setMessage(courseCountMessage(count));
      return true;
    }catch{
      setPhase("error"); setMessage("Ed token could not be tested.");
      return false;
    }
  }

  async function connect(token:string):Promise<boolean>{
    setPhase("connecting"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/connect",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed could not be connected."));
        return false;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed connected. Choose the courses Kairos should sync.");
      router.refresh();
      return true;
    }catch{
      setPhase("error"); setMessage("Ed could not be connected.");
      return false;
    }
  }

  async function refreshCourses():Promise<void>{
    setPhase("refreshing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/refresh",{method:"POST"});
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed courses could not be refreshed."));
        return;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed courses refreshed.");
      router.refresh();
    }catch{
      setPhase("error"); setMessage("Ed courses could not be refreshed.");
    }
  }

  async function saveEnabledCourses(ids:string[]):Promise<void>{
    setMessage("");
    try{
      const response=await fetch("/api/sources/ed/courses",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({enabledCourseIds:ids}),
      });
      const body=await readJson(response);
      if(!response.ok){
        setPhase("error"); setMessage(errorMessage(body,"Ed course selection could not be saved."));
        return;
      }
      setConnection(body.connection as SourceConnection);
      setCourses(Array.isArray(body.courses)?body.courses as SourceCourse[]:[]);
      setPhase("success");
      setMessage("Ed course selection saved.");
      router.refresh();
    }catch{
      setPhase("error"); setMessage("Ed course selection could not be saved.");
    }
  }

  async function syncNow(options?:{deferCalendarSync?:boolean}):Promise<void>{
    setPhase("syncing"); setMessage("");
    try{
      const response=await fetch("/api/sources/ed/sync",{
        method:"POST",
        ...(options?.deferCalendarSync?{headers:{"x-kairos-calendar-sync":"defer"}}:{}),
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
        setMessage("Some Ed courses could not be refreshed. Previously saved data was kept.");
      }else if(!response.ok){
        setPhase("error");
        setMessage(body.lastErrorCode==="ED_AUTH_INVALID"
          ?"Ed rejected the saved API token. Update it and try again."
          :errorMessage(body,"Ed sync could not be completed."));
      }else{
        setPhase("success");
        setMessage("Ed sync complete.");
      }
      router.refresh();
    }catch{
      setPhase("error"); setMessage("Ed sync could not be completed.");
    }
  }

  return <Context.Provider value={{
    ...syncState,
    connection,courses,phase,message,
    testToken,connect,refreshCourses,saveEnabledCourses,syncNow,
  }}>{children}</Context.Provider>;
}

export function useEd():EdContextValue{
  const value=useContext(Context);
  if(!value)throw new Error("useEd must be used within EdProvider.");
  return value;
}
