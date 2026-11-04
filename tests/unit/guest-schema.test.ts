import { describe,expect,it,vi } from "vitest";
import { guestSyncStateSchema,parseGuestSnapshot } from "@/lib/guest/schema";
import { projectGuestAssignments } from "@/lib/guest/projection";
import { guestSafeCodeSchema,guestSafeMessage } from "@/lib/guest/errors";
import { guestSnapshotFixture,guestUuid } from "../helpers/guest-fixtures";

describe("guest dataset contracts",()=>{
  it("defaults legacy stage state to no current-attempt successful check and preserves explicit markers",()=>{
    const state=guestSnapshotFixture().syncStates[0];
    const legacy=Object.fromEntries(Object.entries(state).filter(([key])=>key!=="hasSuccessfulCheck"));
    expect(guestSyncStateSchema.parse(legacy)).toMatchObject({hasSuccessfulCheck:false});
    expect(guestSyncStateSchema.parse({...legacy,hasSuccessfulCheck:true})).toMatchObject({hasSuccessfulCheck:true});
    expect(()=>guestSyncStateSchema.parse({...legacy,hasSuccessfulCheck:"true"})).toThrow();
  });
  it("accepts Canvas feed rows without discovered courses and joins only public status fields",()=>{
    const snapshot=parseGuestSnapshot(guestSnapshotFixture());
    const {assignmentId,...expectedStatus}=snapshot.statuses[0];
    const {sourceConnectionId,metadataCheckedAt,...expectedAssignment}=snapshot.assignments[0];
    expect(projectGuestAssignments(snapshot)).toEqual([{...expectedAssignment,submissionStatus:expectedStatus}]);
    expect(assignmentId).toBe(snapshot.assignments[0].id);
    expect(sourceConnectionId).toBe(snapshot.connections[0].id);
    expect(metadataCheckedAt).toBe("2026-10-24T12:00:00.000Z");
  });
  it("projects absent status as null without mutating the snapshot",()=>{
    const snapshot=guestSnapshotFixture({statuses:[]});
    expect(projectGuestAssignments(snapshot)[0].submissionStatus).toBeNull();
    expect(snapshot.assignments[0]).not.toHaveProperty("submissionStatus");
  });
  it.each(["connections","assignments","statuses","syncStates"] as const)("rejects duplicate %s records",key=>{
    const snapshot=guestSnapshotFixture();
    expect(()=>parseGuestSnapshot({...snapshot,[key]:[...snapshot[key],snapshot[key][0]]})).toThrow();
  });
  it("rejects dangling status and connection references or source mismatches",()=>{
    const snapshot=guestSnapshotFixture();
    for(const assignments of [
      [{...snapshot.assignments[0],sourceConnectionId:guestUuid(999)}],
      [{...snapshot.assignments[0],source:"ed"}],
    ])expect(()=>parseGuestSnapshot({...snapshot,assignments})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,statuses:[{...snapshot.statuses[0],assignmentId:guestUuid(999)}]})).toThrow();
  });
  it("requires per-connection external course membership for Ed and Gradescope",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const at="2026-10-24T12:00:00.000Z";
    for(const source of ["ed","gradescope"] as const){
      const data={...snapshot,connections:[{...snapshot.connections[0],kind:source}],assignments:[{...snapshot.assignments[0],source,sourceUrl:null}]};
      expect(()=>parseGuestSnapshot(data)).toThrow();
      const course={id:guestUuid(4),sourceConnectionId:guestUuid(2),externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:at,lastSeenAt:at};
      expect(()=>parseGuestSnapshot({...data,courses:[course]})).not.toThrow();
      expect(()=>parseGuestSnapshot({...data,courses:[{...course,externalCourseId:"13"}]})).toThrow();
      expect(()=>parseGuestSnapshot({...data,courses:[course,course]})).toThrow();
      expect(()=>parseGuestSnapshot({...data,courses:[{...course,sourceConnectionId:guestUuid(999)}]})).toThrow();
    }
  });
  it("rejects duplicate source identities, unsupported stages, and unknown resume members",()=>{
    const snapshot=guestSnapshotFixture();
    expect(()=>parseGuestSnapshot({...snapshot,connections:[...snapshot.connections,{...snapshot.connections[0],id:guestUuid(8)}]})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,assignments:[...snapshot.assignments,{...snapshot.assignments[0],id:guestUuid(8)}]})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,syncStates:[{...snapshot.syncStates[0],stage:"ed"}]})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,syncStates:[{...snapshot.syncStates[0],resumeKeys:["missing"]}]})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,syncStates:[{...snapshot.syncStates[0],resumeKeys:["event-assignment-42"]}]})).not.toThrow();
  });
  it.each(["2026-02-30T00:00:00Z","2026-10-24T12:00:00+01:00","yesterday"])("rejects invalid UTC date %s",dueAt=>{
    const snapshot=guestSnapshotFixture();
    expect(()=>parseGuestSnapshot({...snapshot,assignments:[{...snapshot.assignments[0],dueAt}]})).toThrow();
  });
  it("rejects invalid timezones, secrets, identities and unsafe provider URLs",()=>{
    const snapshot=guestSnapshotFixture();
    expect(()=>parseGuestSnapshot({...snapshot,preferences:{...snapshot.preferences,timeZone:"Mars/Olympus"}})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,token:"secret"})).toThrow();
    for(const sourceUrl of ["javascript:alert(1)","https://canvas.example.edu/calendar?secret=x","https://user:pass@canvas.example.edu/courses/12/assignments/42","http://canvas.example.edu/courses/12/assignments/42"]){
      expect(()=>parseGuestSnapshot({...snapshot,assignments:[{...snapshot.assignments[0],sourceUrl}]})).toThrow();
    }
    expect(()=>parseGuestSnapshot({...snapshot,datasetId:"account-id"})).toThrow();
  });
  it("accepts canonical provider links and rejects even empty query or fragment components",()=>{
    const snapshot=guestSnapshotFixture();
    for(const sourceUrl of ["https://canvas.uw.edu/courses/12/assignments/42?","https://canvas.uw.edu/courses/12/assignments/42#"]){
      expect(()=>parseGuestSnapshot({...snapshot,assignments:[{...snapshot.assignments[0],sourceUrl}]})).toThrow();
    }
  });
  it.each([
    ["externalId",2048],["title",500],["courseName",240],["sourceStatusText",500],["gradeDisplay",200],["gradeScore",128],["gradeMax",128],
  ] as const)("preserves %s at its bound and rejects overflow without truncation",(field,length)=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const assignment={...snapshot.assignments[0],[field]:"x".repeat(length)};
    expect(parseGuestSnapshot({...snapshot,assignments:[assignment]}).assignments[0][field]).toBe("x".repeat(length));
    expect(()=>parseGuestSnapshot({...snapshot,assignments:[{...assignment,[field]:"x".repeat(length+1)}]})).toThrow();
  });
  it("preserves opaque IDs, nullable metadata and zero generations without normalization",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const assignment={...snapshot.assignments[0],externalId:"  opaque/ID?x=1  ",metadataCheckedAt:null,releaseAt:null,dueAt:null,lateDueAt:null,sourceUrl:null,courseId:null};
    const parsed=parseGuestSnapshot({...snapshot,connections:[{...snapshot.connections[0],generation:0}],assignments:[assignment]});
    expect(parsed.assignments[0]).toEqual(assignment);
    for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER+1])expect(()=>parseGuestSnapshot({...snapshot,revision})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,assignments:[{...assignment,externalId:""}]})).toThrow();
  });
  it("rejects assignment/count and serialized byte limits atomically",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const assignments=Array.from({length:10_000},(_,i)=>({...snapshot.assignments[0],id:guestUuid(i+10),externalId:`event-${i}`,title:"x".repeat(500),courseName:"y".repeat(240)}));
    expect(()=>parseGuestSnapshot({...snapshot,assignments:assignments.slice(0,1)})).not.toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,assignments})).toThrow();
    expect(()=>parseGuestSnapshot({...snapshot,assignments:Array.from({length:10_001},(_,i)=>({...snapshot.assignments[0],id:guestUuid(i+10),externalId:`event-${i}`}))})).toThrow();
  });
  it("accepts the assignment and course count boundaries before rejecting overflow",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const assignments=Array.from({length:10_000},(_,i)=>({...snapshot.assignments[0],id:guestUuid(i+10),externalId:`event-${i}`}));
    expect(parseGuestSnapshot({...snapshot,assignments}).assignments).toHaveLength(10_000);
    const course={sourceConnectionId:guestUuid(2),externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:"2026-10-24T12:00:00.000Z",lastSeenAt:"2026-10-24T12:00:00.000Z"};
    const courses=Array.from({length:1001},(_,i)=>({...course,id:guestUuid(i+20),externalCourseId:String(i)}));
    expect(parseGuestSnapshot({...snapshot,courses:courses.slice(0,1000)}).courses).toHaveLength(1000);
    expect(()=>parseGuestSnapshot({...snapshot,courses})).toThrow();
  });
  it("allows the same external course ID in distinct source connections",()=>{
    const snapshot=guestSnapshotFixture({statuses:[],syncStates:[]});
    const connections=[{...snapshot.connections[0],kind:"ed" as const},{...snapshot.connections[0],id:guestUuid(5),kind:"gradescope" as const}];
    const courses=connections.map((connection,i)=>({id:guestUuid(i+6),sourceConnectionId:connection.id,externalCourseId:"12",shortName:null,fullName:"Math",term:null,year:null,enabled:true,firstSeenAt:connection.createdAt,lastSeenAt:connection.createdAt}));
    const assignments=connections.map((connection,i)=>({...snapshot.assignments[0],id:guestUuid(i+8),sourceConnectionId:connection.id,source:connection.kind,sourceUrl:null}));
    expect(parseGuestSnapshot({...snapshot,connections,courses,assignments}).assignments).toHaveLength(2);
  });
  it("imports browser-safe modules without browser globals",async()=>{
    vi.stubGlobal("window",undefined);vi.stubGlobal("indexedDB",undefined);
    try{vi.resetModules();await expect(import("@/lib/guest/schema")).resolves.toBeDefined();await expect(import("@/lib/guest/sources/contracts")).resolves.toBeDefined();}finally{vi.unstubAllGlobals();}
  });
  it("uses closed safe codes and fixed copy",()=>{
    expect(guestSafeCodeSchema.safeParse("secret upstream message").success).toBe(false);
    expect(guestSafeMessage("GUEST_CREDENTIAL_REQUIRED")).toBe("Enter your source credential to continue.");
  });
});
