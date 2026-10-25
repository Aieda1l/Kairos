import { describe,expect,it,vi } from "vitest";
import { parseGuestBackup,serializeGuestBackup } from "@/lib/guest/backup";
import { GUEST_MAX_IMPORT_BYTES } from "@/lib/guest/limits";
import { guestSafeMessage } from "@/lib/guest/errors";
import { guestSnapshotFixture,guestUuid } from "../helpers/guest-fixtures";

const at="2026-10-24T14:00:00.000Z";
const invalid=expect.objectContaining({name:"GuestDataError",code:"INVALID_BACKUP",message:guestSafeMessage("INVALID_BACKUP")});
const unsupported=expect.objectContaining({name:"GuestDataError",code:"UNSUPPORTED_BACKUP_VERSION",message:guestSafeMessage("UNSUPPORTED_BACKUP_VERSION")});
describe("guest backup",()=>{
  it("round-trips canonical data without dataset identity or revision",()=>{
    const snapshot=guestSnapshotFixture();
    const parsed=parseGuestBackup(serializeGuestBackup(snapshot,at));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe(at);
    expect(parsed.data.assignments).toEqual(snapshot.assignments);
    expect(parsed.data.statuses).toEqual(snapshot.statuses);
    expect(Object.keys(parsed).sort()).toEqual(["data","exportedAt","schemaVersion"]);
    expect(Object.keys(parsed.data).sort()).toEqual(["assignments","connections","courses","preferences","statuses","syncStates"]);
  });
  it("preserves the canonical per-attempt success marker through backup projection",()=>{
    const snapshot=guestSnapshotFixture();
    snapshot.syncStates=[{...snapshot.syncStates[0],hasSuccessfulCheck:true}];
    const parsed=parseGuestBackup(serializeGuestBackup(snapshot,at));
    expect(parsed.data.syncStates[0]).toMatchObject({hasSuccessfulCheck:true});
  });
  it("projects every nested record onto its noncredential allowlist",()=>{
    const snapshot=guestSnapshotFixture();
    snapshot.courses=[{id:guestUuid(4),sourceConnectionId:guestUuid(2),externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:at,lastSeenAt:at}];
    const secretFields={credential:"secret-value",secret:"secret-value",capability:"secret-value",lease:"secret-value",pendingRequests:["secret-value"]};
    const polluted={...snapshot,...secretFields,
      connections:snapshot.connections.map(row=>({...row,...secretFields})),assignments:snapshot.assignments.map(row=>({...row,...secretFields})),
      courses:snapshot.courses.map(row=>({...row,...secretFields})),
      statuses:snapshot.statuses.map(row=>({...row,...secretFields})),syncStates:snapshot.syncStates.map(row=>({...row,...secretFields})),
      preferences:{...snapshot.preferences,...secretFields,filters:{...snapshot.preferences.filters,...secretFields}}};
    const serialized=serializeGuestBackup(polluted,at);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("datasetId");
    expect(serialized).not.toContain("revision");
    expect(parseGuestBackup(serialized).data).toEqual(parseGuestBackup(serializeGuestBackup(snapshot,at)).data);
  });
  it.each([0,2,99])("rejects unsupported backup version %s with a fixed safe code",schemaVersion=>{
    const backup=JSON.parse(serializeGuestBackup(guestSnapshotFixture(),at));
    expect(()=>parseGuestBackup(JSON.stringify({...backup,schemaVersion}))).toThrow(unsupported);
  });
  it("rejects malformed JSON, extra internal fields and invalid exports",()=>{
    const snapshot=guestSnapshotFixture();
    const backup=JSON.parse(serializeGuestBackup(snapshot,at));
    expect(()=>parseGuestBackup("{secret upstream text")).toThrow(invalid);
    expect(()=>parseGuestBackup(JSON.stringify({...backup,datasetId:snapshot.datasetId}))).toThrow(invalid);
    expect(()=>parseGuestBackup(JSON.stringify({...backup,data:{...backup.data,credentials:[]}}))).toThrow(invalid);
    expect(()=>serializeGuestBackup(snapshot,"invalid")).toThrow(invalid);
  });
  it("validates source, assignment, status and remaining-member references",()=>{
    const backup=JSON.parse(serializeGuestBackup(guestSnapshotFixture(),at));
    for(const data of [
      {...backup.data,connections:[]},
      {...backup.data,statuses:[{...backup.data.statuses[0],assignmentId:guestUuid(99)}]},
      {...backup.data,assignments:[{...backup.data.assignments[0],source:"ed",sourceUrl:null}]},
      {...backup.data,syncStates:[{...backup.data.syncStates[0],resumeKeys:["foreign"]}]},
      {...backup.data,statuses:[backup.data.statuses[0],backup.data.statuses[0]]},
    ])expect(()=>parseGuestBackup(JSON.stringify({...backup,data}))).toThrow(invalid);
  });
  it.each(["gradescope","ed"] as const)("requires a reconstructable %s course graph without changing IDs",source=>{
    const snapshot=guestSnapshotFixture({syncStates:[]});
    snapshot.connections[0].kind=source;
    snapshot.assignments[0]={...snapshot.assignments[0],source,sourceUrl:null};
    snapshot.courses=[{id:guestUuid(4),sourceConnectionId:guestUuid(2),externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:at,lastSeenAt:at}];
    const parsed=parseGuestBackup(serializeGuestBackup(snapshot,at));
    expect(parsed.data.courses[0].id).toBe(guestUuid(4));
    expect(parsed.data.assignments[0].id).toBe(guestUuid(3));
    expect(()=>parseGuestBackup(JSON.stringify({...parsed,data:{...parsed.data,courses:[]}}))).toThrow(invalid);
    expect(()=>parseGuestBackup(JSON.stringify({...parsed,data:{...parsed.data,courses:[{...parsed.data.courses[0],sourceConnectionId:guestUuid(99)}]}}))).toThrow(invalid);
  });
  it("rejects oversized UTF-8 input before parsing JSON",()=>{
    const parse=vi.spyOn(JSON,"parse");
    try{
      expect(()=>parseGuestBackup("\u00e9".repeat(GUEST_MAX_IMPORT_BYTES/2+1))).toThrow(invalid);
      expect(parse).not.toHaveBeenCalled();
    }finally{parse.mockRestore();}
  });
  it("rejects dataset byte/count overflow instead of truncating",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const backup=JSON.parse(serializeGuestBackup(snapshot,at));
    const rows=Array.from({length:10001},(_,i)=>({...snapshot.assignments[0],id:guestUuid(i+10),externalId:`row-${i}`}));
    expect(()=>parseGuestBackup(JSON.stringify({...backup,data:{...backup.data,assignments:rows}}))).toThrow(invalid);
    const large=rows.slice(0,5000).map(row=>({...row,sourceStatusText:"\u00e9".repeat(500),title:"x".repeat(500)}));
    expect(()=>parseGuestBackup(JSON.stringify({...backup,data:{...backup.data,assignments:large}}))).toThrow(invalid);
    expect(snapshot.assignments).toHaveLength(1);
  });
});
