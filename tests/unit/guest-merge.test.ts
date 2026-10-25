import { describe,expect,it } from "vitest";
import { applyGuestCourseResult,mergeGuestCourseResult } from "@/lib/guest/merge";
import type { GuestCourseResult,GuestSnapshot,GuestStatusInput } from "@/lib/guest/types";
import type { NormalizedAssignment } from "@/lib/assignments/normalize";
import { GuestDataError,guestSafeMessage } from "@/lib/guest/errors";
import { guestSnapshotFixture,guestUuid } from "../helpers/guest-fixtures";

const before="2026-10-24T11:00:00.000Z";
const checked="2026-10-24T13:00:00.000Z";
const at="2026-10-24T14:00:00.000Z";
const uuid=()=>guestUuid(100);
function metadata(snapshot:GuestSnapshot):NormalizedAssignment {
  const {id,sourceConnectionId,metadataCheckedAt,firstSeenAt,lastSeenAt,...row}=snapshot.assignments[0];
  void id;void sourceConnectionId;void metadataCheckedAt;void firstSeenAt;void lastSeenAt;
  return row;
}
function status(snapshot:GuestSnapshot,overrides:Partial<GuestStatusInput>={}):GuestStatusInput {
  const {assignmentId,...row}=snapshot.statuses[0];void assignmentId;
  return {...row,externalId:snapshot.assignments[0].externalId,checkedAt:checked,errorCode:null,...overrides};
}
function result(snapshot:GuestSnapshot,overrides:Partial<GuestCourseResult>={}):GuestCourseResult {
  return {sourceConnectionId:snapshot.connections[0].id,connectionGeneration:1,stage:"canvas-feed",externalCourseId:null,
    checkedAt:checked,assignments:[],statuses:[],courseSucceeded:true,failedCount:0,code:null,remainingKeys:[],...overrides};
}
function courseSnapshot(source:"gradescope"|"ed"):GuestSnapshot {
  const snapshot=guestSnapshotFixture({syncStates:[]});
  return {...snapshot,connections:[{...snapshot.connections[0],kind:source}],
    courses:[{id:guestUuid(4),sourceConnectionId:guestUuid(2),externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:before,lastSeenAt:before}],
    assignments:[{...snapshot.assignments[0],source,sourceUrl:null}]};
}

describe("guest course merge",()=>{
  it("preserves identities and omitted rows while retaining every normalized field",()=>{
    const initial=guestSnapshotFixture({syncStates:[]});
    const incoming={...metadata(initial),externalId:"new",title:"Date-only homework",dueAt:"2026-11-01T08:00:00.000Z",releaseAt:before,lateDueAt:at,
      sourceStatusText:"Pending",gradeScore:"0",gradeMax:"10",gradeDisplay:"0 / 10",sourceUpdatedAt:checked};
    const first=mergeGuestCourseResult(initial,result(initial,{assignments:[incoming]}),at,uuid);
    const second=mergeGuestCourseResult(first,result(first,{checkedAt:at,assignments:[{...incoming,title:"Renamed"}]}),at,()=>{throw Error("Unexpected UUID");});
    expect(second.assignments).toHaveLength(2);
    expect(second.assignments[0]).toEqual(initial.assignments[0]);
    expect(second.assignments[1]).toMatchObject({...incoming,title:"Renamed",id:guestUuid(100),firstSeenAt:at,metadataCheckedAt:at});
    expect(second.assignments[1].id).toBe(first.assignments[1].id);
    expect(second.assignments[1].firstSeenAt).toBe(first.assignments[1].firstSeenAt);
    expect(initial.assignments).toHaveLength(1);
  });
  it("keeps equal/older metadata first-wins and counts fresh unchanged values",()=>{
    const snapshot=guestSnapshotFixture({syncStates:[]});
    const stale=applyGuestCourseResult(snapshot,result(snapshot,{checkedAt:before,assignments:[{...metadata(snapshot),title:"Stale"}]}),at,uuid);
    expect(stale.snapshot.assignments).toEqual(snapshot.assignments);
    expect(stale).toMatchObject({updatedCount:0,ignoredCount:1});
    const fresh=applyGuestCourseResult(snapshot,result(snapshot,{assignments:[metadata(snapshot)]}),at,uuid);
    expect(fresh).toMatchObject({updatedCount:1,ignoredCount:0});
  });
  it("writes Canvas statuses only, preserving old statuses and all metadata",()=>{
    const snapshot=guestSnapshotFixture();
    const olderResult=result(snapshot,{stage:"canvas-status",statuses:[status(snapshot,{checkedAt:before,state:"not_submitted"})]});
    expect(mergeGuestCourseResult(snapshot,olderResult,at,uuid).statuses).toEqual(snapshot.statuses);
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status",statuses:[status(snapshot,{state:"graded"})]}),at,uuid);
    expect(applied.snapshot.statuses[0]).toMatchObject({state:"graded",checkedAt:checked});
    expect(applied.snapshot.assignments).toEqual(snapshot.assignments);
    expect(applied).toMatchObject({updatedCount:1,ignoredCount:0});
  });
  it("advances freshness for successful empty/stale checks and preserves failures",()=>{
    const snapshot=guestSnapshotFixture();
    const empty=mergeGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status"}),at,uuid);
    expect(empty.syncStates[0]).toMatchObject({lastAttemptedAt:snapshot.syncStates[0].lastAttemptedAt,lastSuccessfulAt:at});
    const failedResult=result(snapshot,{stage:"canvas-status",courseSucceeded:false,failedCount:1,code:"CANVAS_NETWORK_ERROR",statuses:[status(snapshot)]});
    const failed=mergeGuestCourseResult(snapshot,failedResult,at,uuid);
    expect(failed.assignments).toEqual(snapshot.assignments);
    expect(failed.statuses).toEqual(snapshot.statuses);
    expect(failed.syncStates[0].lastSuccessfulAt).toBe(snapshot.syncStates[0].lastSuccessfulAt);
    const stale=mergeGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status",statuses:[status(snapshot,{checkedAt:before})]}),at,uuid);
    expect(stale.syncStates[0].lastSuccessfulAt).toBe(at);
  });
  it("accumulates attempt counts, preserves successful siblings and records partial failure",()=>{
    const snapshot=courseSnapshot("ed");
    const success=mergeGuestCourseResult(snapshot,result(snapshot,{stage:"ed",externalCourseId:"12",assignments:[metadata(snapshot)],statuses:[status(snapshot)]}),at,uuid);
    expect(success.syncStates[0]).toMatchObject({updatedCount:1,failedCount:0,lastAttemptedAt:at,lastSuccessfulAt:at});
    const failed=mergeGuestCourseResult(success,result(success,{stage:"ed",externalCourseId:"12",courseSucceeded:false,failedCount:1,code:"ED_NETWORK_ERROR"}),at,uuid);
    expect(failed.assignments).toEqual(success.assignments);
    expect(failed.statuses).toEqual(success.statuses);
    expect(failed.syncStates[0]).toMatchObject({updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC",lastSuccessfulAt:at});
  });
  it("couples Gradescope metadata/status clocks and rejects equal-time metadata replacement",()=>{
    const snapshot=courseSnapshot("gradescope");
    const first=mergeGuestCourseResult(snapshot,result(snapshot,{stage:"gradescope",externalCourseId:"12",checkedAt:at,assignments:[{...metadata(snapshot),title:"First"}],statuses:[status(snapshot)]}),at,uuid);
    expect(first.assignments[0].metadataCheckedAt).toBe(checked);
    const equal=applyGuestCourseResult(first,result(first,{stage:"gradescope",externalCourseId:"12",checkedAt:at,assignments:[{...metadata(first),title:"Second"}],statuses:[status(first)]}),at,uuid);
    expect(equal.snapshot.assignments[0].title).toBe("First");
    expect(equal).toMatchObject({updatedCount:0,ignoredCount:1});
    const ahead={...snapshot,assignments:[{...snapshot.assignments[0],metadataCheckedAt:at}]};
    const blocked=applyGuestCourseResult(ahead,result(ahead,{stage:"gradescope",externalCourseId:"12",assignments:[metadata(ahead)],statuses:[status(ahead)]}),at,uuid);
    expect(blocked.snapshot.statuses).toEqual(ahead.statuses);
    expect(blocked).toMatchObject({updatedCount:0,ignoredCount:1});
  });
  it.each(["attempted","unattempted","completed"])("retains Ed %s progress and independent metadata/status clocks",progress=>{
    const snapshot=courseSnapshot("ed");
    const isComplete=progress==="completed";
    const incoming={...metadata(snapshot),status:isComplete?"submitted" as const:"pending" as const,sourceStatusText:progress};
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{stage:"ed",externalCourseId:"12",assignments:[incoming],statuses:[status(snapshot,{checkedAt:before,state:isComplete?"submitted":"unknown"})]}),at,uuid);
    expect(applied.snapshot.assignments[0]).toMatchObject({status:incoming.status,sourceStatusText:progress,metadataCheckedAt:checked});
    expect(applied.snapshot.statuses).toEqual(snapshot.statuses);
    expect(applied).toMatchObject({updatedCount:1,ignoredCount:0});
    const statusOnly=applyGuestCourseResult(snapshot,result(snapshot,{stage:"ed",externalCourseId:"12",checkedAt:before,assignments:[incoming],statuses:[status(snapshot,{state:isComplete?"submitted":"unknown"})]}),at,uuid);
    expect(statusOnly.snapshot.assignments).toEqual(snapshot.assignments);
    expect(statusOnly.snapshot.statuses[0].state).toBe(isComplete?"submitted":"unknown");
    expect(statusOnly).toMatchObject({updatedCount:1,ignoredCount:0});
  });
  it("preserves errored members without counting them as stale",()=>{
    const snapshot=courseSnapshot("ed");
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{stage:"ed",externalCourseId:"12",assignments:[{...metadata(snapshot),title:"Bad member"}],statuses:[status(snapshot,{errorCode:"UNRECOGNIZED_STATUS"})],failedCount:1,code:"PARTIAL_SYNC"}),at,uuid);
    expect(applied.snapshot.assignments).toEqual(snapshot.assignments);
    expect(applied.snapshot.statuses).toEqual(snapshot.statuses);
    expect(applied).toMatchObject({updatedCount:0,ignoredCount:0});
    expect(applied.snapshot.syncStates[0].lastErrorCode).toBe("PARTIAL_SYNC");
  });
  it.each(["gradescope","ed"] as const)("counts %s failures by course while preserving multiple errored members",source=>{
    const snapshot=courseSnapshot(source);
    snapshot.assignments.push({...snapshot.assignments[0],id:guestUuid(5),externalId:"second"});
    snapshot.statuses.push({...snapshot.statuses[0],assignmentId:guestUuid(5)});
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{stage:source,externalCourseId:"12",courseSucceeded:false,failedCount:1,
      code:source==="ed"?"ED_NETWORK_ERROR":"GRADESCOPE_NETWORK_ERROR",
      statuses:[status(snapshot,{errorCode:"UNRECOGNIZED_STATUS"}),status(snapshot,{externalId:"second",errorCode:"UNRECOGNIZED_STATUS"})]}),at,uuid);
    expect(applied).toMatchObject({updatedCount:0,ignoredCount:0});
    expect(applied.snapshot.assignments).toEqual(snapshot.assignments);
    expect(applied.snapshot.statuses).toEqual(snapshot.statuses);
    expect(applied.snapshot.syncStates[0].failedCount).toBe(1);
  });
  it("requires Canvas member failure totals to cover errored statuses",()=>{
    const snapshot=guestSnapshotFixture();
    snapshot.assignments.push({...snapshot.assignments[0],id:guestUuid(5),externalId:"second"});
    expect(()=>mergeGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status",failedCount:1,
      statuses:[status(snapshot,{errorCode:"UNRECOGNIZED_STATUS"}),status(snapshot,{externalId:"second",errorCode:"UNRECOGNIZED_STATUS"})]}),at,uuid))
      .toThrow(expect.objectContaining({code:"INVALID_RESULT"}));
  });
  it("indexes opaque __proto__ identities safely and preserves valid remaining order",()=>{
    const snapshot=guestSnapshotFixture({assignments:[],statuses:[],syncStates:[]});
    const row={...metadata(guestSnapshotFixture()),externalId:"__proto__"};
    const first=mergeGuestCourseResult(snapshot,result(snapshot,{assignments:[row]}),at,uuid);
    const second=mergeGuestCourseResult(first,result(first,{stage:"canvas-status",statuses:[{...status(guestSnapshotFixture()),externalId:"__proto__"}],remainingKeys:["__proto__"]}),at,uuid);
    expect(second.assignments[0].id).toBe(first.assignments[0].id);
    expect(second.syncStates.find(state=>state.stage==="canvas-status")?.resumeKeys).toEqual(["__proto__"]);
  });
  it("rejects foreign/duplicate members, generation mismatch and invalid remaining keys atomically",()=>{
    const snapshot=courseSnapshot("gradescope");
    const good=result(snapshot,{stage:"gradescope",externalCourseId:"12",assignments:[metadata(snapshot)],statuses:[status(snapshot)]});
    const invalid:Partial<GuestCourseResult>[]=[
      {sourceConnectionId:guestUuid(99)},{connectionGeneration:2},{externalCourseId:"99"},
      {assignments:[{...metadata(snapshot),source:"ed"}]},{assignments:[{...metadata(snapshot),courseId:"99"}]},
      {assignments:[metadata(snapshot),metadata(snapshot)]},{statuses:[status(snapshot),status(snapshot)]},
      {statuses:[status(snapshot,{externalId:"foreign"})]},{statuses:[]},{remainingKeys:["99"]},{remainingKeys:["12","12"]},
    ];
    for(const overrides of invalid)expect(()=>mergeGuestCourseResult(snapshot,{...good,...overrides},at,uuid)).toThrow(expect.objectContaining({name:"GuestDataError",code:"INVALID_RESULT",message:guestSafeMessage("INVALID_RESULT")}));
    expect(snapshot.assignments[0].title).toBe("Homework");
  });
  it("rejects writes through the wrong Canvas stage",()=>{
    const snapshot=guestSnapshotFixture();
    const invalid=expect.objectContaining({code:"INVALID_RESULT",message:guestSafeMessage("INVALID_RESULT")});
    expect(()=>mergeGuestCourseResult(snapshot,result(snapshot,{statuses:[status(snapshot)]}),at,uuid)).toThrow(invalid);
    expect(()=>mergeGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status",assignments:[metadata(snapshot)]}),at,uuid)).toThrow(invalid);
  });
  it("compares instants rather than timestamp formatting and preserves revision",()=>{
    const snapshot=guestSnapshotFixture({revision:7,syncStates:[]});
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{checkedAt:"2026-10-24T12:00:00Z",assignments:[{...metadata(snapshot),title:"Same instant"}]}),at,uuid);
    expect(applied).toMatchObject({updatedCount:0,ignoredCount:1});
    expect(applied.snapshot.revision).toBe(7);
    expect(applied.snapshot.assignments).toEqual(snapshot.assignments);
  });
  it("does not deduplicate distinct external identities by title, source kind or date",()=>{
    const snapshot=guestSnapshotFixture({syncStates:[]});
    const incoming={...metadata(snapshot),externalId:"another-assignment"};
    const applied=applyGuestCourseResult(snapshot,result(snapshot,{assignments:[incoming]}),at,uuid);
    expect(applied.snapshot.assignments).toHaveLength(2);
    expect(applied.snapshot.assignments[1].id).toBe(guestUuid(100));
    expect(applied.updatedCount).toBe(1);
  });
  it("preserves foreign source siblings with the same opaque external identity",()=>{
    const snapshot=courseSnapshot("ed");
    const canvas=guestSnapshotFixture();
    const combined={...snapshot,connections:[...snapshot.connections,{...canvas.connections[0],id:guestUuid(5)}],
      assignments:[...snapshot.assignments,{...canvas.assignments[0],id:guestUuid(6),sourceConnectionId:guestUuid(5)}]};
    const next=mergeGuestCourseResult(combined,result(combined,{stage:"ed",externalCourseId:"12",assignments:[{...metadata(combined),title:"Ed update"}]}),at,uuid);
    expect(next.assignments[0].title).toBe("Ed update");
    expect(next.assignments[1]).toEqual(combined.assignments[1]);
  });
  it("keeps total-failure freshness and the source error after a store-owned attempt reset",()=>{
    const snapshot=guestSnapshotFixture();
    snapshot.syncStates[0]={...snapshot.syncStates[0],lastAttemptedAt:checked,updatedCount:0,failedCount:0};
    const next=mergeGuestCourseResult(snapshot,result(snapshot,{stage:"canvas-status",courseSucceeded:false,failedCount:1,code:"CANVAS_NETWORK_ERROR"}),at,uuid);
    expect(next.syncStates[0]).toMatchObject({lastAttemptedAt:checked,lastSuccessfulAt:"2026-10-24T12:00:00.000Z",lastErrorCode:"CANVAS_NETWORK_ERROR",failedCount:1,updatedCount:0});
  });
  it("does not infer current-attempt success from old freshness equal to the attempt timestamp",()=>{
    const snapshot=guestSnapshotFixture();
    snapshot.syncStates[0]={...snapshot.syncStates[0],updatedCount:0,failedCount:0};
    const failed=result(snapshot,{stage:"canvas-status",courseSucceeded:false,failedCount:1,code:"CANVAS_NETWORK_ERROR"});
    const first=mergeGuestCourseResult(snapshot,failed,at,uuid);
    const second=mergeGuestCourseResult(first,failed,at,uuid);
    expect(first.syncStates[0]).toMatchObject({lastErrorCode:"CANVAS_NETWORK_ERROR",failedCount:1});
    expect(second.syncStates[0]).toMatchObject({lastErrorCode:"CANVAS_NETWORK_ERROR",failedCount:2,lastSuccessfulAt:"2026-10-24T12:00:00.000Z"});
  });
  it("rejects storage overflow atomically and exposes a fixed typed error",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    snapshot.assignments=Array.from({length:10000},(_,i)=>({...snapshot.assignments[0],id:guestUuid(i+10),externalId:`row-${i}`}));
    try {
      mergeGuestCourseResult(snapshot,result(snapshot,{assignments:[{...metadata(snapshot),externalId:"overflow"}]}),at,()=>guestUuid(20000));
      expect.unreachable("Overflow was accepted");
    } catch(error) {
      expect(error).toBeInstanceOf(GuestDataError);
      expect(error).toMatchObject({code:"GUEST_STORAGE_LIMIT",message:guestSafeMessage("GUEST_STORAGE_LIMIT")});
      expect(error).not.toHaveProperty("cause");
    }
    expect(snapshot.assignments).toHaveLength(10000);
    expect(snapshot.syncStates).toEqual([]);
  });
});
