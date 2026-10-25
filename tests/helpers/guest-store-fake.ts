import {vi} from "vitest";
import type {GuestSnapshot,GuestStore} from "@/lib/guest/types";

export function guestSnapshot():GuestSnapshot {
  return {schemaVersion:1,datasetId:"11111111-1111-4111-8111-111111111111",revision:0,connections:[],courses:[],assignments:[],statuses:[],syncStates:[],preferences:{timeZone:"Asia/Tokyo",filters:{course:"",source:"",search:""},sort:"due",automaticCanvas:true,automaticGradescope:true}};
}

// Presentation fake only: no transaction, merge, or lease algorithms.
export function guestStoreFake(initial=guestSnapshot()) {
  let snapshot=initial;
  const listeners=new Set<()=>void>();
  const unavailable=async()=>{throw Error("Unused store method");};
  const store:GuestStore={
    getIdentity:vi.fn(async()=>({datasetId:snapshot.datasetId,revision:snapshot.revision})),
    read:vi.fn(async()=>snapshot),
    subscribe:vi.fn(listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}),
    savePreferences:vi.fn(async patch=>{snapshot={...snapshot,revision:snapshot.revision+1,preferences:{...snapshot.preferences,...patch}};return snapshot;}),
    close:vi.fn(),setEnabledCourses:unavailable,beginRun:unavailable,renewRun:unavailable,releaseRun:unavailable,registerRequest:unavailable,markStageAttempt:unavailable,invalidateRun:unavailable,commit:unavailable,readRememberedSecret:vi.fn(unavailable),forgetCredential:unavailable,disconnect:unavailable,replaceDataset:unavailable,clear:unavailable,
  };
  return {store,notify:()=>listeners.forEach(listener=>listener()),replace:(value:GuestSnapshot)=>{snapshot=value;listeners.forEach(listener=>listener());}};
}
