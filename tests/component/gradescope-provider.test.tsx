// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { GradescopeSyncErrorCode, GradescopeSyncResultV1 } from "@/lib/extension-protocol/gradescope";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

const {refresh,pingKairosExtension,discoverGradescopeExtension,syncGradescopeExtensionBatch}=vi.hoisted(()=>({
  refresh:vi.fn(),
  pingKairosExtension:vi.fn(),
  discoverGradescopeExtension:vi.fn(),
  syncGradescopeExtensionBatch:vi.fn(),
}));

vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));
vi.mock("@/features/submission-status/extension-bridge",async()=>{
  const actual=await vi.importActual<typeof import("@/features/submission-status/extension-bridge")>(
    "@/features/submission-status/extension-bridge",
  );
  return {...actual,pingKairosExtension};
});
vi.mock("@/features/gradescope/extension-bridge",()=>({
  discoverGradescopeExtension,
  syncGradescopeExtensionBatch,
}));

import { GradescopeProvider, useGradescope } from "@/features/gradescope/gradescope-provider";

const requestId="11111111-1111-4111-8111-111111111111";

const connection:SourceConnection={
  id:"connection-1",
  kind:"gradescope",
  label:"Gradescope",
  enabled:true,
  lastSyncStartedAt:null,
  lastSyncCompletedAt:null,
  lastSyncStatus:"never",
  lastErrorCode:null,
};

const course=(enabled=false):SourceCourse=>({
  id:"course-local-1",
  sourceConnectionId:connection.id,
  externalCourseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
  enabled,
  firstSeenAt:"2026-10-05T00:00:00.000Z",
  lastSeenAt:"2026-10-05T00:00:00.000Z",
});

const emptyState:SubmissionStatusSyncState<GradescopeSyncErrorCode>={
  lastAttemptedAt:null,
  lastSuccessfulAt:null,
  lastErrorCode:null,
  updatedCount:0,
  failedCount:0,
};

function Consumer(){
  const value=useGradescope();
  return <div>
    <span data-testid="phase">{value.phase}</span>
    <span data-testid="courses">{value.courses.map(c=>`${c.externalCourseId}:${c.enabled}`).join(",")}</span>
    <span data-testid="tab">{String(value.gradescopeTabDetected)}</span>
    <span data-testid="message">{value.message}</span>
    <button onClick={()=>void value.discoverCourses()}>Discover</button>
    <button onClick={()=>void value.saveEnabledCourses(["123"])}>Save</button>
    <button onClick={()=>void value.syncNow()}>Sync</button>
  </div>;
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

function installFetch({initialCourse=course(false)}:{initialCourse?:SourceCourse}={}){
  const calls={discoverStart:0,discoverComplete:0,selection:0,syncStart:0,syncComplete:0};
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith("/discover/start")){
      calls.discoverStart++;
      return json({requestId,protocolVersion:1});
    }
    if(url.endsWith("/discover/complete")){
      calls.discoverComplete++;
      return json({connection,courses:[initialCourse]});
    }
    if(url.endsWith("/courses")){
      calls.selection++;
      return json({connection,courses:[course(true)]});
    }
    if(url.endsWith("/sync/start")){
      calls.syncStart++;
      return json({protocolVersion:1,requestId,courseIds:["123"],maxCourseBatchSize:20});
    }
    if(url.endsWith("/sync/complete")){
      calls.syncComplete++;
      return json({
        requestId,
        insertedCount:1,
        updatedCount:0,
        statusUpdatedCount:1,
        failedCourseCount:0,
        ignoredStale:0,
        lastAttemptedAt:"2026-10-05T05:00:00.000Z",
        lastSuccessfulAt:"2026-10-05T05:00:01.000Z",
        lastErrorCode:null,
        failureDiagnostics:[],
        failureHttpStatuses:[],
      });
    }
    throw new Error(`Unexpected fetch ${url} ${init?.method??"GET"}`);
  }));
  return calls;
}

function syncResult():GradescopeSyncResultV1{
  return {
    protocolVersion:1,
    requestId,
    courses:[{
      courseId:"123",
      checkedAt:"2026-10-05T05:00:00.000Z",
      assignments:[],
      errorCode:null,
      parseDiagnosticCounts:[],
    }],
    errorCode:null,
  };
}

beforeEach(()=>{
  refresh.mockReset();
  pingKairosExtension.mockReset().mockResolvedValue({
    extensionVersion:"0.3.0",
    canvasTabDetected:true,
    gradescopeTabDetected:true,
  });
  discoverGradescopeExtension.mockReset().mockResolvedValue({
    protocolVersion:1,
    requestId,
    courses:[{courseId:"123",shortName:"CSE 331",fullName:"Software Design",term:"Autumn",year:"2026"}],
    errorCode:null,
  });
  syncGradescopeExtensionBatch.mockReset().mockResolvedValue(syncResult());
  vi.unstubAllGlobals();
});

describe("GradescopeProvider",()=>{
  it("discovers courses and preserves disabled-by-default server selection",async()=>{
    const user=userEvent.setup();
    const calls=installFetch();
    render(<GradescopeProvider connection={null} initialCourses={[]} initialSyncState={emptyState}>
      <Consumer/>
    </GradescopeProvider>);

    await user.click(screen.getByRole("button",{name:"Discover"}));
    await waitFor(()=>expect(screen.getByTestId("courses")).toHaveTextContent("123:false"));
    expect(calls.discoverStart).toBe(1);
    expect(calls.discoverComplete).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("saves enabled course selection locally",async()=>{
    const user=userEvent.setup();
    const calls=installFetch();
    render(<GradescopeProvider connection={connection} initialCourses={[course(false)]} initialSyncState={emptyState}>
      <Consumer/>
    </GradescopeProvider>);

    await user.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(screen.getByTestId("courses")).toHaveTextContent("123:true"));
    expect(calls.selection).toBe(1);
  });

  it("auto-syncs stale enabled Gradescope once under StrictMode",async()=>{
    const calls=installFetch({initialCourse:course(true)});
    render(<StrictMode><GradescopeProvider connection={connection} initialCourses={[course(true)]} initialSyncState={emptyState}>
      <Consumer/>
    </GradescopeProvider></StrictMode>);

    await waitFor(()=>expect(calls.syncComplete).toBe(1));
    expect(calls.syncStart).toBe(1);
    expect(syncGradescopeExtensionBatch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not auto-sync when fresh or when no course is enabled",async()=>{
    const calls=installFetch();
    const fresh={...emptyState,lastSuccessfulAt:new Date(Date.now()-5*60*1000).toISOString()};
    const view=render(<GradescopeProvider connection={connection} initialCourses={[course(true)]} initialSyncState={fresh}>
      <Consumer/>
    </GradescopeProvider>);
    await waitFor(()=>expect(pingKairosExtension).toHaveBeenCalled());
    expect(calls.syncStart).toBe(0);

    view.rerender(<GradescopeProvider connection={connection} initialCourses={[course(false)]} initialSyncState={emptyState}>
      <Consumer/>
    </GradescopeProvider>);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(calls.syncStart).toBe(0);
  });

  it("re-pings and succeeds on manual retry after Gradescope tab was missing",async()=>{
    const user=userEvent.setup();
    const calls=installFetch({initialCourse:course(true)});
    pingKairosExtension
      .mockReset()
      .mockResolvedValueOnce({extensionVersion:"0.3.0",canvasTabDetected:true,gradescopeTabDetected:false})
      .mockResolvedValue({extensionVersion:"0.3.0",canvasTabDetected:true,gradescopeTabDetected:true});

    render(<GradescopeProvider connection={connection} initialCourses={[course(true)]} initialSyncState={{
      ...emptyState,lastSuccessfulAt:new Date().toISOString(),
    }}>
      <Consumer/>
    </GradescopeProvider>);

    await waitFor(()=>expect(screen.getByTestId("tab")).toHaveTextContent("false"));
    await user.click(screen.getByRole("button",{name:"Sync"}));
    await waitFor(()=>expect(calls.syncComplete).toBe(1));
    expect(pingKairosExtension).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase")).toHaveTextContent("success");
  });
});
