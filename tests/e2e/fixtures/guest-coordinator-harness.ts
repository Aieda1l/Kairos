import {openGuestStore} from "../../../src/lib/guest/store";
import {createGuestCredentials} from "../../../src/lib/guest/credentials";
import {createGuestSyncCoordinator} from "../../../src/lib/guest/sync/coordinator";
import type {GuestBridgeReader} from "../../../src/lib/guest/sync/bridge-reader";
import type {GuestTransientClient} from "../../../src/lib/guest/sync/transient-client";
import type {GuestCommitResult,GuestRequestFence,GuestRunLease,GuestStore} from "../../../src/lib/guest/types";

if(!import.meta.env.KAIROS_GUEST_STORAGE_TEST||!["127.0.0.1","localhost","[::1]"].includes(location.hostname))throw Error("Loopback test fixture only");
// Explicit injected readers only. Unexpected fetch/proof paths fail closed before any setup.
globalThis.fetch=async()=>{throw Error("Network forbidden in guest coordinator fixture");};
let time=Date.parse("2026-10-24T12:00:00.000Z");
const now=()=>time,stamp=()=>new Date(time).toISOString();
const forbidden=async()=>{throw Error("Unexpected reader");};
const bridge:GuestBridgeReader={ping:forbidden,canvas:forbidden,gradescopeDiscover:forbidden,gradescopeSync:forbidden};
const transient:GuestTransientClient={bootstrap:forbidden,endSession:forbidden,canvasFeed:forbidden,edCourses:forbidden,edLessons:forbidden};
const clock={now,setTimeout:()=>0,clearTimeout:()=>{}}; // Deliberately paused old-tab scheduling.
const name=(id:string)=>`u2-${id}`;
let settle:()=>void=()=>{throw Error("No pending read");};
let pending:ReturnType<ReturnType<typeof createGuestSyncCoordinator>["run"]>;
let oldStore:GuestStore;
const attempted:GuestCommitResult[]=[];
export async function startOld(id:string){
  const store=await openGuestStore({name:name(id),now});oldStore=store;
  const credentials=createGuestCredentials(store);
  const client:GuestTransientClient={...transient,canvasFeed:async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:stamp(),assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}})};
  const observed:GuestStore={...store,async commit(...args){const result=await store.commit(...args);attempted.push(result);return result;}};
  const coordinator=createGuestSyncCoordinator({store:observed,credentials,transient:client,bridge,clock,uuid:()=>crypto.randomUUID(),pageEpoch:crypto.randomUUID()});
  const setup=await coordinator.connectCanvas({value:"synthetic-only",remember:false});if(setup.status!=="success")throw Error("Setup failed");
  attempted.length=0;
  let ready!:()=>void;const waiting=new Promise<void>(resolve=>{ready=resolve;});
  client.canvasFeed=r=>new Promise(resolve=>{settle=()=>resolve({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:stamp(),assignments:[{source:"canvas",externalId:"late-resurrection",courseId:"12",courseName:"Math",title:"Must not resurrect",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://canvas.uw.edu/courses/12/assignments/34",sourceUpdatedAt:null}],report:{skippedCount:0,malformedCount:0,partial:false}});ready();});
  pending=coordinator.run({sources:["canvas"]});await waiting;
  return store.read();
}
export async function settleOld(){settle();const report=await pending;const snapshot=await oldStore.read();oldStore.close();return {report,snapshot,attempted};}
let newStore:GuestStore,newLease:GuestRunLease;
export async function takeOver(id:string){
  time+=31000;newStore=await openGuestStore({name:name(id),now});
  const lease=await newStore.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+180000});if(!lease)throw Error("Takeover failed");newLease=lease;
  return {lease,snapshot:await newStore.read()};
}
export async function verifyOwner(){const renewed=await newStore.renewRun(newLease,time);await newStore.releaseRun(newLease);newStore.close();return renewed;}
export async function invalidateOld(kind:"reset"|"disconnect"){
  const before=await oldStore.read();
  return kind==="reset"?oldStore.clear(before.datasetId):oldStore.disconnect(before.connections[0].id,before.connections[0].generation);
}
export async function refreshChecks(id:string){
  const store=await openGuestStore({name:name(id),now}),credentials=createGuestCredentials(store);
  let courses=[{externalCourseId:"1",shortName:null,fullName:"First",term:null,year:null}];
  const client:GuestTransientClient={...transient,edCourses:async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:stamp(),courses})};
  const coordinator=createGuestSyncCoordinator({store,credentials,transient:client,bridge,clock,uuid:()=>crypto.randomUUID(),pageEpoch:crypto.randomUUID()});
  const connected=await coordinator.connectEd({value:"private-test-token",remember:true});if(!connected.connectionId)throw Error("Setup failed");const connectionId=connected.connectionId;
  await coordinator.setEnabledCourses(connectionId,["1"]);const before=await store.read();
  courses=[{...courses[0],fullName:"Renamed"},{...courses[0],externalCourseId:"2",fullName:"New"}];
  const refresh=await coordinator.refreshCourses(connectionId),after=await store.read();
  const remembered=await credentials.get(connectionId,after.connections[0].generation);
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="requests")throw new DOMException("injected","QuotaExceededError");return original.apply(this,args);};
  let rejected;
  try{courses=[{...courses[0],externalCourseId:"3"}];rejected=await coordinator.refreshCourses(connectionId);}finally{IDBObjectStore.prototype.put=original;}
  const afterAbort=await store.read(),secretAfterAbort=await store.readRememberedSecret(connectionId);
  const lease=await store.beginRun({pageEpoch:crypto.randomUUID(),nowMs:time,deadlineAtMs:time+180000});if(!lease)throw Error("Missing validation lease");
  const c=after.connections[0];
  const fence=(operation:"ed"|"ed-courses",generation=c.generation):GuestRequestFence=>({datasetId:lease.datasetId,runId:lease.runId,pageEpoch:lease.pageEpoch,generation:lease.generation,requestId:crypto.randomUUID(),operation,source:"ed",purpose:"read",connectionId:c.id,connectionGeneration:generation,deadlineAtMs:time+15000});
  const discovery=fence("ed-courses"),earlier=fence("ed");
  await store.registerRequest({fence:discovery,members:{canvas:[],courseIds:[]}},time);
  await store.registerRequest({fence:earlier,members:{canvas:[],courseIds:["1"]}},time);
  let duplicateRejected=false;
  try{await store.commit(discovery,{kind:"courses",courses:[courses[0],courses[0]]},time);}catch{duplicateRejected=true;}
  const afterRejected=await store.read();
  const accepted=await store.commit(discovery,{kind:"courses",courses:[]},time);
  const consumed=await store.commit(discovery,{kind:"courses",courses:[]},time);
  const stale=await store.commit(earlier,{kind:"course-result",result:{sourceConnectionId:c.id,connectionGeneration:c.generation,stage:"ed",externalCourseId:"1",checkedAt:stamp(),assignments:[],statuses:[],courseSucceeded:true,failedCount:0,code:null,remainingKeys:[]}},time);
  const overflow=fence("ed-courses",c.generation+1);await store.registerRequest({fence:overflow,members:{canvas:[],courseIds:[]}},time);
  const beforeOverflow=await store.read();let overflowRejected=false;
  try{await store.commit(overflow,{kind:"courses",courses:Array.from({length:999},(_,i)=>({...courses[0],externalCourseId:String(i+100)}))},time);}catch{overflowRejected=true;}
  const afterOverflow=await store.read(),reuse=await store.commit(overflow,{kind:"courses",courses:[]},time);
  await store.releaseRun(lease);store.close();return {before,refresh,after,remembered,rejected,afterAbort,secretAfterAbort,duplicateRejected,afterRejected,accepted,consumed,stale,beforeOverflow,overflowRejected,afterOverflow,reuse};
}

export async function initialPartialChecks(id:string){
  const store=await openGuestStore({name:name(id),now}),credentials=createGuestCredentials(store),before=await store.read();
  const assignment={source:"canvas" as const,externalId:"accepted-partial",courseId:"12",courseName:"Math",title:"Accepted homework",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://canvas.uw.edu/courses/12/assignments/42",sourceUpdatedAt:null};
  const client:GuestTransientClient={...transient,canvasFeed:async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:stamp(),assignments:[assignment],report:{skippedCount:5,malformedCount:2,partial:true}})};
  let attemptedId="";
  const observed:GuestStore={...store,async commit(...args){if(args[1].kind==="connect")attemptedId=args[1].connection.id;return store.commit(...args);}};
  const coordinator=createGuestSyncCoordinator({store:observed,credentials,transient:client,bridge,clock,uuid:()=>crypto.randomUUID(),pageEpoch:crypto.randomUUID()});
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="requests")throw new DOMException("injected","QuotaExceededError");return original.apply(this,args);};
  let failed;
  try{failed=await coordinator.connectCanvas({value:"private-partial-feed",remember:true});}finally{IDBObjectStore.prototype.put=original;}
  const afterAbort=await store.read(),abortedSecret=await store.readRememberedSecret(attemptedId);
  const accepted=await coordinator.connectCanvas({value:"private-partial-feed",remember:true}),after=await store.read();
  if(!accepted.connectionId)throw Error("Partial setup rejected");
  const secret=await store.readRememberedSecret(accepted.connectionId);store.close();
  return {before,failed,afterAbort,abortedSecret,accepted,after,secret};
}
