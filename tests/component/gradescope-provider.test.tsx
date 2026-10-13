// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type {
  GradescopeSyncErrorCode,
  GradescopeSyncRequestV1,
  GradescopeSyncResultV1,
} from "@/lib/extension-protocol/gradescope";
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
import {GradescopeSourceCard} from '@/features/sources/gradescope-source-card';

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
    <span data-testid="recovery-operation">{value.recoveryOperation??'none'}</span>
    <button onClick={()=>void value.discoverCourses()}>Discover</button>
    <button onClick={()=>void value.saveEnabledCourses(["123"])}>Save</button>
    <button onClick={()=>void value.syncNow()}>Sync</button>
  </div>;
}

it('keeps fixed recovery safe and blocks repeat requests for bounded backoff',async()=>{
  const user=userEvent.setup();const fetchMock=vi.fn(async()=>new Response(JSON.stringify({code:'RATE_LIMITED',message:'synthetic-private-marker'}),{status:429,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',fetchMock);
  render(<GradescopeProvider connection={null} initialCourses={[]} initialSyncState={emptyState}><Consumer/></GradescopeProvider>);
  await user.click(screen.getByRole('button',{name:'Discover'}));await user.click(screen.getByRole('button',{name:'Discover'}));
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(screen.getByTestId('message')).toHaveTextContent('3600');expect(screen.getByTestId('message')).not.toHaveTextContent('synthetic-private-marker');
});

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

it.each([
  [false,'Discover courses','/api/sources/gradescope/discover/start'],
  [true,'Discover courses','/api/sources/gradescope/discover/start'],
  [true,'Save selection','/api/sources/gradescope/courses'],
  [true,'Sync Gradescope','/api/sources/gradescope/sync/start'],
] as const)('card Retry retains Gradescope operation and selection (%s): %s',async(accepted,buttonName,endpoint)=>{
  const user=userEvent.setup();const requests:Array<{url:string;init?:RequestInit}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{requests.push({url:String(input),init});return json({code:'SERVICE_UNAVAILABLE'},503);}));
  render(<GradescopeProvider connection={accepted?connection:null} initialCourses={accepted?[course(false)]:[]} initialSyncState={{...emptyState,lastSuccessfulAt:new Date().toISOString()}}><GradescopeSourceCard/></GradescopeProvider>);
  if(accepted)await user.click(screen.getByRole('checkbox',{name:/CSE 331/}));
  await user.click(screen.getByRole('button',{name:buttonName}));await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(requests.map(request=>request.url)).toEqual([endpoint,endpoint]);expect(requests[1]?.init).toEqual(requests[0]?.init);
  if(accepted)expect(screen.getByRole('checkbox',{name:/CSE 331/})).toBeChecked();
});

it.each([false,true])('suppresses stored extension errors for ineligible Gradescope (%s) but preserves new discovery feedback',async(enabled)=>{
  const user=userEvent.setup();const saved={...connection,enabled,lastErrorCode:'EXTENSION_UNAVAILABLE'};
  vi.stubGlobal('fetch',vi.fn(async()=>json({code:'EXTENSION_UNAVAILABLE'},503)));
  render(<GradescopeProvider connection={saved} initialCourses={[course(!enabled)]} initialSyncState={{...emptyState,lastErrorCode:'EXTENSION_UNAVAILABLE',lastSuccessfulAt:new Date().toISOString()}}><GradescopeSourceCard/></GradescopeProvider>);
  expect(screen.queryByRole('link',{name:'Verify extension'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Discover courses'}));
  expect(screen.getByRole('link',{name:'Verify extension'})).toHaveAttribute('href','/settings');
});

it.each([
  ['Discover','discovery','RATE_LIMITED'],['Save','selection','RATE_LIMITED'],['Sync','sync','RATE_LIMITED'],
  ['Discover','discovery','SYNC_RECOVERY_REQUIRED'],['Save','selection','SYNC_RECOVERY_REQUIRED'],['Sync','sync','SYNC_RECOVERY_REQUIRED'],
] as const)('keeps the local failure handler origin and admission behavior for %s %s %s',async(button,operation,code)=>{
  const user=userEvent.setup();const fetchMock=vi.fn(async()=>json({code,retryAfterSeconds:120,message:'synthetic-private-marker'},code==='RATE_LIMITED'?429:409));vi.stubGlobal('fetch',fetchMock);
  render(<GradescopeProvider connection={connection} initialCourses={[course(false)]} initialSyncState={emptyState}><Consumer/></GradescopeProvider>);
  await user.click(screen.getByRole('button',{name:button}));expect(screen.getByTestId('recovery-operation')).toHaveTextContent(operation);
  expect(screen.getByTestId('courses')).toHaveTextContent('123:false');expect(screen.getByTestId('message')).not.toHaveTextContent('synthetic-private-marker');
  await user.click(screen.getByRole('button',{name:button}));expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('message')).toHaveTextContent(code==='RATE_LIMITED'?'120 seconds':'uncertain outcome');
});

function installFetch({
  initialCourse=course(false),
  syncErrorCode=null,
}:{
  initialCourse?:SourceCourse;
  syncErrorCode?:GradescopeSyncErrorCode|null;
}={}){
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
        failedCourseCount:syncErrorCode?1:0,
        ignoredStale:0,
        lastAttemptedAt:"2026-10-05T05:00:00.000Z",
        lastSuccessfulAt:syncErrorCode?null:"2026-10-05T05:00:01.000Z",
        lastErrorCode:syncErrorCode,
        failureDiagnostics:[],
        failureHttpStatuses:[],
        failureErrorCodes:[],
        failureStructures:[],
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

  it("surfaces privacy-safe structure diagnostics when discovery finds zero courses",async()=>{
    const user=userEvent.setup();
    discoverGradescopeExtension.mockResolvedValueOnce({
      protocolVersion:1,
      requestId,
      courses:[],
      errorCode:null,
      discoveryDiagnostics:{
        accountRootDetected:true,
        createCourseControlDetected:false,
        headings:{courses:0,studentCourses:0,instructorCourses:0,other:1},
        courseListDescendantCount:0,
        courseListDirectCount:0,
        termDescendantCount:0,
        courseAnchorDescendantCount:0,
        courseHrefContainsCount:0,
        shortNameNodeCount:0,
        fullNameNodeCount:0,
        reactPropsNodeCount:3,
      },
    });
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith("/discover/start"))return json({requestId,protocolVersion:1});
      if(url.endsWith("/discover/complete"))return json({connection,courses:[]});
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<GradescopeProvider connection={connection} initialCourses={[]} initialSyncState={emptyState}>
      <Consumer/>
    </GradescopeProvider>);

    await user.click(screen.getByRole("button",{name:"Discover"}));
    await waitFor(()=>expect(screen.getByTestId("message")).toHaveTextContent("Discovery diagnostics:"));
    expect(screen.getByTestId("message")).toHaveTextContent("root=yes");
    expect(screen.getByTestId("message")).toHaveTextContent("reactProps=3");
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

  it("splits a variable number of enabled courses into 20-course sync batches",async()=>{
    const user=userEvent.setup();
    const courseIds=Array.from({length:21},(_,index)=>String(index+1));
    const manyCourses=courseIds.map((externalCourseId,index)=>({
      ...course(true),
      id:`course-local-${externalCourseId}`,
      externalCourseId,
      shortName:`Course ${index+1}`,
      fullName:`Course ${index+1}`,
    }));
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith("/sync/start")){
        return json({protocolVersion:1,requestId,courseIds,maxCourseBatchSize:20});
      }
      if(url.endsWith("/sync/complete")){
        return json({
          requestId,
          insertedCount:0,
          updatedCount:0,
          statusUpdatedCount:0,
          failedCourseCount:0,
          ignoredStale:0,
          lastAttemptedAt:"2026-10-05T05:00:00.000Z",
          lastSuccessfulAt:"2026-10-05T05:00:01.000Z",
          lastErrorCode:null,
          failureDiagnostics:[],
          failureHttpStatuses:[],
          failureErrorCodes:[],
          failureStructures:[],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));
    syncGradescopeExtensionBatch.mockImplementation(async (input:GradescopeSyncRequestV1)=>({
      protocolVersion:1,
      requestId:input.requestId,
      courses:input.courseIds.map(courseId=>({
        courseId,
        checkedAt:"2026-10-05T05:00:00.000Z",
        assignments:[],
        errorCode:null,
        parseDiagnosticCounts:[],
      })),
      errorCode:null,
    }));

    render(<GradescopeProvider
      connection={connection}
      initialCourses={manyCourses}
      initialSyncState={{...emptyState,lastSuccessfulAt:new Date().toISOString()}}
    >
      <Consumer/>
    </GradescopeProvider>);

    await user.click(screen.getByRole("button",{name:"Sync"}));
    await waitFor(()=>expect(syncGradescopeExtensionBatch).toHaveBeenCalledTimes(2));
    expect(syncGradescopeExtensionBatch.mock.calls[0]?.[0].courseIds).toHaveLength(20);
    expect(syncGradescopeExtensionBatch.mock.calls[1]?.[0].courseIds).toHaveLength(1);
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

  it("shows an actionable signed-out message when Gradescope reports an authenticated-session failure",async()=>{
    const user=userEvent.setup();
    const calls=installFetch({initialCourse:course(true),syncErrorCode:"GRADESCOPE_SIGNED_OUT"});
    syncGradescopeExtensionBatch.mockResolvedValue({
      protocolVersion:1,
      requestId,
      courses:[{
        courseId:"123",
        checkedAt:"2026-10-05T05:00:00.000Z",
        assignments:[],
        errorCode:"GRADESCOPE_SIGNED_OUT",
        parseDiagnosticCounts:[],
      }],
      errorCode:"GRADESCOPE_SIGNED_OUT",
    });

    render(<GradescopeProvider connection={connection} initialCourses={[course(true)]} initialSyncState={{
      ...emptyState,lastSuccessfulAt:new Date().toISOString(),
    }}>
      <Consumer/>
    </GradescopeProvider>);

    await user.click(screen.getByRole("button",{name:"Sync"}));
    await waitFor(()=>expect(calls.syncComplete).toBe(1));
    expect(screen.getByTestId("message")).toHaveTextContent("Sign in to Gradescope, then retry.");
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
