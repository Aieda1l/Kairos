import {describe,expect,it,vi} from "vitest";
import {createGuestRequestRegistry} from "@/lib/guest/sync/request-registry";
import type {GuestOperation,GuestRegisteredRequest} from "@/lib/guest/types";
import {guestUuid} from "../helpers/guest-fixtures";

const requestId=guestUuid(10),checkedAt="2026-10-24T12:00:00.000Z";
const locator={assignmentLocalId:guestUuid(3),courseId:"12",assignmentId:"42"};
function registration(operation:GuestOperation="canvas-status"):GuestRegisteredRequest {
  return {fence:{datasetId:guestUuid(1),runId:guestUuid(4),pageEpoch:guestUuid(5),generation:1,
    requestId,operation,source:operation.startsWith("canvas")?"canvas":operation.startsWith("gradescope")?"gradescope":"ed",
    purpose:"read",connectionId:guestUuid(2),connectionGeneration:1,deadlineAtMs:16_000},
    members:{canvas:operation==="canvas-status"?[{...locator}]:[],courseIds:["gradescope","ed"].includes(operation)?["12"]:[]}};
}
const status={...locator,state:"submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt,extractorVersion:"1"};
const canvas={protocolVersion:1,requestId,results:[status]};
const assignment={courseId:"12",assignmentId:"42",title:"Homework",releaseAt:null,dueAt:null,lateDueAt:null,
  sourceStatusText:null,state:"unknown",isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,
  gradeDisplay:null,checkedAt,extractorVersion:"1"};
const course={courseId:"12",checkedAt,assignments:[assignment]};
const gs={protocolVersion:1,requestId,courses:[course]};
function registered(operation:GuestOperation="canvas-status") {
  const registry=createGuestRequestRegistry({now:()=>1000});
  expect(registry.register(registration(operation))).toBe(true);
  return registry;
}

describe("guest wire request membership",()=>{
  it("accepts once and returns the operation and immutable copied registration",()=>{
    const registry=createGuestRequestRegistry({now:()=>1000}),input=registration();
    expect(registry.register(input)).toBe(true);
    input.members.canvas[0].assignmentId="99";
    const accepted=registry.accept(requestId,canvas,1000) as {operation:string;registration:GuestRegisteredRequest;result:unknown};
    expect(accepted.operation).toBe("canvas-status");
    expect(accepted.result).toEqual(canvas);
    expect(accepted.registration.members.canvas[0].assignmentId).toBe("42");
    expect(Object.isFrozen(accepted.registration.members.canvas[0])).toBe(true);
    expect(registry.accept(requestId,canvas,1000)).toBeNull();
  });
  it.each([
    {...canvas,requestId:guestUuid(11)},
    {...canvas,extra:"secret"},
    {...canvas,results:[status,status]},
    {...canvas,results:[{...status,assignmentLocalId:guestUuid(6)}]},
    {...canvas,results:[{...status,courseId:"012"}]},
    {...canvas,results:[{...status,assignmentId:"99"}]},
  ])("rejects invalid Canvas identity without consuming a valid retry",value=>{
    const registry=registered();
    expect(()=>registry.accept(requestId,value,1000)).toThrow("The source returned an invalid result.");
    expect(registry.accept(requestId,canvas,1000)).not.toBeNull();
  });
  it.each([
    {...gs,requestId:guestUuid(11)},
    {...gs,courses:[{...course,courseId:"13"}]},
    {...gs,courses:[{...course,assignments:[{...assignment,courseId:"13"}]}]},
    {...gs,courses:[course,course]},
    {...gs,courses:[{...course,assignments:[assignment,assignment]}]},
    {...gs,courses:[{...course,unexpected:"secret"}]},
  ])("rejects Gradescope nested ID, course or child membership violations",value=>{
    expect(()=>registered("gradescope").accept(requestId,value,1000)).toThrow("The source returned an invalid result.");
  });
  it("accepts valid Gradescope discovery and rejects duplicate discovered identities",()=>{
    const discovery={protocolVersion:1,requestId,courses:[{courseId:"12",fullName:"Math",shortName:null,term:null,year:null}]};
    expect(registered("gradescope-discovery").accept(requestId,discovery,1000)).toMatchObject({operation:"gradescope-discovery"});
    expect(()=>registered("gradescope-discovery").accept(requestId,{...discovery,courses:[...discovery.courses,...discovery.courses]},1000)).toThrow();
  });
  it("validates each F1 result and Ed requested course separately from schema validity",()=>{
    const base={ok:true,schemaVersion:1,requestId,checkedAt};
    expect(registered("canvas-feed").accept(requestId,{...base,assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}},1000)).toMatchObject({operation:"canvas-feed"});
    expect(registered("ed-courses").accept(requestId,{...base,courses:[]},1000)).toMatchObject({operation:"ed-courses"});
    expect(registered("ed").accept(requestId,{...base,courseId:"12",lessons:[]},1000)).toMatchObject({operation:"ed"});
    expect(()=>registered("ed").accept(requestId,{...base,courseId:"13",lessons:[]},1000)).toThrow();
    expect(()=>registered("ed-courses").accept(requestId,{...base,courses:[],extra:true},1000)).toThrow();
  });
  it("discards missing, invalidated and expired requests even with stale caller time",()=>{
    const now=vi.fn(()=>1000),registry=createGuestRequestRegistry({now});
    expect(registry.accept(requestId,canvas,1000)).toBeNull();
    expect(registry.register(registration())).toBe(true);
    now.mockReturnValue(16_000);
    expect(registry.accept(requestId,canvas,1000)).toBeNull();
    now.mockReturnValue(1000);
    registry.invalidateRun(guestUuid(4));
    expect(registry.accept(requestId,canvas,1000)).toBeNull();
    expect(registry.register(registration())).toBe(false);
  });
  it("rejects duplicate registrations, local finalizers and operation-inconsistent members",()=>{
    const registry=registered();
    expect(registry.register(registration())).toBe(false);
    expect(registry.register({...registration(),intent:"stage-result"})).toBe(false);
    expect(()=>createGuestRequestRegistry({now:()=>1000}).register({...registration("ed"),members:{canvas:[locator],courseIds:["12"]}})).toThrow();
    expect(()=>createGuestRequestRegistry({now:()=>1000}).register({...registration(),members:{canvas:[locator,locator],courseIds:[]}})).toThrow();
  });
  it("enforces operation deadlines and 100 provider registrations including consumed records",()=>{
    const registry=createGuestRequestRegistry({now:()=>1000});
    expect(registry.register({...registration("ed-courses"),fence:{...registration("ed-courses").fence,deadlineAtMs:16_001}})).toBe(false);
    expect(registry.register({...registration(),fence:{...registration().fence,deadlineAtMs:31_001}})).toBe(false);
    for(let i=0;i<100;i++){
      const id=guestUuid(100+i);
      expect(registry.register({...registration(),fence:{...registration().fence,requestId:id}})).toBe(true);
      expect(registry.accept(id,{...canvas,requestId:id},1000)).not.toBeNull();
    }
    expect(registry.register(registration())).toBe(false);
  });
  it("keeps invalidated request UUIDs unavailable to later runs",()=>{
    const registry=registered();
    registry.invalidateRun(guestUuid(4));
    expect(registry.register({...registration(),fence:{...registration().fence,runId:guestUuid(9)}})).toBe(false);
  });
});
