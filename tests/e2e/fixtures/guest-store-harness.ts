import {openGuestStore} from "../../../src/lib/guest/store";
import {parseGuestBackup,serializeGuestBackup} from "../../../src/lib/guest/backup";
import type {GuestCommitChanges,GuestRequestFence,GuestRunLease,GuestStage,GuestStore,GuestSnapshot} from "../../../src/lib/guest/types";

declare global {interface ImportMetaEnv {readonly KAIROS_GUEST_STORAGE_TEST:boolean;}}
if(!import.meta.env.KAIROS_GUEST_STORAGE_TEST || !["127.0.0.1","localhost","[::1]"].includes(location.hostname))throw Error("Loopback test fixture only");
let time=Date.parse("2026-10-24T12:00:00.000Z");
const now=()=>time;
const stamp=()=>new Date(time).toISOString();
const names=(name:string)=>`f3-${name}`;
const assignment={source:"canvas" as const,externalId:"event-1",courseId:"12",courseName:"Math",title:"Homework",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://canvas.uw.edu/courses/12/assignments/34",sourceUpdatedAt:null};
async function run(store:GuestStore){const value=await store.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+180000});if(!value)throw Error("busy");return value;}
async function request(store:GuestStore,lease:GuestRunLease,connection:GuestSnapshot["connections"][number]|null=null){
  const fence:GuestRequestFence={datasetId:lease.datasetId,runId:lease.runId,pageEpoch:lease.pageEpoch,generation:lease.generation,requestId:crypto.randomUUID(),source:"canvas",operation:"canvas-feed",purpose:connection?"read":"setup",connectionId:connection?.id??null,connectionGeneration:connection?.generation??null,deadlineAtMs:time+15000};
  if(!await store.registerRequest({fence,members:{canvas:[],courseIds:[]}},time))throw Error("registration rejected");
  return fence;
}
const connect=():GuestCommitChanges=>({kind:"connect",connection:{id:crypto.randomUUID(),kind:"canvas",enabled:true,generation:1,createdAt:stamp(),updatedAt:stamp()},courses:[],assignments:[assignment],secret:{value:"remembered-secret",remember:true}});
function course(snapshot:GuestSnapshot):GuestCommitChanges{return {kind:"course-result",result:{sourceConnectionId:snapshot.connections[0].id,connectionGeneration:snapshot.connections[0].generation,stage:"canvas-feed",externalCourseId:null,checkedAt:stamp(),assignments:[],statuses:[],courseSucceeded:true,failedCount:0,code:null,remainingKeys:[]}};}
async function raw(name:string,write?:(tx:IDBTransaction)=>void){
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(names(name));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{
    const result:Record<string,unknown[]>={};const tx=db.transaction(Array.from(db.objectStoreNames),write?"readwrite":"readonly");
    if(write)write(tx);
    for(const key of Array.from(db.objectStoreNames)){const q=tx.objectStore(key).getAll();q.onsuccess=()=>{result[key]=q.result;};}
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export async function seed(name:string){const store=await openGuestStore({name:names(name),now});const lease=await run(store);const fence=await request(store,lease);const result=await store.commit(fence,connect(),time);if(result.status!=="accepted")throw Error("setup rejected");await store.releaseRun(lease);store.close();return result.snapshot;}
export async function storageChecks(name:string){
  const store=await openGuestStore({name:names(name),now});const persisted=await store.read();const c=persisted.connections[0];
  const remembered=await store.readRememberedSecret(c.id);const beforeQuotaAbort=await raw(name);
  const original=IDBObjectStore.prototype.put;let puts=0;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(++puts===3)throw new DOMException("injected","QuotaExceededError");return original.apply(this,args);};
  try{await store.savePreferences({sort:"status"},persisted.datasetId);throw Error("expected quota failure");}catch(e){if(!(e instanceof Error)||e.message==="expected quota failure")throw e;}finally{IDBObjectStore.prototype.put=original;}
  const afterQuotaAbort=await raw(name);
  const afterForget=await store.forgetCredential(c.id,c.generation);const forgotten=await store.readRememberedSecret(c.id);
  const lease=await run(store),fence=await request(store,lease,afterForget.connections[0]);
  const accepted=await store.commit(fence,{kind:"credential",secret:{value:"new-secret",remember:false}},time);if(accepted.status!=="accepted")throw Error("reentry rejected");
  const reentered=accepted.snapshot;
  const failed=await request(store,lease,reentered.connections[0]);
  try{await store.commit(failed,{kind:"credential",secret:{value:"",remember:true}},time);}catch{}
  const failedCredentialUnchanged=JSON.stringify(await store.read())===JSON.stringify(reentered);
  const identityBeforeCorruption=await store.getIdentity();
  await raw(name,tx=>{tx.objectStore("assignments").put({...persisted.assignments[0],title:123});});
  const corruptIdentity=await store.getIdentity();const reset=await store.clear(corruptIdentity.datasetId);store.close();
  return {persisted,beforeQuotaAbort,afterQuotaAbort,remembered,afterForget,forgotten,reentered,failedCredentialUnchanged,corruptIdentity,identityBeforeCorruption,reset};
}
export async function concurrencyChecks(){
  const name="concurrency";await seed(name);const a=await openGuestStore({name:names(name),now}),b=await openGuestStore({name:names(name),now});
  const acquisitions=await Promise.all([a.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+180000}),b.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+180000})]);
  const oldOwner=acquisitions.find(Boolean)!;let snapshot=await a.read();const old=await request(a,oldOwner,snapshot.connections[0]);
  time+=30001;const newOwner=await run(b);await a.releaseRun(oldOwner);const state=await raw(name);const afterOldRelease=state.metadata[0] as {lease:GuestRunLease};
  const staleCommit=await a.commit(old,course(snapshot),time);
  const live=await request(b,newOwner,snapshot.connections[0]);time+=1000;await b.renewRun(newOwner,time);
  const accepted=await b.commit(live,course(snapshot),time);const duplicate=await b.commit(live,course(snapshot),time);
  snapshot=await b.read();const successFlag=snapshot.syncStates[0].hasSuccessfulCheck;
  await b.markStageAttempt(newOwner,snapshot.connections[0].id,snapshot.connections[0].generation,"canvas-feed",stamp());const resetFlag=(await b.read()).syncStates[0].hasSuccessfulCheck;
  const late=await request(b,newOwner,snapshot.connections[0]);const invocation=time;time+=15001;const expired=await b.commit(late,course(snapshot),invocation);
  await b.releaseRun(newOwner);const queuedOwner=await run(b),queued=await request(b,queuedOwner,snapshot.connections[0]);
  const queuedAt=time;let waiting:ReturnType<GuestStore["commit"]>|undefined;
  await raw(name,tx=>{const q=tx.objectStore("metadata").get("identity");q.onsuccess=()=>{waiting=b.commit(queued,course(snapshot),queuedAt);time+=31000;};});
  const queuedExpired=(await waiting)!;
  time-=100000;const rollbackOwner=await run(a);await a.releaseRun(rollbackOwner);
  const invalidated=[];
  for(const action of ["forget","disconnect","clear","import"]){
    if(!(await a.read()).connections.length){const setup=await run(a);await a.commit(await request(a,setup),connect(),time);await a.releaseRun(setup);}
    snapshot=await a.read();const lease=await run(a),fence=await request(a,lease,snapshot.connections[0]);
    if(action==="forget")await a.forgetCredential(snapshot.connections[0].id,snapshot.connections[0].generation);
    if(action==="disconnect")await a.disconnect(snapshot.connections[0].id,snapshot.connections[0].generation);
    if(action==="clear")await a.clear(snapshot.datasetId);
    if(action==="import")await a.replaceDataset(parseGuestBackup(serializeGuestBackup(snapshot,stamp())),snapshot.datasetId);
    invalidated.push(await a.commit(fence,course(snapshot),time));await a.releaseRun(lease);
  }
  const imported=await raw(name);a.close();b.close();
  return {acquisitions,oldOwner,newOwner,afterOldRelease,staleCommit,accepted,duplicate,expired,queuedExpired,rollbackOwner,invalidated,imported,successFlag,resetFlag};
}

export async function membershipChecks(){
  const name="membership",store=await openGuestStore({name:names(name),now});let lease=await run(store);
  function fence(connection:GuestSnapshot["connections"][number]|null,operation:GuestRequestFence["operation"]):GuestRequestFence {
    return {datasetId:lease.datasetId,runId:lease.runId,pageEpoch:lease.pageEpoch,generation:lease.generation,requestId:crypto.randomUUID(),source:"ed",operation,purpose:connection?"read":"setup",connectionId:connection?.id??null,connectionGeneration:connection?.generation??null,deadlineAtMs:time+15000};
  }
  const setup=fence(null,"ed-courses");await store.registerRequest({fence:setup,members:{canvas:[],courseIds:[]}},time);
  const connected=await store.commit(setup,{kind:"connect",connection:{id:crypto.randomUUID(),kind:"ed",enabled:true,generation:1,createdAt:stamp(),updatedAt:stamp()},courses:[{externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null},{externalCourseId:"13",shortName:null,fullName:"Science",term:null,year:null}],assignments:[],secret:{value:"ed-secret",remember:true}},time);
  if(connected.status!=="accepted")throw Error("setup rejected");const discovery=await store.read(),c=discovery.connections[0];
  const selection=await store.setEnabledCourses(c.id,["12"],c.generation);const noop=await store.setEnabledCourses(c.id,["12"],selection.connections[0].generation);
  let invalidSelection=false;try{await store.setEnabledCourses(c.id,[selection.courses[0].id],selection.connections[0].generation);}catch{invalidSelection=true;}
  let invalidMembership=false;try{await store.registerRequest({fence:fence(selection.connections[0],"ed"),members:{canvas:[],courseIds:["13"]}},time);}catch{invalidMembership=true;}
  const read=fence(selection.connections[0],"ed");await store.registerRequest({fence:read,members:{canvas:[],courseIds:["12"]}},time);
  const result:GuestCommitChanges={kind:"course-result",result:{sourceConnectionId:c.id,connectionGeneration:selection.connections[0].generation,stage:"ed",externalCourseId:"12",checkedAt:stamp(),assignments:[],statuses:[],courseSucceeded:true,failedCount:0,code:null,remainingKeys:["13"]}};
  const beforeRejected=await raw(name);try{await store.commit(read,{...result,result:{...result.result,externalCourseId:"13"}},time);throw Error("accepted foreign course");}catch(e){if(e instanceof Error&&e.message==="accepted foreign course")throw e;}
  const afterRejected=await raw(name),beforeAbort=await raw(name);
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="requests")throw new DOMException("injected","QuotaExceededError");return original.apply(this,args);};
  try{await store.commit(read,result,time);throw Error("expected abort");}catch(e){if(e instanceof Error&&e.message==="expected abort")throw e;}finally{IDBObjectStore.prototype.put=original;}
  const afterAbort=await raw(name);
  // Abort the real native transaction after its request-consumption write was queued.
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){const request=original.apply(this,args);if(this.name==="requests")this.transaction.abort();return request;};
  let nativeAborted=false;
  try{await store.commit(read,result,time);}catch{nativeAborted=true;}finally{IDBObjectStore.prototype.put=original;}
  const afterNativeAbort=await raw(name),accepted=await store.commit(read,result,time);
  async function terminal(status:"partial"|"failed",code:"ED_NETWORK_ERROR"|null,updatedCount:number,failedCount:number,pendingCount:number){
    const request=fence(selection.connections[0],"ed");await store.registerRequest({fence:request,members:{canvas:[],courseIds:[]},intent:"stage-result"},time);
    await store.commit(request,{kind:"stage-result",outcome:{runId:lease.runId,stage:"ed",status,code,updatedCount,failedCount,ignoredCount:0,pendingCount,attemptedAt:stamp(),completedAt:stamp()},remainingKeys:[]},time);
    return store.read();
  }
  const terminalResult=await terminal("partial",null,7,0,1);
  await store.releaseRun(lease);lease=await run(store);
  await store.markStageAttempt(lease,c.id,selection.connections[0].generation,"ed",stamp());
  const failedAttempt=await terminal("failed","ED_NETWORK_ERROR",0,1,0);
  await store.releaseRun(lease);lease=await run(store);
  for(let i=0;i<100;i++)if(!await store.registerRequest({fence:fence(selection.connections[0],"ed"),members:{canvas:[],courseIds:["12"]}},time))throw Error("early limit");
  const overLimit=await store.registerRequest({fence:fence(selection.connections[0],"ed"),members:{canvas:[],courseIds:["12"]}},time);
  const internal=await raw(name),requestCount=internal.requests.length,privateRequestLeak=JSON.stringify(internal.requests).includes("ed-secret");
  await raw(name,tx=>{tx.objectStore("metadata").put({broken:true},"identity");});const beforeCorruptReset=await raw(name);
  let corruptMetadataFailed=false;try{await store.clear(selection.datasetId);}catch{corruptMetadataFailed=true;}
  const afterCorruptReset=await raw(name);store.close();
  return {discovery,selection,noop,invalidSelection,invalidMembership,beforeRejected,afterRejected,beforeAbort,afterAbort,nativeAborted,afterNativeAbort,accepted,terminal:terminalResult,failedAttempt,requestCount,overLimit,privateRequestLeak,corruptMetadataFailed,beforeCorruptReset,afterCorruptReset};
}

export async function defaultChecks(){
  const original=Intl.DateTimeFormat.prototype.resolvedOptions;
  const results=[];
  try{
    for(const zone of ["Asia/Tokyo","Invalid/Zone",null]){
      Intl.DateTimeFormat.prototype.resolvedOptions=function(){if(zone===null)throw Error("unavailable");return {...original.call(this),timeZone:zone};};
      const store=await openGuestStore({name:names(`defaults-${zone}`),now});
      const initial=await store.read();
      await store.savePreferences({timeZone:"UTC",automaticCanvas:false,automaticGradescope:false},initial.datasetId);
      const reset=await store.clear(initial.datasetId);store.close();results.push({initial,reset});
    }
  }finally{Intl.DateTimeFormat.prototype.resolvedOptions=original;}
  return results;
}
function operationFence(lease:GuestRunLease,connection:GuestSnapshot["connections"][number]|null,operation:GuestRequestFence["operation"],duration=15000):GuestRequestFence {
  const source=operation.startsWith("canvas")?"canvas":operation.startsWith("gradescope")?"gradescope":"ed";
  return {datasetId:lease.datasetId,runId:lease.runId,pageEpoch:lease.pageEpoch,generation:lease.generation,requestId:crypto.randomUUID(),source,operation,purpose:connection?"read":"setup",connectionId:connection?.id??null,connectionGeneration:connection?.generation??null,deadlineAtMs:time+duration};
}
const noMembers=()=>({canvas:[],courseIds:[]});
async function allSources(name:string){
  await seed(name);const store=await openGuestStore({name:names(name),now}),lease=await run(store);
  for(const source of ["gradescope","ed"] as const){
    const fence=operationFence(lease,null,source==="ed"?"ed-courses":"gradescope-discovery");
    if(!await store.registerRequest({fence,members:noMembers()},time))throw Error("discovery registration rejected");
    const result=await store.commit(fence,{kind:"connect",connection:{id:crypto.randomUUID(),kind:source,enabled:true,generation:1,createdAt:stamp(),updatedAt:stamp()},courses:[],assignments:[],secret:null},time);
    if(result.status!=="accepted")throw Error("discovery rejected");
  }
  await store.releaseRun(lease);return store;
}
function statusChange(snapshot:GuestSnapshot):GuestCommitChanges {
  const c=snapshot.connections.find(c=>c.kind==="canvas")!;
  return {kind:"course-result",result:{sourceConnectionId:c.id,connectionGeneration:c.generation,stage:"canvas-status",externalCourseId:null,checkedAt:stamp(),assignments:[],statuses:[{externalId:assignment.externalId,errorCode:null,state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:stamp(),extractorVersion:"test"}],courseSucceeded:true,failedCount:0,code:null,remainingKeys:[]}};
}
export async function deadlineChecks(){
  const store=await allSources("deadlines"),snapshot=await store.read(),lease=await run(store);
  const registrations:Partial<Record<GuestRequestFence["operation"],boolean>>={},oversized=[];
  let statusFence:GuestRequestFence|undefined;
  const operations=["canvas-feed","canvas-status","gradescope","gradescope-discovery","ed","ed-courses"] as const;
  for(const operation of operations){
    const source=operation.startsWith("canvas")?"canvas":operation.startsWith("gradescope")?"gradescope":"ed";
    const connection=snapshot.connections.find(c=>c.kind===source)!;
    const fence=operationFence(lease,connection,operation,30000);
    const members=operation==="canvas-status"?{canvas:[{assignmentLocalId:snapshot.assignments[0].id,courseId:"12",assignmentId:"34"}],courseIds:[]}:noMembers();
    registrations[operation]=await store.registerRequest({fence,members},time);
    if(operation==="canvas-status"&&registrations[operation])statusFence=fence;
    oversized.push(await store.registerRequest({fence:operationFence(lease,connection,operation,source==="gradescope"||operation==="canvas-status"?30001:15001),members},time));
  }
  const canvas=snapshot.connections.find(c=>c.kind==="canvas")!;
  const server=operationFence(lease,canvas,"canvas-feed");await store.registerRequest({fence:server,members:noMembers()},time);
  time+=10000;await store.renewRun(lease,time);time+=10000;await store.renewRun(lease,time);
  const extensionReply=statusFence?await store.commit(statusFence,statusChange(snapshot),time):null;
  const serverExpired=await store.commit(server,course({...snapshot,connections:[canvas]}),time);
  await store.releaseRun(lease);
  const short=await store.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+10000});if(!short)throw Error("short run rejected");
  const beyondRunDeadline=await store.registerRequest({fence:operationFence(short,canvas,"canvas-status",10001),members:noMembers()},time);
  store.close();return {registrations,oversized,extensionReply,serverExpired,beyondRunDeadline};
}
function terminalChange(lease:GuestRunLease,stage:GuestStage):GuestCommitChanges {
  return {kind:"stage-result",outcome:{runId:lease.runId,stage,status:"partial",code:"GUEST_RUN_LIMIT",updatedCount:0,failedCount:0,ignoredCount:0,pendingCount:1,attemptedAt:stamp(),completedAt:stamp()},remainingKeys:[]};
}
async function acceptedCommit(store:GuestStore,fence:GuestRequestFence,changes:GuestCommitChanges){try{return (await store.commit(fence,changes,time)).status==="accepted";}catch{return false;}}
export async function finalizationChecks(){
  const name="finalizers",store=await allSources(name),snapshot=await store.read(),lease=await run(store);
  const canvas=snapshot.connections.find(c=>c.kind==="canvas")!,stages=["canvas-feed","canvas-status","gradescope","ed"] as const;
  let first:GuestRequestFence|undefined;
  for(let i=0;i<100;i++){
    const fence=operationFence(lease,canvas,"canvas-feed");if(!await store.registerRequest({fence,members:noMembers()},time))throw Error("provider capacity reduced");
    if(i===0)first=fence;
  }
  const providerCount=(await raw(name)).requests.length;
  const wrongIntentAccepted=await acceptedCommit(store,first!,terminalChange(lease,"canvas-feed"));
  const provider101=await store.registerRequest({fence:operationFence(lease,canvas,"canvas-feed"),members:noMembers()},time);
  const finalizers=[],commits=[],duplicates=[];
  let wrongFinalizerAccepted=false,mismatchedStageAccepted=false;
  for(const stage of stages){
    const connection=snapshot.connections.find(c=>c.kind===(stage.startsWith("canvas")?"canvas":stage))!;
    const fence=operationFence(lease,connection,stage,180000);
    const registration={fence,members:noMembers(),intent:"stage-result" as const};
    let registered=false;try{registered=await store.registerRequest(registration,time);}catch{}
    finalizers.push(registered);
    if(registered){
      if(stage==="canvas-feed"){
        wrongFinalizerAccepted=await acceptedCommit(store,fence,course({...snapshot,connections:[canvas]}));
        mismatchedStageAccepted=await acceptedCommit(store,fence,terminalChange(lease,"canvas-status"));
      }
      commits.push((await store.commit(fence,terminalChange(lease,stage),time)).status);
    }
    let duplicate=false;try{duplicate=await store.registerRequest({...registration,fence:{...fence,requestId:crypto.randomUUID()}},time);}catch{}
    duplicates.push(duplicate);
  }
  const internal=await raw(name),totalRecords=internal.requests.length;
  const intentNormalized=internal.requests.every(r=>typeof r==="object"&&r!==null&&"intent" in r&&["provider-read","stage-result"].includes(String(r.intent)));
  await store.releaseRun(lease);const newLease=await run(store);
  let nonemptyFinalizerAccepted=false;
  try{nonemptyFinalizerAccepted=await store.registerRequest({fence:operationFence(newLease,canvas,"canvas-status"),members:{canvas:[{assignmentLocalId:snapshot.assignments[0].id,courseId:"12",assignmentId:"34"}],courseIds:[]},intent:"stage-result"},time);}catch{}
  // Finalizing early must not reduce provider capacity, and consuming a provider must not free a dispatch slot.
  for(const stage of stages){
    const connection=snapshot.connections.find(c=>c.kind===(stage.startsWith("canvas")?"canvas":stage))!;
    const fence=operationFence(newLease,connection,stage);
    if(!await store.registerRequest({fence,members:noMembers(),intent:"stage-result"},time)||!await acceptedCommit(store,fence,terminalChange(newLease,stage)))throw Error("early finalization rejected");
  }
  for(let i=0;i<100;i++){
    const fence=operationFence(newLease,canvas,"canvas-feed");
    if(!await store.registerRequest({fence,members:noMembers()},time))throw Error("early finalization reduced provider capacity");
    if(i===0&&!await acceptedCommit(store,fence,course({...snapshot,connections:[canvas]})))throw Error("provider response rejected");
  }
  const finalRecords=(await raw(name)).requests as {intent:string;consumed:boolean}[];
  const earlyFinalization={providerCount:finalRecords.filter(r=>r.intent==="provider-read").length,totalRecords:finalRecords.length,consumedProviders:finalRecords.filter(r=>r.intent==="provider-read"&&r.consumed).length,provider101:await store.registerRequest({fence:operationFence(newLease,canvas,"canvas-feed"),members:noMembers()},time)};
  store.close();return {providerCount,provider101,finalizers,commits,totalRecords,duplicates,wrongIntentAccepted,wrongFinalizerAccepted,mismatchedStageAccepted,nonemptyFinalizerAccepted,intentNormalized,earlyFinalization};
}
export async function liveMembershipChecks(){
  const name="live-membership";await seed(name);const store=await openGuestStore({name:names(name),now}),lease=await run(store);
  let snapshot=await store.read(),locator={assignmentLocalId:snapshot.assignments[0].id,courseId:"12",assignmentId:"34"};const changed=[];
  for(const next of [{courseId:"13",assignmentId:"34"},{courseId:"13",assignmentId:"35"}]){
    const status=operationFence(lease,snapshot.connections[0],"canvas-status");
    if(!await store.registerRequest({fence:status,members:{canvas:[locator],courseIds:[]}},time))throw Error("old locator rejected at registration");
    time+=1;const feed=await request(store,lease,snapshot.connections[0]);
    const result=course(snapshot);if(result.kind!=="course-result")throw Error("fixture result");
    result.result.assignments=[{...assignment,courseId:next.courseId,sourceUrl:`https://canvas.uw.edu/courses/${next.courseId}/assignments/${next.assignmentId}`}];
    const updated=await store.commit(feed,result,time);if(updated.status!=="accepted")throw Error("feed rejected");snapshot=updated.snapshot;
    const beforeStale=await raw(name),staleAccepted=await acceptedCommit(store,status,statusChange(snapshot)),afterStale=await raw(name);
    locator={assignmentLocalId:snapshot.assignments[0].id,...next};
    const current=operationFence(lease,snapshot.connections[0],"canvas-status");
    if(!await store.registerRequest({fence:current,members:{canvas:[locator],courseIds:[]}},time))throw Error("current locator rejected");
    const currentReply=await store.commit(current,statusChange(snapshot),time);changed.push({beforeStale,staleAccepted,afterStale,currentReply});
  }
  time+=1;const feed=await request(store,lease,snapshot.connections[0]),result=course(snapshot);if(result.kind!=="course-result")throw Error("fixture result");
  result.result.assignments=[{...assignment,courseId:null,sourceUrl:"https://canvas.uw.edu/courses/13/assignments/35"}];
  await store.commit(feed,result,time);
  const nullable=operationFence(lease,snapshot.connections[0],"canvas-status");let nullableRegistered=false;
  try{nullableRegistered=await store.registerRequest({fence:nullable,members:{canvas:[locator],courseIds:[]}},time);}catch{}
  const nullableReply=nullableRegistered?await store.commit(nullable,statusChange(snapshot),time):null;
  store.close();return {changed,nullableRegistered,nullableReply};
}
