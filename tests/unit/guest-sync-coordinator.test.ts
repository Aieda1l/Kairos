import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createGuestSyncCoordinator} from "@/lib/guest/sync/coordinator";
import {createGuestCredentials} from "@/lib/guest/credentials";
import {GuestDataError} from "@/lib/guest/errors";
import {applyChanges,initialStage,updateStage} from "@/lib/guest/store-data";
import type {GuestClock,GuestRegisteredRequest,GuestRunLease,GuestSnapshot,GuestStore} from "@/lib/guest/types";
import type {GuestTransientClient} from "@/lib/guest/sync/transient-client";
import type {GuestBridgeReader} from "@/lib/guest/sync/bridge-reader";
import {guestSnapshotFixture,guestUuid} from "../helpers/guest-fixtures";

const at="2026-10-24T13:00:00.000Z";
function fixture(count=2):GuestSnapshot {
  const s=guestSnapshotFixture({syncStates:[]});
  s.connections.push(...(["gradescope","ed"] as const).map((kind,i)=>({...s.connections[0],id:guestUuid(10+i),kind})));
  for(const c of s.connections.slice(1))for(let i=0;i<count;i++)s.courses.push({id:guestUuid(100+s.courses.length),sourceConnectionId:c.id,externalCourseId:String(i+1),shortName:null,fullName:`Course ${i+1}`,term:null,year:null,enabled:true,firstSeenAt:at,lastSeenAt:at});
  return s;
}
// This port double uses the actual pure commit reducer; native tests own IDB fencing proof.
function harness(snapshot=fixture()) {
  let s=snapshot,seq=10000,lease:GuestRunLease|null=null;
  const uuid=()=>guestUuid(seq++),calls:string[]=[],registrations:GuestRegisteredRequest[]=[],attempts:string[]=[];
  const now=()=>Date.now();
  const clock:GuestClock={now,setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
  const store:GuestStore={
    read:async()=>structuredClone(s),getIdentity:async()=>({datasetId:s.datasetId,revision:s.revision}),subscribe:()=>()=>{},
    beginRun:async input=>{if(lease)return null;return lease={...input,datasetId:s.datasetId,runId:uuid(),generation:seq++,startedAtMs:now(),leaseExpiresAtMs:now()+30000};},
    renewRun:async run=>lease?.runId===run.runId?lease:null,
    releaseRun:async run=>{if(lease?.runId===run.runId)lease=null;},invalidateRun:async()=>{lease=null;},
    registerRequest:async r=>{registrations.push(r);return lease?.runId===r.fence.runId;},
    markStageAttempt:async(_run,id,_generation,stage,time)=>{attempts.push(stage);s=updateStage(s,{...(s.syncStates.find(x=>x.stage===stage&&x.sourceConnectionId===id)??initialStage(id,stage)),lastAttemptedAt:time,hasSuccessfulCheck:false,updatedCount:0,failedCount:0,lastErrorCode:null});return true;},
    commit:async(fence,changes)=>{
      if(lease?.runId!==fence.runId)return {status:"discarded",reason:"superseded"};
      const r=registrations.find(r=>r.fence.requestId===fence.requestId)!;
      const merged=applyChanges(s,fence,{...r,intent:r.intent??"provider-read",consumed:false},changes,new Date(now()).toISOString(),uuid);s=merged.snapshot;
      return {status:"accepted",...merged};
    },
    readRememberedSecret:async()=>null,
    forgetCredential:async(id,generation)=>{s={...s,connections:s.connections.map(c=>c.id===id?{...c,generation:generation+1}:c)};return s;},
    disconnect:async id=>{s={...s,connections:s.connections.filter(c=>c.id!==id)};return s;},
    setEnabledCourses:async()=>s,savePreferences:async()=>s,replaceDataset:async()=>s,clear:async()=>{s=guestSnapshotFixture({datasetId:uuid(),connections:[],assignments:[],statuses:[],syncStates:[]});lease=null;return s;},close:()=>{},
  };
  const transient:GuestTransientClient={
    bootstrap:async()=>{throw Error("No bootstrap");},endSession:async()=>({ok:true}),
    canvasFeed:async r=>{calls.push("canvas-feed");return {ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}};},
    edCourses:async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,courses:[]}),
    edLessons:async r=>{calls.push(`ed:${r.courseId}`);return {ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,courseId:r.courseId,lessons:[]};},
  };
  const bridge:GuestBridgeReader={ping:async()=>{throw Error("No ping");},
    canvas:async r=>{calls.push("canvas-status");return {protocolVersion:1,requestId:r.requestId,results:r.assignments.map(a=>({...a,state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:at,extractorVersion:"test"}))};},
    gradescopeDiscover:async r=>({protocolVersion:1,requestId:r.requestId,courses:[]}),
    gradescopeSync:async r=>{calls.push(`gradescope:${r.courseIds[0]}`);return {protocolVersion:1,requestId:r.requestId,courses:r.courseIds.map(courseId=>({courseId,checkedAt:at,assignments:[],parseDiagnosticCounts:[]}))};},
  };
  const credentials=createGuestCredentials(store);for(const c of s.connections)credentials.put(c.id,c.generation,"test-secret");
  const coordinator=createGuestSyncCoordinator({store,transient,bridge,credentials,clock,uuid,pageEpoch:guestUuid(900)});
  return {store,transient,bridge,credentials,coordinator,calls,registrations,attempts,snapshot:()=>s};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);vi.stubGlobal("fetch",()=>{throw Error("Network forbidden");});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("guest coordinator",()=>{
  it.each([true,false])("atomically preserves initial Canvas partial=%s diagnostics and accepted rows",async partial=>{
    const h=harness(guestSnapshotFixture({connections:[],assignments:[],statuses:[],syncStates:[]}));
    const row={source:"canvas" as const,externalId:"accepted",courseId:"12",courseName:"Math",title:"Homework",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending" as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://canvas.uw.edu/courses/12/assignments/42",sourceUpdatedAt:null};
    h.transient.canvasFeed=async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,assignments:[row],report:{skippedCount:3,malformedCount:partial?1:0,partial}});
    const result=await h.coordinator.connectCanvas({value:"synthetic-feed",remember:false});
    expect(result).toMatchObject({status:"success",code:partial?"PARTIAL_SYNC":null});
    expect(h.snapshot().assignments).toEqual([expect.objectContaining(row)]);
    expect(h.snapshot().syncStates).toEqual([expect.objectContaining({stage:"canvas-feed",updatedCount:1,failedCount:partial?1:0,lastErrorCode:partial?"PARTIAL_SYNC":null,hasSuccessfulCheck:true})]);
    expect(await h.credentials.get(result.connectionId!,1)).toBe("synthetic-feed");
    expect(h.registrations).toHaveLength(1);expect(h.registrations[0].intent).not.toBe("stage-result");
  });
  it("installs only accepted setup secrets, restores without replacing data, and refreshes discovery",async()=>{
    const h=harness(guestSnapshotFixture({connections:[],assignments:[],statuses:[],syncStates:[]}));
    h.transient.edCourses=async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,courses:[{externalCourseId:"1",shortName:null,fullName:"One",term:null,year:null}]});
    const connected=await h.coordinator.connectEd({value:"first",remember:false});
    expect(connected).toMatchObject({status:"success",code:null});const id=connected.connectionId!;
    expect(h.snapshot().courses[0].enabled).toBe(false);expect(await h.credentials.get(id,1)).toBe("first");
    h.transient.edCourses=async()=>{throw new GuestDataError("ED_AUTH_INVALID");};
    const before=structuredClone(h.snapshot());
    expect(await h.coordinator.restoreSecret(id,{value:"wrong",remember:true})).toMatchObject({status:"failed",code:"ED_AUTH_INVALID"});expect(h.snapshot()).toEqual(before);
    h.transient.edCourses=async r=>({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,courses:[]});
    expect(await h.coordinator.restoreSecret(id,{value:"second",remember:false})).toMatchObject({status:"success",connectionId:id});
    expect(h.snapshot().courses).toEqual(before.courses);expect(await h.credentials.get(id,2)).toBe("second");
    expect(await h.coordinator.refreshCourses(id)).toMatchObject({status:"success",connectionId:id});
    expect(await h.credentials.get(id,3)).toBe("second");
    await h.coordinator.forgetCredential(id);expect(await h.credentials.get(id,4)).toBeNull();
    expect(h.snapshot().courses).toEqual(before.courses);
  });
  it("reports only this run, marks each stage once, and continues after a failed sibling",async()=>{
    const h=harness();h.bridge.gradescopeSync=async r=>{h.calls.push(`gradescope:${r.courseIds[0]}`);if(r.courseIds[0]==="1")throw new GuestDataError("GRADESCOPE_NETWORK_ERROR");return {protocolVersion:1,requestId:r.requestId,courses:[{courseId:"2",checkedAt:at,assignments:[],parseDiagnosticCounts:[]}]};};
    const report=await h.coordinator.run();
    expect(h.calls).toEqual(["canvas-feed","canvas-status","gradescope:1","gradescope:2","ed:1","ed:2"]);
    expect(h.attempts).toEqual(["canvas-feed","canvas-status","gradescope","ed"]);
    expect(report.outcomes.every(o=>o.runId===report.run.runId)).toBe(true);
    expect(report.outcomes.map(o=>o.status)).toEqual(["success","success","partial","success"]);
    expect(report.outcomes[2]).toMatchObject({failedCount:1,updatedCount:0,pendingCount:0});
    expect(h.snapshot().syncStates.find(s=>s.stage==="gradescope")).toMatchObject({hasSuccessfulCheck:true,lastSuccessfulAt:at});
    expect(h.registrations.filter(r=>r.intent==="stage-result")).toHaveLength(4);
  });
  it("dispatches at most 100 operations and resumes unprocessed courses first",async()=>{
    const h=harness(fixture(102));
    const first=await h.coordinator.run({sources:["ed"]});
    expect(h.calls).toHaveLength(100);expect(first.outcomes[0]).toMatchObject({status:"partial",code:"GUEST_RUN_LIMIT",pendingCount:2});
    expect(h.snapshot().syncStates[0].resumeKeys).toEqual(["101","102"]);
    h.calls.length=0;await h.coordinator.run({sources:["ed"]});expect(h.calls[0]).toBe("ed:101");
  });
  it.each(["GUEST_SESSION_REQUIRED","ED_AUTH_INVALID"] as const)("halts Ed on %s and resumes pending work only on a fresh run",async code=>{
    const h=harness(fixture(3));const ids:string[]=[],accepted=structuredClone(h.snapshot().assignments);
    h.transient.edLessons=async r=>{h.calls.push(r.courseId);ids.push(r.requestId);throw new GuestDataError(code);};
    const first=await h.coordinator.run({sources:["ed"]});
    expect(h.calls).toEqual(["1"]);expect(first.outcomes[0]).toMatchObject({failedCount:1,pendingCount:2,code});
    expect(h.snapshot().assignments).toEqual(accepted);
    expect(h.snapshot().syncStates.find(s=>s.stage==="ed")?.resumeKeys).toEqual(["2","3"]);
    h.calls.length=0;await h.coordinator.run({sources:["ed"]});
    expect(h.calls).toEqual(["2"]);expect(new Set(ids).size).toBe(2);
  });
  it("preserves unprocessed members after rate limiting without retrying",async()=>{
    const h=harness(fixture(3));h.transient.edLessons=async r=>{h.calls.push(r.courseId);throw new GuestDataError("ED_RATE_LIMITED");};
    const report=await h.coordinator.run({sources:["ed"]});
    expect(h.calls).toEqual(["1"]);expect(report.outcomes[0]).toMatchObject({failedCount:1,pendingCount:2,code:"ED_RATE_LIMITED"});
    h.calls.length=0;await h.coordinator.run({sources:["ed"]});expect(h.calls).toEqual(["2"]);
  });
  it("returns new busy outcomes while a read is pending and stop discards its late result",async()=>{
    const h=harness();let settle!:()=>void;
    h.transient.canvasFeed=r=>new Promise(resolve=>{settle=()=>resolve({ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}});});
    const pending=h.coordinator.run();await vi.advanceTimersByTimeAsync(0);
    const busy=await h.coordinator.run();expect(busy.outcomes.every(o=>o.code==="GUEST_BUSY")).toBe(true);
    h.coordinator.stop();const stopped=await pending;settle();await vi.advanceTimersByTimeAsync(0);
    expect(stopped.outcomes[0].status).toBe("cancelled");expect(h.calls).toEqual([]);
    expect(h.snapshot().syncStates[0].hasSuccessfulCheck).toBe(false);
  });
  it("stops extension queuing after a timeout while retaining committed successes",async()=>{
    const h=harness(fixture(3));h.bridge.gradescopeSync=async r=>{h.calls.push(r.courseIds[0]);if(r.courseIds[0]==="2")return new Promise(()=>{});return {protocolVersion:1,requestId:r.requestId,courses:[{courseId:r.courseIds[0],checkedAt:at,assignments:[],parseDiagnosticCounts:[]}]};};
    const pending=h.coordinator.run({sources:["gradescope"]});await vi.advanceTimersByTimeAsync(30000);const report=await pending;
    expect(h.calls).toEqual(["1","2"]);expect(report.outcomes[0]).toMatchObject({status:"partial",code:"EXTENSION_TIMEOUT",failedCount:1,pendingCount:1});
    expect(h.snapshot().syncStates[0].hasSuccessfulCheck).toBe(true);
  });
  it("does not dispatch after 180 seconds",async()=>{
    const h=harness();h.transient.canvasFeed=async r=>{vi.setSystemTime(Date.now()+180000);return {ok:true,schemaVersion:1,requestId:r.requestId,checkedAt:at,assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}};};
    const report=await h.coordinator.run();expect(h.calls).toEqual([]);expect(report.outcomes.every(o=>o.status!=="success")).toBe(true);
    expect(report.outcomes.map(o=>o.pendingCount)).toEqual([0,1,2,2]);
  });
  it("halts all later extension queues after an extension timeout but still reads Ed",async()=>{
    const h=harness();h.bridge.canvas=async()=>{throw new GuestDataError("EXTENSION_TIMEOUT");};
    const report=await h.coordinator.run();expect(h.calls).toEqual(["canvas-feed","ed:1","ed:2"]);
    expect(report.outcomes[2]).toMatchObject({code:"EXTENSION_TIMEOUT",pendingCount:2});
  });
  it.each(["canvas-top","canvas-member","gradescope-top","gradescope-course","thrown"] as const)("halts extension work and enforces retry delay for %s timeout",async mode=>{
    const s=fixture();
    s.assignments=Array.from({length:26},(_,i)=>({...s.assignments[0],id:guestUuid(200+i),externalId:`event-${i}`,sourceUrl:`https://canvas.uw.edu/courses/12/assignments/${i+1}`}));s.statuses=[];
    const h=harness(s),canvas=h.bridge.canvas,gradescope=h.bridge.gradescopeSync;
    if(mode.startsWith("canvas")||mode==="thrown")h.bridge.canvas=async r=>{
      h.calls.push("canvas-timeout");if(mode==="thrown")throw new GuestDataError("EXTENSION_TIMEOUT");
      return {protocolVersion:1,requestId:r.requestId,...(mode==="canvas-top"?{errorCode:"EXTENSION_TIMEOUT" as const}:{}),results:r.assignments.map((a,i)=>({...a,state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:at,extractorVersion:"test",...(mode==="canvas-member"&&i===0?{errorCode:"CANVAS_NETWORK_ERROR" as const}:mode==="canvas-member"&&i===1?{errorCode:"EXTENSION_TIMEOUT" as const}:{})}))};
    };
    else h.bridge.gradescopeSync=async r=>{h.calls.push("gradescope-timeout");return {protocolVersion:1,requestId:r.requestId,...(mode==="gradescope-top"?{errorCode:"EXTENSION_TIMEOUT" as const}:{}),courses:[{courseId:r.courseIds[0],checkedAt:at,assignments:[],parseDiagnosticCounts:[],...(mode==="gradescope-course"?{errorCode:"EXTENSION_TIMEOUT" as const}:{})}]};};
    const report=await h.coordinator.run();
    expect(h.calls.filter(c=>c==="canvas-timeout"||c==="gradescope-timeout")).toHaveLength(1);
    expect(h.calls.some(c=>c.startsWith("gradescope:"))).toBe(false);
    expect(h.calls.slice(-2)).toEqual(["ed:1","ed:2"]);
    const stage=mode.startsWith("gradescope")?"gradescope":"canvas-status";
    expect(report.outcomes.find(o=>o.stage===stage)).toMatchObject({code:"EXTENSION_TIMEOUT",pendingCount:1});
    if(mode==="canvas-member")expect(report.outcomes.find(o=>o.stage===stage)).toMatchObject({status:"partial",updatedCount:23,failedCount:2});
    if(mode==="canvas-top")expect(report.outcomes.find(o=>o.stage===stage)).toMatchObject({status:"partial",updatedCount:25,failedCount:0});
    if(mode==="gradescope-top")expect(h.snapshot().syncStates.find(s=>s.stage===stage)?.hasSuccessfulCheck).toBe(true);
    h.bridge.canvas=canvas;h.bridge.gradescopeSync=gradescope;h.calls.length=0;vi.setSystemTime(Date.now()+59999);
    await h.coordinator.run();expect(h.calls).toEqual(["canvas-feed","ed:1","ed:2"]);
    h.calls.length=0;vi.setSystemTime(Date.now()+1);await h.coordinator.run({sources:["gradescope"]});expect(h.calls).toHaveLength(2);
  });
  it("applies the same timeout retry delay to Gradescope discovery without blocking Ed setup",async()=>{
    const h=harness(guestSnapshotFixture({connections:[],assignments:[],statuses:[],syncStates:[]}));
    h.bridge.gradescopeDiscover=async r=>{h.calls.push("discover");return {protocolVersion:1,requestId:r.requestId,courses:[],errorCode:"EXTENSION_TIMEOUT"};};
    expect(await h.coordinator.connectGradescope()).toMatchObject({status:"failed",code:"EXTENSION_TIMEOUT"});
    h.bridge.gradescopeDiscover=async r=>{h.calls.push("discover");return {protocolVersion:1,requestId:r.requestId,courses:[]};};
    expect(await h.coordinator.connectGradescope()).toMatchObject({status:"failed",code:"EXTENSION_TIMEOUT"});expect(h.calls).toEqual(["discover"]);
    expect(await h.coordinator.connectEd({value:"synthetic-token",remember:false})).toMatchObject({status:"success",code:null});
    vi.setSystemTime(Date.now()+60000);expect(await h.coordinator.connectGradescope()).toMatchObject({status:"success",code:null});expect(h.calls).toEqual(["discover","discover"]);
  });
  it("uses a new registry after clock rollback and never reuses request IDs",async()=>{
    const h=harness();await h.coordinator.run({sources:["ed"]});vi.setSystemTime(Date.now()-600000);
    const result=await h.coordinator.run({sources:["ed"]});expect(result.outcomes[0].status).toBe("success");
    expect(new Set(h.registrations.map(r=>r.fence.requestId)).size).toBe(h.registrations.length);
  });
  it("stop during lease acquisition prevents the first dispatch",async()=>{
    const h=harness();const pending=h.coordinator.run();h.coordinator.stop();
    const report=await pending;expect(h.calls).toEqual([]);expect(report.outcomes.every(o=>o.code==="GUEST_INTERRUPTED")).toBe(true);
  });
  it("automatic mode reads only opted-in Canvas statuses and Gradescope, never feed or Ed",async()=>{
    const s=fixture();s.preferences.automaticCanvas=true;s.preferences.automaticGradescope=true;
    const h=harness(s);await h.coordinator.run({automatic:true});expect(h.calls).toEqual(["canvas-status","gradescope:1","gradescope:2"]);
  });
  it("counts failed Canvas members separately from stale accepted rows and preserves prior status",async()=>{
    const s=fixture();s.assignments.push({...s.assignments[0],id:guestUuid(55),externalId:"second",sourceUrl:"https://canvas.uw.edu/courses/12/assignments/43"});
    const h=harness(s);h.bridge.canvas=async r=>({protocolVersion:1,requestId:r.requestId,results:r.assignments.map((a,i)=>({...a,state:"graded",isLate:false,isMissing:false,submittedAt:null,checkedAt:"2026-10-24T12:00:00.000Z",extractorVersion:"test",...(i?{errorCode:"CANVAS_NETWORK_ERROR" as const}:{})}))});
    const result=await h.coordinator.run({sources:["canvas"]});
    expect(result.outcomes[1]).toMatchObject({status:"partial",updatedCount:0,ignoredCount:1,failedCount:1,pendingCount:0});
    expect(h.snapshot().statuses).toEqual(s.statuses);
  });
  it("keeps Gradescope course-scoped identities, excused status, and failed-course coursework",async()=>{
    const h=harness();
    h.bridge.gradescopeSync=async r=>({protocolVersion:1,requestId:r.requestId,courses:[{courseId:r.courseIds[0],checkedAt:at,parseDiagnosticCounts:[],assignments:[{courseId:r.courseIds[0],assignmentId:"7",title:"Homework",releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:"Excused",state:"excused",isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:"10",gradeDisplay:null,checkedAt:at,extractorVersion:"test"}]}]});
    const first=await h.coordinator.run({sources:["gradescope"]});
    expect(first.outcomes[0]).toMatchObject({status:"success",updatedCount:2});
    const rows=h.snapshot().assignments.filter(a=>a.source==="gradescope");
    expect(rows.map(a=>[a.externalId,a.status])).toEqual([["1:7","submitted"],["2:7","submitted"]]);
    expect(h.snapshot().statuses.filter(s=>rows.some(a=>a.id===s.assignmentId)).map(s=>s.state)).toEqual(["excused","excused"]);
    h.bridge.gradescopeSync=async r=>{if(r.courseIds[0]==="1")throw new GuestDataError("GRADESCOPE_NETWORK_ERROR");return {protocolVersion:1,requestId:r.requestId,courses:[{courseId:"2",checkedAt:at,assignments:[],parseDiagnosticCounts:[]}]};};
    const second=await h.coordinator.run({sources:["gradescope"]});
    expect(second.outcomes[0]).toMatchObject({status:"partial",failedCount:1,updatedCount:0});
    expect(h.snapshot().assignments.filter(a=>a.source==="gradescope")).toEqual(rows);
  });
});
