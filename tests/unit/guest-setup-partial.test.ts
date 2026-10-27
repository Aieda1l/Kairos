import {expect,it} from "vitest";
import {applyChanges} from "@/lib/guest/store-data";
import type {GuestCommitChanges,GuestRequestFence} from "@/lib/guest/types";
import {guestSnapshotFixture,guestUuid} from "../helpers/guest-fixtures";

const at="2026-10-24T13:00:00.000Z";
const snapshot=guestSnapshotFixture({connections:[],courses:[],assignments:[],statuses:[],syncStates:[]});
const fence:GuestRequestFence={datasetId:snapshot.datasetId,runId:guestUuid(20),pageEpoch:guestUuid(21),generation:1,requestId:guestUuid(22),operation:"canvas-feed",source:"canvas",purpose:"setup",connectionId:null,connectionGeneration:null,deadlineAtMs:Date.parse(at)+15000};
const registration={fence,members:{canvas:[],courseIds:[]},intent:"provider-read" as const,consumed:false};
const connect:Extract<GuestCommitChanges,{kind:"connect"}>={kind:"connect",connection:{id:guestUuid(2),kind:"canvas",enabled:true,generation:1,createdAt:at,updatedAt:at},courses:[],assignments:[],secret:null};

it("keeps omitted initial Canvas report backward compatible",()=>{
  const saved=applyChanges(snapshot,fence,registration,connect,at,()=>guestUuid(30));
  expect(saved.snapshot.syncStates[0]).toMatchObject({hasSuccessfulCheck:true,failedCount:0,lastErrorCode:null});
});
it("reuses canonical Canvas report validation and rejects non-Canvas diagnostics",()=>{
  for(const report of [{skippedCount:0,malformedCount:1,partial:true},{skippedCount:1,malformedCount:1,partial:false},{skippedCount:5001,malformedCount:0,partial:false},{skippedCount:-1,malformedCount:0,partial:false},{skippedCount:1,malformedCount:1,partial:true,extra:"bad"}]){
    expect(()=>applyChanges(snapshot,fence,registration,{...connect,canvasReport:report},at,()=>guestUuid(30))).toThrow(expect.objectContaining({code:"INVALID_RESULT"}));
  }
  for(const source of ["ed","gradescope"] as const){
    const request={...fence,source,operation:source==="ed"?"ed-courses" as const:"gradescope-discovery" as const};
    expect(()=>applyChanges(snapshot,request,{...registration,fence:request},{...connect,connection:{...connect.connection,kind:source},canvasReport:{skippedCount:1,malformedCount:1,partial:true}},at,()=>guestUuid(30))).toThrow(expect.objectContaining({code:"INVALID_RESULT"}));
  }
  expect(snapshot.connections).toEqual([]);expect(snapshot.syncStates).toEqual([]);
});
