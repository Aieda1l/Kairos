// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createGuestBridgeReader} from "@/lib/guest/sync/bridge-reader";
import {createGuestRequestRegistry} from "@/lib/guest/sync/request-registry";
import {guestUuid} from "../helpers/guest-fixtures";

const requestId=guestUuid(10),secret="private-upstream-message";
function emit(data:unknown){window.dispatchEvent(new MessageEvent("message",{source:window,origin:window.location.origin,data}));}
beforeEach(()=>{
  vi.useFakeTimers();
  vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("Unexpected hosted fetch");}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe("guest bridge wire readers",()=>{
  it("uses v1 PONG and accepts an unshared release without semver coupling",async()=>{
    const post=vi.spyOn(window,"postMessage").mockImplementation(data=>{
      emit({source:"kairos-extension",type:"PONG",protocolVersion:1,requestId:data.requestId,
        extensionVersion:"unshared",canvasTabDetected:true});
    });
    await expect(createGuestBridgeReader().ping()).resolves.toEqual({extensionVersion:"unshared",canvasTabDetected:true,gradescopeTabDetected:false});
    expect(post).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(0);
  });
  it("ignores wrong outer UUIDs and rejects wrong Canvas nested UUIDs",async()=>{
    vi.spyOn(window,"postMessage").mockImplementation(data=>{
      emit({source:"kairos-extension",type:"SYNC_SUBMISSION_STATUS_RESULT",protocolVersion:1,requestId:guestUuid(11),payload:{protocolVersion:1,requestId,results:[]}});
      emit({source:"kairos-extension",type:"SYNC_SUBMISSION_STATUS_RESULT",protocolVersion:1,requestId:data.requestId,payload:{protocolVersion:1,requestId:guestUuid(11),results:[]}});
    });
    await expect(createGuestBridgeReader().canvas({protocolVersion:1,requestId,assignments:[]})).rejects.toMatchObject({code:"INVALID_RESULT",message:"The source returned an invalid result."});
  });
  it.each(["canvas","gradescopeDiscover","gradescopeSync"] as const)("maps %s upstream messages to fixed safe errors",async method=>{
    vi.spyOn(window,"postMessage").mockImplementation(data=>{
      emit({source:"kairos-extension",type:"ERROR",protocolVersion:1,requestId:data.requestId,errorCode:"EXTENSION_UNAVAILABLE",message:secret});
    });
    const reader=createGuestBridgeReader();
    const promise=method==="canvas"?reader.canvas({protocolVersion:1,requestId,assignments:[]}):method==="gradescopeDiscover"?
      reader.gradescopeDiscover({protocolVersion:1,requestId}):reader.gradescopeSync({protocolVersion:1,requestId,courseIds:["12"]});
    await expect(promise).rejects.toMatchObject({code:"EXTENSION_UNAVAILABLE",message:"Connect the Kairos extension to continue."});
    expect(fetch).toHaveBeenCalledTimes(0);
  });
  it("leaves Gradescope membership and single consumption to the coordinator registry",async()=>{
    vi.spyOn(window,"postMessage").mockImplementation(data=>emit({source:"kairos-extension",type:"GRADESCOPE_DISCOVER_COURSES_RESULT",protocolVersion:1,
      requestId:data.requestId,payload:{protocolVersion:1,requestId:guestUuid(11),courses:[]}}));
    const registry=createGuestRequestRegistry({now:()=>1000});
    expect(registry.register({fence:{datasetId:guestUuid(1),runId:guestUuid(4),pageEpoch:guestUuid(5),generation:1,requestId,operation:"gradescope-discovery",
      source:"gradescope",purpose:"setup",connectionId:null,connectionGeneration:null,deadlineAtMs:31_000},members:{canvas:[],courseIds:[]}})).toBe(true);
    const result=await createGuestBridgeReader().gradescopeDiscover({protocolVersion:1,requestId});
    expect(()=>registry.accept(requestId,result,1000)).toThrow("The source returned an invalid result.");
    expect(registry.accept(requestId,{...result,requestId},1000)).not.toBeNull();
    expect(registry.accept(requestId,{...result,requestId},1000)).toBeNull();
  });
  it("passes explicit timeout and emits only the caller's registered batch UUID",async()=>{
    const post=vi.spyOn(window,"postMessage").mockImplementation(()=>{});
    const promise=createGuestBridgeReader().gradescopeSync({protocolVersion:1,requestId,courseIds:["12"]},20);
    const rejected=promise.catch(error=>error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await rejected).toMatchObject({code:"EXTENSION_TIMEOUT",message:"The Kairos extension did not respond in time."});
    expect(post.mock.calls[0][0]).toMatchObject({requestId,payload:{requestId}});
  });
});
