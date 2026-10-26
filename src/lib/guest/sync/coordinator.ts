import type {SourceKind} from "@/lib/sources/types";
import type {CanvasAssignmentLocator} from "@/lib/submission-status/types";
import {GuestDataError,type GuestSafeCode} from "../errors";
import type {GuestCredentials} from "../credentials";
import * as limits from "../limits";
import type {GuestClock,GuestCommitChanges,GuestCommitResult,GuestConnection,GuestCourseResult,GuestOperation,GuestRegisteredRequest,GuestRequestFence,GuestRunIdentity,GuestRunLease,GuestRunReport,GuestSnapshot,GuestStage,GuestStageOutcome,GuestStore} from "../types";
import type {GuestTransientClient} from "./transient-client";
import type {GuestBridgeReader} from "./bridge-reader";
import {createGuestRequestRegistry,type GuestRequestRegistry,type GuestValidatedRead} from "./request-registry";
import {createGuestSourceActions} from "./source-actions";

export type GuestCoordinatorOptions={store:GuestStore;bridge:GuestBridgeReader;transient:GuestTransientClient;credentials:GuestCredentials;clock:GuestClock;uuid:()=>string;pageEpoch:string};
export type GuestRunOptions={sources?:SourceKind[];automatic?:boolean};
type Context={lease:GuestRunLease;registry:GuestRequestRegistry;abort:AbortController;operations:number;code:GuestSafeCode|null;extensionTimedOut?:boolean;timer?:unknown;deadline?:unknown;cancel:Set<(code:GuestSafeCode)=>void>};
const stages:GuestStage[]=["canvas-feed","canvas-status","gradescope","ed"];
const sourceOf=(stage:GuestOperation):SourceKind=>stage.startsWith("canvas")?"canvas":stage.startsWith("gradescope")?"gradescope":"ed";
const safeCode=(error:unknown):GuestSafeCode=>error instanceof GuestDataError?error.code:"INVALID_RESULT";
const haltsQueue=(code:GuestSafeCode)=>["RATE_LIMITED","ED_RATE_LIMITED","EXTENSION_TIMEOUT","GUEST_RUN_TIMEOUT","GUEST_RUN_LIMIT","GUEST_SUPERSEDED","GUEST_INTERRUPTED"].includes(code);
const emptyMembers=():GuestRegisteredRequest["members"]=>({canvas:[],courseIds:[]});
function ordered(keys:string[],resume:string[]):string[]{return [...new Set([...resume.filter(k=>keys.includes(k)),...keys])];}
function identity(run:GuestRunIdentity):GuestRunIdentity {return {datasetId:run.datasetId,runId:run.runId,pageEpoch:run.pageEpoch,generation:run.generation};}

export function createGuestSyncCoordinator(options:GuestCoordinatorOptions) {
  const {store,bridge,transient,credentials,clock,uuid,pageEpoch}=options;
  let active:Context|null=null,acquiring=false,stopEpoch=0;
  const stamp=()=>new Date(clock.now()).toISOString();
  function cancel(ctx:Context,code:GuestSafeCode){
    ctx.code??=code;ctx.registry.invalidateRun(ctx.lease.runId);ctx.abort.abort();
    for(const reject of ctx.cancel)reject(ctx.code);
  }
  function check(ctx:Context){
    if(clock.now()>=ctx.lease.deadlineAtMs)cancel(ctx,"GUEST_RUN_TIMEOUT");
    if(ctx.code)throw new GuestDataError(ctx.code);
  }
  async function acquire():Promise<Context|null>{
    if(active||acquiring)return null;
    acquiring=true;
    const epoch=stopEpoch;
    try{
      const lease=await store.beginRun({pageEpoch,nowMs:clock.now(),deadlineAtMs:clock.now()+limits.GUEST_RUN_DEADLINE_MS});
      if(!lease)return null;
      if(epoch!==stopEpoch){await store.invalidateRun(lease);throw new GuestDataError("GUEST_INTERRUPTED");}
      const ctx:Context={lease,registry:createGuestRequestRegistry({now:clock.now}),abort:new AbortController(),operations:0,code:null,cancel:new Set()};
      active=ctx;
      const renew=async()=>{
        try{check(ctx);if(!await store.renewRun(lease,clock.now()))cancel(ctx,"GUEST_SUPERSEDED");}
        catch(error){cancel(ctx,safeCode(error));}
        if(!ctx.code&&active===ctx)ctx.timer=clock.setTimeout(()=>{void renew();},limits.GUEST_LEASE_RENEW_MS);
      };
      ctx.timer=clock.setTimeout(()=>{void renew();},limits.GUEST_LEASE_RENEW_MS);
      ctx.deadline=clock.setTimeout(()=>cancel(ctx,"GUEST_RUN_TIMEOUT"),Math.max(0,lease.deadlineAtMs-clock.now()));
      return ctx;
    }finally{acquiring=false;}
  }
  async function finish(ctx:Context){
    ctx.registry.invalidateRun(ctx.lease.runId);ctx.abort.abort();clock.clearTimeout(ctx.timer);clock.clearTimeout(ctx.deadline);
    try{await store.releaseRun(ctx.lease);}finally{if(active===ctx)active=null;}
  }
  function fence(ctx:Context,connection:GuestConnection|null,operation:GuestOperation,final=false):GuestRequestFence{
    const wait=operation==="canvas-status"||operation.startsWith("gradescope")?limits.GUEST_EXTENSION_WAIT_MS:limits.GUEST_SOURCE_DEADLINE_MS;
    return {...identity(ctx.lease),requestId:uuid(),operation,source:sourceOf(operation),purpose:connection?"read":"setup",connectionId:connection?.id??null,connectionGeneration:connection?.generation??null,deadlineAtMs:final?ctx.lease.deadlineAtMs:Math.min(ctx.lease.deadlineAtMs,clock.now()+wait)};
  }
  async function dispatch(ctx:Context,connection:GuestConnection|null,operation:GuestOperation,members:GuestRegisteredRequest["members"],secret?:string):Promise<{read:GuestValidatedRead;fence:GuestRequestFence}>{
    check(ctx);if(ctx.operations>=limits.GUEST_MAX_DISPATCHED_OPERATIONS)throw new GuestDataError("GUEST_RUN_LIMIT");
    const extension=operation==="canvas-status"||operation.startsWith("gradescope");
    if(extension&&ctx.extensionTimedOut)throw new GuestDataError("EXTENSION_TIMEOUT");
    const request=fence(ctx,connection,operation),registration={fence:request,members};
    if(!await store.registerRequest(registration,clock.now()))throw new GuestDataError("GUEST_SUPERSEDED");
    check(ctx);if(!ctx.registry.register(registration))throw new GuestDataError("GUEST_SUPERSEDED");
    const controller=new AbortController(),abort=()=>controller.abort();ctx.abort.signal.addEventListener("abort",abort,{once:true});
    const requestId=request.requestId,signal=controller.signal,wait=request.deadlineAtMs-clock.now();
    check(ctx);ctx.operations++;
    let timeout:unknown,rejectPending:(code:GuestSafeCode)=>void=()=>{};
    const failure=new Promise<never>((_,reject)=>{rejectPending=code=>reject(new GuestDataError(code));ctx.cancel.add(rejectPending);timeout=clock.setTimeout(()=>{controller.abort();rejectPending(extension?"EXTENSION_TIMEOUT":"GUEST_RUN_TIMEOUT");},wait);});
    try{
      let pending:Promise<unknown>;
      switch(operation){
        case "canvas-feed":pending=transient.canvasFeed({schemaVersion:1,requestId,feedUrl:secret!},signal);break;
        case "canvas-status":pending=bridge.canvas({protocolVersion:1,requestId,assignments:members.canvas},wait);break;
        case "gradescope-discovery":pending=bridge.gradescopeDiscover({protocolVersion:1,requestId},wait);break;
        case "gradescope":pending=bridge.gradescopeSync({protocolVersion:1,requestId,courseIds:members.courseIds},wait);break;
        case "ed-courses":pending=transient.edCourses({schemaVersion:1,requestId,token:secret!},signal);break;
        case "ed":pending=transient.edLessons({schemaVersion:1,requestId,token:secret!,courseId:members.courseIds[0]},signal);break;
      }
      const value=await Promise.race([pending,failure]);check(ctx);
      const read=ctx.registry.accept(requestId,value,clock.now());if(!read)throw new GuestDataError("GUEST_SUPERSEDED");
      return {read,fence:request};
    }catch(error){if(extension&&safeCode(error)==="EXTENSION_TIMEOUT")ctx.extensionTimedOut=true;throw error;}
    finally{clock.clearTimeout(timeout);ctx.cancel.delete(rejectPending);ctx.abort.signal.removeEventListener("abort",abort);}
  }
  async function commit(ctx:Context,request:GuestRequestFence,changes:GuestCommitChanges):Promise<Extract<GuestCommitResult,{status:"accepted"}>>{
    check(ctx);const result=await store.commit(request,changes,clock.now());
    if(result.status!=="accepted")throw new GuestDataError(result.reason==="expired"?"GUEST_RUN_TIMEOUT":"GUEST_SUPERSEDED");
    return result;
  }
  function convert(read:GuestValidatedRead,snapshot:GuestSnapshot,c:GuestConnection,stage:GuestStage,keys:string[],remainingKeys:string[]):GuestCourseResult{
    const result:GuestCourseResult={sourceConnectionId:c.id,connectionGeneration:c.generation,stage,externalCourseId:stage==="ed"||stage==="gradescope"?keys[0]:null,checkedAt:stamp(),assignments:[],statuses:[],courseSucceeded:false,failedCount:0,code:null,remainingKeys};
    if(read.operation==="canvas-feed"){
      result.checkedAt=read.result.checkedAt;result.assignments=read.result.assignments;result.courseSucceeded=true;result.failedCount=read.result.report.malformedCount;result.code=read.result.report.partial?"PARTIAL_SYNC":null;
    }else if(read.operation==="canvas-status"){
      const rows=read.result.results;
      for(const key of keys){
        const assignment=snapshot.assignments.find(a=>a.sourceConnectionId===c.id&&a.externalId===key)!;
        const row=rows.find(r=>r.assignmentLocalId===assignment.id);
        if(!row||row.errorCode){result.failedCount++;result.code??=row?.errorCode??read.result.errorCode??"INVALID_RESULT";continue;}
        const {state,isLate,isMissing,submittedAt,checkedAt,extractorVersion}=row;
        result.statuses.push({externalId:key,state,isLate,isMissing,submittedAt,checkedAt,extractorVersion,errorCode:null});
      }
      result.courseSucceeded=result.statuses.length>0;
    }else if(read.operation==="ed"){
      const course=snapshot.courses.find(row=>row.sourceConnectionId===c.id&&row.externalCourseId===read.result.courseId)!;
      result.checkedAt=read.result.checkedAt;result.assignments=read.result.lessons.map(row=>({...row,courseName:course.shortName??course.fullName}));result.courseSucceeded=true;
    }else if(read.operation==="gradescope"){
      const course=snapshot.courses.find(row=>row.sourceConnectionId===c.id&&row.externalCourseId===keys[0])!;
      const row=read.result.courses.find(row=>row.courseId===keys[0]);
      result.code=row?.errorCode??read.result.errorCode??(row?null:"INVALID_RESULT");
      if(result.code){result.failedCount=1;return result;}
      result.checkedAt=row!.checkedAt;result.courseSucceeded=true;
      for(const a of row!.assignments){
        const externalId=`${a.courseId}:${a.assignmentId}`;
        result.assignments.push({source:"gradescope",externalId,courseId:a.courseId,courseName:course.shortName??course.fullName,title:a.title,releaseAt:a.releaseAt,dueAt:a.dueAt,lateDueAt:a.lateDueAt,status:a.state==="graded"?"graded":(a.state==="submitted"||a.state==="excused")?"submitted":a.state==="not_submitted"?"pending":"unknown",sourceStatusText:a.sourceStatusText,gradeScore:a.gradeScore,gradeMax:a.gradeMax,gradeDisplay:a.gradeDisplay,sourceUrl:`https://www.gradescope.com/courses/${a.courseId}/assignments/${a.assignmentId}`,sourceUpdatedAt:null});
        result.statuses.push({externalId,state:a.state,isLate:a.isLate,isMissing:a.isMissing,submittedAt:a.submittedAt,checkedAt:a.checkedAt,extractorVersion:a.extractorVersion,errorCode:null});
      }
    }else throw new GuestDataError("INVALID_RESULT");
    return result;
  }
  async function stageRun(ctx:Context,stage:GuestStage,automatic:boolean):Promise<GuestStageOutcome>{
    const outcome:GuestStageOutcome={runId:ctx.lease.runId,stage,status:"skipped",code:null,updatedCount:0,failedCount:0,ignoredCount:0,pendingCount:0,attemptedAt:stamp(),completedAt:stamp()};
    let snapshot=await store.read();const c=snapshot.connections.find(c=>c.kind===sourceOf(stage)&&c.enabled);
    let remaining:string[]=[],successful=false,marked=false;
    try{
      if(!c){check(ctx);outcome.code="GUEST_NOT_CONNECTED";return outcome;}
      if(automatic&&(stage==="canvas-feed"||stage==="ed"||stage==="canvas-status"&&!snapshot.preferences.automaticCanvas||stage==="gradescope"&&!snapshot.preferences.automaticGradescope))return outcome;
      const locators=new Map<string,CanvasAssignmentLocator>();
      if(stage==="canvas-status")for(const a of snapshot.assignments.filter(a=>a.sourceConnectionId===c.id)){
        const match=a.sourceUrl?.match(/^https:\/\/canvas\.uw\.edu\/courses\/(\d+)\/assignments\/(\d+)$/);
        if(match&&(a.courseId===null||a.courseId===match[1]))locators.set(a.externalId,{assignmentLocalId:a.id,courseId:match[1],assignmentId:match[2]});
      }
      const keys=stage==="canvas-feed"?["feed"]:stage==="canvas-status"?[...locators.keys()]:snapshot.courses.filter(row=>row.sourceConnectionId===c.id&&row.enabled).map(row=>row.externalCourseId);
      remaining=ordered(keys,snapshot.syncStates.find(s=>s.sourceConnectionId===c.id&&s.stage===stage)?.resumeKeys??[]);
      check(ctx);
      marked=await store.markStageAttempt(ctx.lease,c.id,c.generation,stage,outcome.attemptedAt);if(!marked)throw new GuestDataError("GUEST_SUPERSEDED");
      if(!remaining.length){outcome.code=stage==="canvas-status"?"GUEST_NO_ASSIGNMENTS":"GUEST_NO_COURSES";return outcome;}
      const secret=stage==="canvas-feed"||stage==="ed"?await credentials.get(c.id,c.generation):undefined;
      if(secret===null){outcome.code="GUEST_CREDENTIAL_REQUIRED";return outcome;}
      while(remaining.length){
        check(ctx);if(ctx.operations>=limits.GUEST_MAX_DISPATCHED_OPERATIONS)throw new GuestDataError("GUEST_RUN_LIMIT");
        const batch=remaining.slice(0,stage==="canvas-status"?limits.GUEST_CANVAS_BATCH_SIZE:1),rest=remaining.slice(batch.length);
        const members=stage==="canvas-status"?{canvas:batch.map(key=>locators.get(key)!),courseIds:[]}:stage==="ed"||stage==="gradescope"?{canvas:[],courseIds:batch}:emptyMembers();
        let dispatched=false;
        try{
          const before=ctx.operations;
          let response:Awaited<ReturnType<typeof dispatch>>;
          try{response=await dispatch(ctx,c,stage,members,secret??undefined);}finally{dispatched=ctx.operations>before;if(dispatched)remaining=rest;}
          const converted=convert(response.read,snapshot,c,stage,batch,stage==="canvas-feed"?[]:rest);
          const saved=await commit(ctx,response.fence,{kind:"course-result",result:converted});snapshot=saved.snapshot;
          outcome.updatedCount+=saved.updatedCount;outcome.ignoredCount+=saved.ignoredCount;outcome.failedCount+=converted.failedCount;
          successful=snapshot.syncStates.find(s=>s.sourceConnectionId===c.id&&s.stage===stage)?.hasSuccessfulCheck===true;
          outcome.code=converted.code??outcome.code;
          if(converted.code&&haltsQueue(converted.code))break;
        }catch(error){
          outcome.code=safeCode(error);if(dispatched)outcome.failedCount+=stage==="canvas-status"?batch.length:1;
          if(!dispatched||haltsQueue(outcome.code))break;
        }
      }
    }catch(error){outcome.code=safeCode(error);}
    finally{
      outcome.pendingCount=remaining.length;outcome.completedAt=stamp();
      if(successful)outcome.status=outcome.failedCount||remaining.length||outcome.code?"partial":"success";
      else if(outcome.code==="GUEST_INTERRUPTED"||outcome.code==="GUEST_SUPERSEDED")outcome.status="cancelled";
      else if(outcome.code==="GUEST_RUN_TIMEOUT"||outcome.code==="EXTENSION_TIMEOUT")outcome.status="timed-out";
      else if(outcome.failedCount||outcome.code&&!["GUEST_NOT_CONNECTED","GUEST_NO_COURSES","GUEST_NO_ASSIGNMENTS","GUEST_CREDENTIAL_REQUIRED"].includes(outcome.code))outcome.status="failed";
      if(marked&&c&&!ctx.code&&clock.now()<ctx.lease.deadlineAtMs){
        try{
          const request=fence(ctx,c,stage,true);
          if(await store.registerRequest({fence:request,members:emptyMembers(),intent:"stage-result"},clock.now()))await commit(ctx,request,{kind:"stage-result",outcome,remainingKeys:stage==="canvas-feed"?[]:remaining});
          else {outcome.code="GUEST_SUPERSEDED";outcome.status=successful?"partial":"cancelled";}
        }catch(error){outcome.code=safeCode(error);outcome.status=successful?"partial":"failed";}
      }
    }
    return outcome;
  }
  return {
    ...createGuestSourceActions({store,credentials,uuid,now:clock.now,async read(source,connection,secret,changes){
      const ctx=await acquire();if(!ctx)throw new GuestDataError("GUEST_BUSY");
      try{
        const operation=source==="canvas"?"canvas-feed":source==="ed"?"ed-courses":"gradescope-discovery";
        const response=await dispatch(ctx,connection,operation,emptyMembers(),secret);
        return await commit(ctx,response.fence,changes(response.read));
      }finally{await finish(ctx);}
    }}),
    async run(input:GuestRunOptions={}):Promise<GuestRunReport>{
      const selected=stages.filter(stage=>!input.sources||input.sources.includes(sourceOf(stage)));
      let ctx:Context|null=null,earlyCode:GuestSafeCode="GUEST_BUSY";
      try{ctx=await acquire();}catch(error){earlyCode=safeCode(error);}
      if(!ctx){
        const {datasetId}=await store.getIdentity(),run={datasetId,runId:uuid(),pageEpoch,generation:0};
        return {run,mode:input.automatic?"automatic":"manual",outcomes:selected.map(stage=>({runId:run.runId,stage,status:earlyCode==="GUEST_INTERRUPTED"?"cancelled":"skipped",code:earlyCode,updatedCount:0,failedCount:0,ignoredCount:0,pendingCount:0,attemptedAt:stamp(),completedAt:stamp()}))};
      }
      try{const outcomes:GuestStageOutcome[]=[];for(const stage of selected)outcomes.push(await stageRun(ctx,stage,!!input.automatic));return {run:identity(ctx.lease),mode:input.automatic?"automatic":"manual",outcomes};}
      finally{await finish(ctx);}
    },
    stop(){stopEpoch++;if(active){const ctx=active;cancel(ctx,"GUEST_INTERRUPTED");void store.invalidateRun(ctx.lease).catch(()=>{});}},
  };
}
