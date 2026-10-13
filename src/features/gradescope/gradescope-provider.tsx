"use client";
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
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import {
  gradescopeAssignmentStructureDiagnosticsV1Schema,
  gradescopeSyncErrorCodeSchema,
  type GradescopeDiscoveryDiagnosticsV1,
  type GradescopeSyncErrorCode,
  type GradescopeSyncResultV1,
} from "@/lib/extension-protocol/gradescope";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";
import { pingKairosExtension } from "@/features/submission-status/extension-bridge";
import {
  GradescopeBridgeError,
  discoverGradescopeExtension,
  syncGradescopeExtensionBatch,
} from "./extension-bridge";

const STALE_AFTER_MS=15*60*1000;

const sourceConnectionSchema=z.object({
  id:z.string().min(1),
  kind:z.literal("gradescope"),
  label:z.string(),
  enabled:z.boolean(),
  lastSyncStartedAt:z.string().nullable(),
  lastSyncCompletedAt:z.string().nullable(),
  lastSyncStatus:z.enum(["never","success","error"]),
  lastErrorCode:z.string().nullable(),
}).strict();

const sourceCourseSchema=z.object({
  id:z.string().min(1),
  sourceConnectionId:z.string().min(1),
  externalCourseId:z.string().regex(/^\d+$/),
  shortName:z.string().nullable(),
  fullName:z.string(),
  term:z.string().nullable(),
  year:z.string().nullable(),
  enabled:z.boolean(),
  firstSeenAt:z.string(),
  lastSeenAt:z.string(),
}).strict();

const discoveryStartSchema=z.object({
  requestId:z.string().uuid(),
  protocolVersion:z.literal(1),
}).strict();

const discoveryCompleteSchema=z.object({
  connection:sourceConnectionSchema,
  courses:z.array(sourceCourseSchema).max(50),
}).strict();

const selectionResponseSchema=discoveryCompleteSchema;

const syncStartSchema=z.object({
  protocolVersion:z.literal(1),
  requestId:z.string().uuid(),
  courseIds:z.array(z.string().regex(/^\d+$/)).max(50),
  maxCourseBatchSize:z.literal(20),
}).strict();

const syncCompleteSchema=z.object({
  requestId:z.string().uuid(),
  insertedCount:z.number().int().nonnegative(),
  updatedCount:z.number().int().nonnegative(),
  statusUpdatedCount:z.number().int().nonnegative(),
  failedCourseCount:z.number().int().nonnegative(),
  ignoredStale:z.number().int().nonnegative(),
  lastAttemptedAt:z.string().datetime().nullable(),
  lastSuccessfulAt:z.string().datetime().nullable(),
  lastErrorCode:gradescopeSyncErrorCodeSchema.nullable(),
  failureDiagnostics:z.array(z.object({
    code:z.string(),
    count:z.number().int().positive(),
  }).strict()),
  failureHttpStatuses:z.array(z.object({
    status:z.number().int().min(100).max(599),
    count:z.number().int().positive(),
  }).strict()),
  failureErrorCodes:z.array(z.object({
    code:gradescopeSyncErrorCodeSchema,
    count:z.number().int().positive(),
  }).strict()).default([]),
  failureStructures:z.array(z.object({
    errorCode:gradescopeSyncErrorCodeSchema,
    diagnostics:gradescopeAssignmentStructureDiagnosticsV1Schema,
  }).strict()).default([]),
}).strict();

type Phase="idle"|"discovering"|"syncing"|"success"|"partial"|"error";

type GradescopeRecoveryOperation='discovery'|'selection'|'sync';
type GradescopeContextValue=SubmissionStatusSyncState<GradescopeSyncErrorCode>&{
  connection:SourceConnection|null;
  courses:SourceCourse[];
  phase:Phase;
  extensionDetected:boolean;
  extensionVersion:string|null;
  gradescopeTabDetected:boolean|null;
  message:string;
  recovery:RecoveryNotice|null;
  recoveryOperation:GradescopeRecoveryOperation|null;
  extensionChecked:boolean;
  discoverCourses:()=>Promise<void>;
  saveEnabledCourses:(ids:string[])=>Promise<void>;
  syncNow:(options?:{deferCalendarSync?:boolean})=>Promise<void>;
};

const Context=createContext<GradescopeContextValue|null>(null);

function isStale(lastSuccessfulAt:string|null,now=new Date()):boolean{
  if(!lastSuccessfulAt)return true;
  const timestamp=Date.parse(lastSuccessfulAt);
  return !Number.isFinite(timestamp)||now.getTime()-timestamp>=STALE_AFTER_MS;
}

async function readJson(response:Response):Promise<unknown>{
  try{return await response.json();}catch{return null;}
}

async function expectJson(response:Response,fallback:string):Promise<unknown>{
  const body=await readJson(response);
  if(response.ok)return body;
  throw new RecoveryRequestError(recoveryFromResponse(body,response),fallback);
}

function messageForSyncError(code:GradescopeSyncErrorCode):string{
  const safe=getRecoveryNotice(code);if(safe)return safe.message;
  switch(code){
    case "EXTENSION_UNAVAILABLE":return "Firefox extension not detected";
    case "EXTENSION_TIMEOUT":return "Firefox extension timed out.";
    case "GRADESCOPE_TAB_UNAVAILABLE":return "Open Gradescope in Firefox, then try again.";
    case "GRADESCOPE_SIGNED_OUT":return "Sign in to Gradescope, then retry.";
    case "GRADESCOPE_NETWORK_ERROR":return "Gradescope could not be reached. Try again.";
    case "GRADESCOPE_COURSE_UNAVAILABLE":return "A selected Gradescope course is unavailable. Discover courses again.";
    case "GRADESCOPE_PARSE_ERROR":return "Gradescope page data could not be recognized. The connector may need an update.";
    case "PARTIAL_SYNC":return "Some Gradescope courses could not be updated.";
    case "INVALID_RESULT":return "Gradescope returned an invalid result.";
  }
}


function formatDiscoveryDiagnostics(diagnostics:GradescopeDiscoveryDiagnosticsV1):string{
  const headings=diagnostics.headings;
  return [
    "No Gradescope courses were found.",
    "Discovery diagnostics:",
    `root=${diagnostics.accountRootDetected?"yes":"no"}`,
    `createCourse=${diagnostics.createCourseControlDetected?"yes":"no"}`,
    `headings=courses:${headings.courses}/student:${headings.studentCourses}/instructor:${headings.instructorCourses}/other:${headings.other}`,
    `courseLists=${diagnostics.courseListDirectCount} direct/${diagnostics.courseListDescendantCount} total`,
    `terms=${diagnostics.termDescendantCount}`,
    `courseLinks=${diagnostics.courseAnchorDescendantCount} prefix/${diagnostics.courseHrefContainsCount??0} contains`,
    `shortNames=${diagnostics.shortNameNodeCount}`,
    `fullNames=${diagnostics.fullNameNodeCount}`,
    `reactProps=${diagnostics.reactPropsNodeCount??0}`,
  ].join(" ");
}


export function GradescopeProvider({
  connection:initialConnection,
  initialCourses,
  initialSyncState,
  children,
}:{
  connection:SourceConnection|null;
  initialCourses:SourceCourse[];
  initialSyncState:SubmissionStatusSyncState<GradescopeSyncErrorCode>;
  children:ReactNode;
}){
  const router=useRouter();
  const [connection,setConnection]=useState(initialConnection);
  const [courses,setCourses]=useState(initialCourses);
  const [syncState,setSyncState]=useState(initialSyncState);
  const [phase,setPhase]=useState<Phase>("idle");
  const [message,setMessage]=useState("");
  const [recovery,setRecovery]=useState<RecoveryNotice|null>(null);
  const [extensionChecked,setExtensionChecked]=useState(false);
  const blockedUntil=useRef(0);
  const [recoveryOperation,setRecoveryOperation]=useState<GradescopeRecoveryOperation|null>(null);
  const [extensionDetected,setExtensionDetected]=useState(false);
  const [extensionVersion,setExtensionVersion]=useState<string|null>(null);
  const [gradescopeTabDetected,setGradescopeTabDetected]=useState<boolean|null>(null);
  const autoStartedRef=useRef(false);
  const syncInFlightRef=useRef(false);

  const handleFailure=useCallback((error:unknown,operation:GradescopeRecoveryOperation)=>{
    setPhase('error');setRecoveryOperation(operation);
    const notice=error instanceof RecoveryRequestError?error.notice:error instanceof GradescopeBridgeError?getRecoveryNotice(error.code):getRecoveryNotice('SERVICE_UNAVAILABLE');
    setRecovery(notice);
    if(notice?.retryAfterSeconds)blockedUntil.current=Date.now()+notice.retryAfterSeconds*1000;
    if(notice?.key==='SYNC_RECOVERY_REQUIRED')blockedUntil.current=Infinity;
    setMessage(notice?.message??'Gradescope request failed. Previously saved data was kept.');
  },[]);

  const getExtensionInfo=useCallback(async()=>{
    try{
      const info=await pingKairosExtension();
      setExtensionChecked(true);
      setExtensionDetected(true);
      setExtensionVersion(info.extensionVersion);
      setGradescopeTabDetected(info.gradescopeTabDetected);
      return info;
    }catch(error){
      setExtensionChecked(true);
      setExtensionDetected(false);
      setExtensionVersion(null);
      setGradescopeTabDetected(null);
      throw error;
    }
  },[]);

  const discoverCourses=useCallback(async()=>{
    if(Date.now()<blockedUntil.current)return;
    setRecovery(null);setRecoveryOperation(null);
    setPhase("discovering");
    setMessage("");
    try{
      const started=discoveryStartSchema.parse(await expectJson(
        await fetch("/api/sources/gradescope/discover/start",{method:"POST"}),
        "Gradescope discovery could not start.",
      ));
      const info=await getExtensionInfo();
      if(!info.gradescopeTabDetected){
        throw new GradescopeBridgeError("GRADESCOPE_TAB_UNAVAILABLE","Open Gradescope in Firefox, then try again.");
      }
      const result=await discoverGradescopeExtension({
        protocolVersion:1,
        requestId:started.requestId,
      });
      const completed=discoveryCompleteSchema.parse(await expectJson(
        await fetch("/api/sources/gradescope/discover/complete",{
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify(result),
        }),
        "Gradescope course discovery could not be saved.",
      ));
      setConnection(completed.connection);
      setCourses(completed.courses);
      setPhase("success");
      setMessage(
        result.courses.length===0&&result.discoveryDiagnostics
          ?formatDiscoveryDiagnostics(result.discoveryDiagnostics)
          :"",
      );
      router.refresh();
    }catch(error){
      handleFailure(error,"discovery");
    }
  },[getExtensionInfo,router,handleFailure]);

  const saveEnabledCourses=useCallback(async(ids:string[])=>{
    if(Date.now()<blockedUntil.current)return;
    setRecovery(null);setRecoveryOperation(null);
    setMessage("");
    try{
      const completed=selectionResponseSchema.parse(await expectJson(
        await fetch("/api/sources/gradescope/courses",{
          method:"PUT",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({enabledCourseIds:ids}),
        }),
        "Gradescope course selection could not be saved.",
      ));
      setConnection(completed.connection);
      setCourses(completed.courses);
      setPhase("success");
      router.refresh();
    }catch(error){
      handleFailure(error,"selection");
    }
  },[router,handleFailure]);

  const syncNow=useCallback(async(options?:{deferCalendarSync?:boolean})=>{
    if(syncInFlightRef.current||Date.now()<blockedUntil.current||connection?.lastErrorCode==="SYNC_RECOVERY_REQUIRED")return;
    setRecovery(null);setRecoveryOperation(null);
    syncInFlightRef.current=true;
    setPhase("syncing");
    setMessage("");
    try{
      const started=syncStartSchema.parse(await expectJson(
        await fetch("/api/sources/gradescope/sync/start",{method:"POST"}),
        "Gradescope sync could not start.",
      ));
      const batches:GradescopeSyncResultV1[]=[];
      let batchErrorCode:GradescopeSyncErrorCode|null=null;

      try{
        const info=await getExtensionInfo();
        if(!info.gradescopeTabDetected){
          throw new GradescopeBridgeError("GRADESCOPE_TAB_UNAVAILABLE","Open Gradescope in Firefox, then try again.");
        }
        for(let offset=0;offset<started.courseIds.length;offset+=started.maxCourseBatchSize){
          batches.push(await syncGradescopeExtensionBatch({
            protocolVersion:1,
            requestId:started.requestId,
            courseIds:started.courseIds.slice(offset,offset+started.maxCourseBatchSize),
          }));
        }
      }catch(error){
        if(error instanceof GradescopeBridgeError){
          batchErrorCode=error.code;

          if(error.code==="GRADESCOPE_TAB_UNAVAILABLE")setGradescopeTabDetected(false);
          if(error.code==="EXTENSION_UNAVAILABLE")setExtensionDetected(false);
        }else{
          batchErrorCode="INVALID_RESULT";

        }
      }

      const completed=syncCompleteSchema.parse(await expectJson(
        await fetch("/api/sources/gradescope/sync/complete",{
          method:"POST",
          headers:{
            "content-type":"application/json",
            ...(options?.deferCalendarSync?{"x-kairos-calendar-sync":"defer"}:{}),
          },
          body:JSON.stringify({requestId:started.requestId,batches,batchErrorCode}),
        }),
        "Gradescope sync could not be saved.",
      ));
      const nextState:SubmissionStatusSyncState<GradescopeSyncErrorCode>={
        lastAttemptedAt:completed.lastAttemptedAt,
        lastSuccessfulAt:completed.lastSuccessfulAt,
        lastErrorCode:completed.lastErrorCode,
        updatedCount:completed.insertedCount+completed.updatedCount,
        failedCount:completed.failedCourseCount,
      };
      setSyncState(nextState);
      setRecovery(getRecoveryNotice(completed.lastErrorCode,{key:"gradescope"}));
      setRecoveryOperation(completed.lastErrorCode?"sync":null);
      if(completed.lastErrorCode==="PARTIAL_SYNC"){
        setPhase("partial");
        setMessage(messageForSyncError(completed.lastErrorCode));
      }else if(completed.lastErrorCode){
        setPhase("error");
        setMessage(messageForSyncError(completed.lastErrorCode));
      }else{
        setPhase("success");
      }
      if(completed.lastSuccessfulAt&&completed.lastSuccessfulAt!==syncState.lastSuccessfulAt){
        router.refresh();
      }
    }catch(error){
      handleFailure(error,"sync");
    }finally{
      syncInFlightRef.current=false;
    }
  },[getExtensionInfo,router,syncState.lastSuccessfulAt,connection?.lastErrorCode,handleFailure]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      void getExtensionInfo().catch(()=>undefined);
    },0);
    return ()=>window.clearTimeout(timer);
  },[getExtensionInfo]);

  useEffect(()=>{
    const hasEnabledCourse=courses.some(course=>course.enabled);
    if(autoStartedRef.current||!connection?.enabled||!hasEnabledCourse)return;
    if(!isStale(syncState.lastSuccessfulAt)){
      autoStartedRef.current=true;
      return;
    }
    const timer=window.setTimeout(()=>{
      if(autoStartedRef.current)return;
      autoStartedRef.current=true;
      void syncNow();
    },0);
    return ()=>window.clearTimeout(timer);
  },[connection?.enabled,courses,syncNow,syncState.lastSuccessfulAt]);

  return <Context.Provider value={{
    ...syncState,
    connection,
    courses,
    phase,
    extensionDetected,
    extensionVersion,
    gradescopeTabDetected,
    message,recovery,recoveryOperation,extensionChecked,
    discoverCourses,
    saveEnabledCourses,
    syncNow,
  }}>{children}</Context.Provider>;
}

export function useGradescope():GradescopeContextValue{
  const value=useContext(Context);
  if(!value)throw new Error("useGradescope must be used within GradescopeProvider.");
  return value;
}
