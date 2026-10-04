// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasBatchResultV1 } from "@/lib/extension-protocol/submission-status";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

const {refresh,pingKairosExtension,syncExtensionBatch}=vi.hoisted(()=>({
  refresh:vi.fn(),
  pingKairosExtension:vi.fn(),
  syncExtensionBatch:vi.fn(),
}));

vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));
vi.mock("@/features/submission-status/extension-bridge",async()=>{
  const actual=await vi.importActual<typeof import("@/features/submission-status/extension-bridge")>(
    "@/features/submission-status/extension-bridge",
  );
  return {...actual,pingKairosExtension,syncExtensionBatch};
});

import {
  SubmissionStatusProvider,
  useSubmissionStatusSync,
} from "@/features/submission-status/submission-status-provider";
import { ExtensionBridgeError } from "@/features/submission-status/extension-bridge";

const initialState:SubmissionStatusSyncState={
  lastAttemptedAt:null,
  lastSuccessfulAt:null,
  lastErrorCode:null,
  updatedCount:0,
  failedCount:0,
};

function Consumer(){
  const sync=useSubmissionStatusSync();
  return <div>
    <span data-testid="phase">{sync.phase}</span>
    <span data-testid="detected">{String(sync.extensionDetected)}</span>
    <span data-testid="last-success">{sync.lastSuccessfulAt??"never"}</span>
    <span data-testid="message">{sync.message}</span>
    <button onClick={()=>void sync.syncNow()}>Manual status sync</button>
  </div>;
}

function startPayload(count:number){
  return {
    requestId:"11111111-1111-4111-8111-111111111111",
    maxBatchSize:100,
    assignments:Array.from({length:count},(_,index)=>({
      assignmentLocalId:`local-${index+1}`,
      courseId:"999",
      assignmentId:String(4242+index),
    })),
  };
}

function batchResult(assignments:ReturnType<typeof startPayload>["assignments"]):CanvasBatchResultV1{
  return {
    protocolVersion:1,
    requestId:"11111111-1111-4111-8111-111111111111",
    results:assignments.map(item=>({
      ...item,
      state:"submitted",
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-04T06:00:00.000Z",
      extractorVersion:"canvas-html-v1",
    })),
    errorCode:null,
  };
}

function installFetch(count:number,complete:{
  updatedCount?:number;
  failedCount?:number;
  lastSuccessfulAt?:string|null;
  lastErrorCode?:string|null;
}={}){
  const started=startPayload(count);
  const calls:{start:number;complete:number;completeBody:unknown[]}={start:0,complete:0,completeBody:[]};
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith("/start")){
      calls.start++;
      return new Response(JSON.stringify(started),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.endsWith("/complete")){
      calls.complete++;
      calls.completeBody.push(init?.body?JSON.parse(String(init.body)):null);
      return new Response(JSON.stringify({
        requestId:started.requestId,
        updatedCount:complete.updatedCount??count,
        failedCount:complete.failedCount??0,
        ignoredStale:0,
        lastAttemptedAt:"2026-10-04T06:00:00.000Z",
        lastSuccessfulAt:complete.lastSuccessfulAt===undefined?"2026-10-04T06:00:01.000Z":complete.lastSuccessfulAt,
        lastErrorCode:complete.lastErrorCode??null,
      }),{status:200,headers:{"content-type":"application/json"}});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  return {started,calls};
}

beforeEach(()=>{
  refresh.mockReset();
  pingKairosExtension.mockReset().mockResolvedValue({extensionVersion:"0.2.0",canvasTabDetected:true});
  syncExtensionBatch.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SubmissionStatusProvider",()=>{
  it("pings the Firefox extension and does not auto-sync fresh status",async()=>{
    installFetch(1);
    render(<SubmissionStatusProvider enabled initialSyncState={{
      ...initialState,lastSuccessfulAt:new Date(Date.now()-10*60*1000).toISOString(),
    }}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByTestId("detected")).toHaveTextContent("true"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts automatic refresh only once per mounted page even under StrictMode effect replay",async()=>{
    const {started,calls}=installFetch(1);
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    render(<StrictMode><SubmissionStatusProvider enabled initialSyncState={initialState}><Consumer/></SubmissionStatusProvider></StrictMode>);
    await waitFor(()=>expect(calls.complete).toBe(1));
    expect(calls.start).toBe(1);
    expect(syncExtensionBatch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runs stale-on-open once when Canvas becomes enabled after the provider mounted",async()=>{
    const {started,calls}=installFetch(1);
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    const view=render(
      <SubmissionStatusProvider enabled={false} initialSyncState={initialState}>
        <Consumer/>
      </SubmissionStatusProvider>,
    );
    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalledTimes(1));
    expect(calls.start).toBe(0);

    view.rerender(
      <SubmissionStatusProvider enabled initialSyncState={initialState}>
        <Consumer/>
      </SubmissionStatusProvider>,
    );

    await waitFor(()=>expect(calls.complete).toBe(1));
    expect(calls.start).toBe(1);
    expect(syncExtensionBatch).toHaveBeenCalledTimes(1);
  });

  it("manual sync bypasses freshness",async()=>{
    const user=userEvent.setup();
    const {started,calls}=installFetch(1);
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    render(<SubmissionStatusProvider enabled initialSyncState={{
      ...initialState,lastSuccessfulAt:new Date(Date.now()-60*1000).toISOString(),
    }}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(calls.complete).toBe(1));
    expect(calls.start).toBe(1);
  });

  it("re-detects Canvas on manual retry after the tab was unavailable",async()=>{
    const user=userEvent.setup();
    const {started,calls}=installFetch(1);
    pingKairosExtension
      .mockReset()
      .mockResolvedValueOnce({extensionVersion:"0.2.0",canvasTabDetected:false})
      .mockResolvedValue({extensionVersion:"0.2.0",canvasTabDetected:true});
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));

    render(
      <SubmissionStatusProvider enabled={false} initialSyncState={initialState}>
        <Consumer/>
      </SubmissionStatusProvider>,
    );

    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(calls.complete).toBe(1));

    expect(pingKairosExtension).toHaveBeenCalledTimes(2);
    expect(syncExtensionBatch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("phase")).toHaveTextContent("success");
  });

  it("sends more than 100 assignments in sequential 100/100/5 chunks",async()=>{
    const user=userEvent.setup();
    const {started}=installFetch(205);
    let active=0,maxActive=0;
    syncExtensionBatch.mockImplementation(async(request)=>{
      active++;maxActive=Math.max(maxActive,active);
      const result=batchResult(request.assignments);
      active--;
      return result;
    });
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(syncExtensionBatch).toHaveBeenCalledTimes(3));
    expect(syncExtensionBatch.mock.calls.map(([request])=>request.assignments.length)).toEqual([100,100,5]);
    expect(maxActive).toBe(1);
    expect(started.assignments).toHaveLength(205);
  });

  it.each([
    ["EXTENSION_TIMEOUT","Firefox extension timed out."],
    ["EXTENSION_UNAVAILABLE","Firefox extension not detected"],
    ["CANVAS_TAB_UNAVAILABLE","Open Canvas in Firefox, then try again."],
    ["CANVAS_SIGNED_OUT","Sign in to Canvas, then retry."],
  ] as const)("records %s through completion without erasing prior success",async(code,message)=>{
    const user=userEvent.setup();
    const {calls}=installFetch(2,{
      updatedCount:0,
      failedCount:2,
      lastSuccessfulAt:"2026-10-04T05:00:00.000Z",
      lastErrorCode:code,
    });
    syncExtensionBatch.mockRejectedValue(new ExtensionBridgeError(code,message));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={{
      ...initialState,lastSuccessfulAt:"2026-10-04T05:00:00.000Z",
    }}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(calls.complete).toBe(1));
    expect(calls.completeBody[0]).toMatchObject({batchErrorCode:code,results:[]});
    expect(screen.getByTestId("last-success")).toHaveTextContent("2026-10-04T05:00:00.000Z");
    expect(screen.getByTestId("message")).toHaveTextContent(message);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes server-rendered data after a partial completion that advances last success",async()=>{
    const user=userEvent.setup();
    const {started}=installFetch(2,{updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC"});
    syncExtensionBatch.mockResolvedValue({
      ...batchResult(started.assignments),
      results:[
        batchResult(started.assignments).results[0],
        {...batchResult(started.assignments).results[1],state:"unknown",errorCode:"CANVAS_NETWORK_ERROR"},
      ],
      errorCode:"PARTIAL_SYNC",
    });
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
