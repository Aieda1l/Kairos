import type { GuestSnapshot } from "@/lib/guest/types";

export function guestUuid(index:number):string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffffffff) throw new RangeError("Invalid fixture UUID index.");
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12,"0")}`;
}

export function guestSnapshotFixture(overrides:Partial<GuestSnapshot>={}):GuestSnapshot {
  const at="2026-10-24T12:00:00.000Z";
  return {
    schemaVersion:1,datasetId:guestUuid(1),revision:0,
    connections:[{id:guestUuid(2),kind:"canvas",enabled:true,generation:1,createdAt:at,updatedAt:at}],
    courses:[],
    assignments:[{id:guestUuid(3),sourceConnectionId:guestUuid(2),metadataCheckedAt:at,
      source:"canvas",externalId:"event-assignment-42",courseId:"12",courseName:"Math",title:"Homework",
      releaseAt:null,dueAt:at,lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,
      gradeMax:null,gradeDisplay:null,sourceUrl:"https://canvas.uw.edu/courses/12/assignments/42",
      sourceUpdatedAt:null,firstSeenAt:at,lastSeenAt:at}],
    statuses:[{assignmentId:guestUuid(3),state:"submitted",isLate:false,isMissing:false,submittedAt:at,checkedAt:at,extractorVersion:"1"}],
    syncStates:[{sourceConnectionId:guestUuid(2),stage:"canvas-status",lastAttemptedAt:at,lastSuccessfulAt:at,
      hasSuccessfulCheck:false,lastErrorCode:null,updatedCount:1,failedCount:0,resumeKeys:[]}],
    preferences:{timeZone:"America/Los_Angeles",filters:{course:"",source:"",search:""},sort:"due",automaticCanvas:false,automaticGradescope:false},
    ...overrides,
  };
}
