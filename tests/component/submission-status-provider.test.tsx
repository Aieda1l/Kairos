// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasBatchResultV1, SubmissionFailureDiagnostic, SubmissionSyncErrorCode } from "@/lib/extension-protocol/submission-status";
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
    <span data-testid="retry-after">{sync.recovery?.retryAfterSeconds??"none"}</span>
    <button onClick={()=>void sync.syncNow()}>Manual status sync</button>
  </div>;
}

it('keeps fixed recovery safe and blocks repeat requests for bounded backoff',async()=>{
  const user=userEvent.setup();const fetchMock=vi.fn(async()=>new Response(JSON.stringify({code:'RATE_LIMITED',message:'synthetic-private-marker'}),{status:429,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',fetchMock);
  render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
  await user.click(screen.getByRole('button',{name:'Manual status sync'}));await user.click(screen.getByRole('button',{name:'Manual status sync'}));
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(screen.getByTestId('message')).toHaveTextContent('3600');expect(screen.getByTestId('message')).not.toHaveTextContent('synthetic-private-marker');
});

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
  ignoredStale?:number;
  failureDiagnostics?:{code:SubmissionFailureDiagnostic;count:number}[];
  failureHttpStatuses?:{status:number;count:number}[];
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
        ignoredStale:complete.ignoredStale??0,
        lastAttemptedAt:"2026-10-04T06:00:00.000Z",
        lastSuccessfulAt:complete.lastSuccessfulAt===undefined?"2026-10-04T06:00:01.000Z":complete.lastSuccessfulAt,
        lastErrorCode:complete.lastErrorCode??null,
        ...(complete.failureDiagnostics===undefined?{}:{failureDiagnostics:complete.failureDiagnostics}),
        ...(complete.failureHttpStatuses===undefined?{}:{failureHttpStatuses:complete.failureHttpStatuses}),
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
  it('does not refresh browser submission data until explicit opt-in, then refreshes once',async()=>{
    const {started,calls}=installFetch(1);syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    const view=render(<SubmissionStatusProvider enabled automaticEnabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(screen.getByTestId('detected')).toHaveTextContent('true'));
    expect(calls.start).toBe(0);expect(calls.complete).toBe(0);
    view.rerender(<SubmissionStatusProvider enabled automaticEnabled initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(calls.complete).toBe(1));expect(calls.start).toBe(1);
  });
  it("pings the Firefox extension and does not auto-sync fresh status",async()=>{
    installFetch(1);
    render(<SubmissionStatusProvider enabled initialSyncState={{
      ...initialState,lastSuccessfulAt:new Date(Date.now()-10*60*1000).toISOString(),
    }}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByTestId("detected")).toHaveTextContent("true"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses fixed guidance rather than raw extension error messages when detection fails",async()=>{
    pingKairosExtension.mockRejectedValue(new ExtensionBridgeError("EXTENSION_UNAVAILABLE","private-assignment-url-token"));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await waitFor(()=>expect(screen.getByTestId("message")).toHaveTextContent(/Firefox extension not detected/i));
    expect(screen.getByTestId("message")).not.toHaveTextContent("private-assignment-url-token");
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

  it.each([
    ["HTTP_429",/limited.*retry|limited.*try again/i],
    ["HTTP_5XX",/Canvas.*server error.*try again/i],
    ["FETCH_EXCEPTION",/Firefox.*Canvas request.*reload.*try again/i],
    ["HTTP_OTHER",/unexpected HTTP response.*retry/i],
  ] as const)("explains partial %s failures while retaining the completed count",async(code,cause)=>{
    const user=userEvent.setup();
    const {started}=installFetch(9,{
      updatedCount:8,failedCount:1,ignoredStale:7,lastErrorCode:"PARTIAL_SYNC",
      failureDiagnostics:[{code,count:1}],
    });
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId("message")).toHaveTextContent(/^8 of 9 submission statuses updated[.]/);
    expect(screen.getByTestId("message")).toHaveTextContent(cause);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["diagnostic","status"] as const)("blocks immediate partial retries for a 429 in any %s entry, then allows retry after the bounded cooldown",async(source)=>{
    const user=userEvent.setup();
    const now=vi.spyOn(Date,"now").mockReturnValue(Date.now());
    try{
      const {started,calls}=installFetch(3,{
        updatedCount:1,failedCount:2,lastErrorCode:"PARTIAL_SYNC",
        failureDiagnostics:source==="diagnostic"?[{code:"FETCH_EXCEPTION",count:1},{code:"HTTP_429",count:1}]:[],
        failureHttpStatuses:source==="status"?[{status:500,count:1},{status:429,count:1}]:[],
      });
      syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
      render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
      await user.click(screen.getByRole("button",{name:"Manual status sync"}));
      await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
      const seconds=Number(screen.getByTestId("retry-after").textContent);
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(3600);
      expect(screen.getByTestId("message")).toHaveTextContent(/limited/i);
      await user.click(screen.getByRole("button",{name:"Manual status sync"}));
      expect(calls.start).toBe(1);
      now.mockReturnValue(Date.now()+seconds*1000+1);
      await user.click(screen.getByRole("button",{name:"Manual status sync"}));
      await waitFor(()=>expect(calls.start).toBe(2));
    }finally{now.mockRestore();}
  });

  it.each([
    [404,/HTTP 404.*Canvas.*access.*retry/i],
    [503,/Canvas.*server error.*try again/i],
    [403,/check.*sign.*access|check.*sign.*open/i],
  ] as const)("explains partial HTTP %s when diagnostics are absent",async(status,cause)=>{
    const user=userEvent.setup();
    const {started}=installFetch(2,{updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC",failureHttpStatuses:[{status,count:1}]});
    syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId("message")).toHaveTextContent(cause);
  });

  it.each([
    ["CANVAS_NETWORK_ERROR",/temporarily unavailable.*retry/i],
    ["CANVAS_SIGNED_OUT",/check.*sign.*access|check.*sign.*open/i],
    ["UNRECOGNIZED_STATUS",/not be recognized.*retry/i],
  ] as const)("uses validated result %s when the completion has no diagnostic details",async(code,cause)=>{
    const user=userEvent.setup();
    const {started}=installFetch(2,{updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC"});
    const batch=batchResult(started.assignments);
    batch.results[1]={...batch.results[1],state:"unknown",errorCode:code};
    syncExtensionBatch.mockResolvedValue(batch);
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId("message")).toHaveTextContent(cause);
  });

  it("uses the batch failure after retaining an earlier successful batch and prior success",async()=>{
    const user=userEvent.setup();
    const previousSuccess="2026-10-04T05:00:00.000Z";
    const {started,calls}=installFetch(101,{updatedCount:100,failedCount:1,lastErrorCode:"PARTIAL_SYNC",lastSuccessfulAt:previousSuccess});
    syncExtensionBatch.mockResolvedValueOnce(batchResult(started.assignments.slice(0,100)))
      .mockRejectedValueOnce(new ExtensionBridgeError("EXTENSION_TIMEOUT","private-assignment-url-token"));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={{...initialState,lastSuccessfulAt:previousSuccess}}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId("message")).toHaveTextContent(/100 of 101.*extension timed out.*retry/i);
    expect(screen.getByTestId("message")).not.toHaveTextContent("private-assignment-url-token");
    expect(calls.completeBody[0]).toMatchObject({batchErrorCode:"EXTENSION_TIMEOUT",results:expect.any(Array)});
    expect((calls.completeBody[0] as {results:unknown[]}).results).toHaveLength(100);
    expect(screen.getByTestId("last-success")).toHaveTextContent(previousSuccess);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([false,true])("keeps generic safe partial guidance when no known cause exists (unknown code: %s)",async(unknownCode)=>{
    const user=userEvent.setup();
    const {started}=installFetch(2,{updatedCount:1,failedCount:1,lastErrorCode:"PARTIAL_SYNC",failureDiagnostics:[],failureHttpStatuses:[]});
    if(unknownCode)syncExtensionBatch.mockRejectedValue(new ExtensionBridgeError("private-url-token" as SubmissionSyncErrorCode,"private-assignment-title"));
    else syncExtensionBatch.mockResolvedValue(batchResult(started.assignments));
    render(<SubmissionStatusProvider enabled={false} initialSyncState={initialState}><Consumer/></SubmissionStatusProvider>);
    await user.click(screen.getByRole("button",{name:"Manual status sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId("message")).toHaveTextContent(/1 of 2.*previously saved data.*retry/i);
    expect(screen.getByTestId("message")).not.toHaveTextContent(/private-url-token|private-assignment-title|local-1|4242|2026-/);
  });
});
