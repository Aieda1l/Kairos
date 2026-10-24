// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {useState} from 'react';
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

const {refresh}=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));

import { EdProvider, useEd } from "@/features/ed/ed-provider";
import {EdSourceCard} from '@/features/sources/ed-source-card';

const connection:SourceConnection={
  id:"ed-connection",
  kind:"ed",
  label:"Ed",
  enabled:true,
  lastSyncStartedAt:null,
  lastSyncCompletedAt:null,
  lastSyncStatus:"never",
  lastErrorCode:null,
};

const course:SourceCourse={
  id:"local-123",
  sourceConnectionId:connection.id,
  externalCourseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
  enabled:false,
  firstSeenAt:"2026-10-05T00:00:00Z",
  lastSeenAt:"2026-10-05T00:00:00Z",
};

const emptyState:SubmissionStatusSyncState<string>={
  lastAttemptedAt:null,
  lastSuccessfulAt:null,
  lastErrorCode:null,
  updatedCount:0,
  failedCount:0,
};

function Consumer(){
  const ed=useEd();
  const [outcome,setOutcome]=useState('');
  async function sync(options?:Parameters<typeof ed.syncNow>[0]){setOutcome(JSON.stringify(await ed.syncNow(options)));}
  return <div>
    <output data-testid="outcome">{outcome}</output>
    <output data-testid="recovery">{JSON.stringify({notice:ed.recovery,operation:ed.recoveryOperation})}</output>
    <output data-testid="sync-state">{JSON.stringify({lastAttemptedAt:ed.lastAttemptedAt,lastSuccessfulAt:ed.lastSuccessfulAt,lastErrorCode:ed.lastErrorCode,updatedCount:ed.updatedCount,failedCount:ed.failedCount})}</output>
    <span data-testid="phase">{ed.phase}</span>
    <span data-testid="message">{ed.message}</span>
    <span data-testid="courses">{ed.courses.map(c=>`${c.externalCourseId}:${c.enabled}`).join(",")}</span>
    <button onClick={()=>void ed.testToken("fixture-ed-token-never-echo")}>Test</button>
    <button onClick={()=>void ed.connect("fixture-ed-token-never-echo")}>Connect</button>
    <button onClick={()=>void ed.refreshCourses()}>Refresh</button>
    <button onClick={()=>void ed.saveEnabledCourses(["123"])}>Save</button>
    <button onClick={()=>void sync()}>Sync</button>
    <button onClick={()=>void sync({deferCalendarSync:true,syncAllRunId:'11111111-1111-4111-8111-111111111111'})}>Sync admitted</button>
    <button onClick={()=>void sync({deferCalendarSync:true,syncAllRunId:'22222222-2222-4222-8222-222222222222'})}>Sync fresh admitted</button>
    <button onClick={()=>void ed.refreshAccepted()}>Read accepted</button>
  </div>;
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

it('forwards the admitted run only as an HTTP header for Ed sync',async()=>{
  const requests=vi.fn(async()=>json({...validSync,insertedCount:0,updatedCount:0}));
  vi.stubGlobal('fetch',requests);
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync admitted'}));
  await waitFor(()=>expect(requests).toHaveBeenCalledWith('/api/sources/ed/sync',{
    method:'POST',headers:{'x-kairos-calendar-sync':'defer','x-kairos-sync-all-run':'11111111-1111-4111-8111-111111111111'},
  }));
});

const validSync={lastAttemptedAt:'2026-10-22T06:11:06Z',lastSuccessfulAt:'2026-10-22T06:11:06Z',lastErrorCode:null,statusUpdatedCount:1,failedCourseCount:0};

it.each([false,true])('only a fresh admitted run rechecks Ed recovery ownership (still uncertain: %s)',async stillUncertain=>{
  const user=userEvent.setup();let syncRequests=0;
  const requests=vi.fn(async(input:RequestInfo|URL)=>{
    if(String(input).endsWith('/courses'))return json({connection,courses:[course]});
    syncRequests++;
    return syncRequests===1||stillUncertain?json({code:'SYNC_RECOVERY_REQUIRED',message:'synthetic-private-detail'},409):json(validSync);
  });
  vi.stubGlobal('fetch',requests);
  const view=render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  await waitFor(()=>expect(screen.getByTestId('message')).toHaveTextContent(/uncertain outcome/));
  await user.click(screen.getByRole('button',{name:'Read accepted'}));
  view.rerender(<EdProvider connection={{...connection,lastSyncStatus:'success'}} initialCourses={[course]} initialSyncState={validSyncState}><Consumer/></EdProvider>);
  await user.click(screen.getByRole('button',{name:'Sync'}));
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  expect(syncRequests).toBe(1);
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"blocked"');
  await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
  await waitFor(()=>expect(syncRequests).toBe(2));
  expect(screen.getByTestId('outcome')).toHaveTextContent(`"status":"${stillUncertain?'blocked':'completed'}"`);
  expect(screen.getByTestId('phase')).toHaveTextContent(stillUncertain?'error':'success');
  expect(document.body).not.toHaveTextContent('synthetic-private-detail');
  if(stillUncertain){
    await user.click(screen.getByRole('button',{name:'Sync admitted'}));
    expect(syncRequests).toBe(2);
  }else{
    await user.click(screen.getByRole('button',{name:'Sync'}));
    expect(syncRequests).toBe(3);
  }
});

it('keeps uncertain work blocked after time passes and a fresh admission returns an invalid result',async()=>{
  let syncRequests=0;
  vi.stubGlobal('fetch',async()=>++syncRequests===1?json({code:'SYNC_RECOVERY_REQUIRED'},409):json({}));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  const later=Date.now()+24*60*60*1000;
  const now=vi.spyOn(Date,'now').mockReturnValue(later);
  try{
    await user.click(screen.getByRole('button',{name:'Sync'}));
    expect(syncRequests).toBe(1);
    await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
    expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"failed"');
    await user.click(screen.getByRole('button',{name:'Sync'}));
    expect(syncRequests).toBe(2);
    expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"blocked"');
  }finally{now.mockRestore();}
});
const validSyncState={lastAttemptedAt:validSync.lastAttemptedAt,lastSuccessfulAt:validSync.lastSuccessfulAt,lastErrorCode:null,updatedCount:1,failedCount:0};

it('keeps finite Ed cooldowns blocked even with a fresh admitted run',async()=>{
  const requests=vi.fn(async()=>json({code:'RATE_LIMITED',retryAfterSeconds:120},429));
  vi.stubGlobal('fetch',requests);
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
  expect(requests).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"blocked"');
  expect(screen.getByTestId('message')).toHaveTextContent('120 seconds');
});

it('retains uncertain ownership when a fresh recovery check is rate limited',async()=>{
  let syncRequests=0;
  vi.stubGlobal('fetch',async()=>++syncRequests===1?json({code:'SYNC_RECOVERY_REQUIRED'},409):json({code:'RATE_LIMITED',retryAfterSeconds:120},429));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
  await user.click(screen.getByRole('button',{name:'Sync'}));
  expect(syncRequests).toBe(2);
  expect(screen.getByTestId('outcome')).toHaveTextContent('120 seconds');
  const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+121000);
  try{
    await user.click(screen.getByRole('button',{name:'Sync'}));
    expect(syncRequests).toBe(2);
    expect(screen.getByTestId('outcome')).toHaveTextContent('uncertain outcome');
    expect(screen.getByTestId('message')).toHaveTextContent('uncertain outcome');
    expect(screen.getByTestId('recovery')).toHaveTextContent('"requiresSettlement":true');
    expect(screen.getByTestId('recovery')).toHaveTextContent('"operation":"sync"');
    expect(screen.getByTestId('phase')).toHaveTextContent('error');
  }finally{now.mockRestore();}
});

it.each([{},null,{...validSync,lastErrorCode:'UNKNOWN_PRIVATE_CODE'}, {...validSync,statusUpdatedCount:-1}])('rejects a malformed successful Ed sync payload (%j)',async body=>{
  vi.stubGlobal('fetch',async()=>json(body));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync'}));
  await waitFor(()=>expect(screen.getByTestId('phase')).toHaveTextContent('error'));
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"failed"');
  expect(screen.getByTestId('message')).not.toHaveTextContent('Ed sync complete.');
});

it.each([
  {...validSync,failedCourseCount:1},
  {...validSync,lastSuccessfulAt:null},
  {...validSync,lastSuccessfulAt:'2026-10-21T06:11:06Z'},
  {...validSync,lastErrorCode:'PARTIAL_SYNC',failedCourseCount:0},
  {...validSync,lastErrorCode:'PARTIAL_SYNC',failedCourseCount:1,lastSuccessfulAt:null},
  {...validSync,lastErrorCode:'PARTIAL_SYNC',failedCourseCount:1,lastSuccessfulAt:'2026-10-21T06:11:06Z'},
])('a contradictory Ed result cannot complete or clear uncertain ownership (%j)',async body=>{
  let requests=0;
  vi.stubGlobal('fetch',async()=>++requests===1?json({code:'SYNC_RECOVERY_REQUIRED'},409):json(body));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"failed"');
  expect(screen.getByTestId('sync-state')).toHaveTextContent(JSON.stringify(emptyState));
  await user.click(screen.getByRole('button',{name:'Sync'}));
  expect(requests).toBe(2);
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"blocked"');
});

it.each([
  ['ED_AUTH_INVALID',401,'2026-10-21T06:11:06Z'],
  ['ED_UPSTREAM_ERROR',502,null],
] as const)('retains accepted Ed sync metadata from a valid failed result (%s)',async(code,status,lastSuccessfulAt)=>{
  const priorState={...emptyState,lastSuccessfulAt:'2026-10-21T06:11:06Z'};
  vi.stubGlobal('fetch',async()=>json({...validSync,lastErrorCode:code,lastSuccessfulAt,statusUpdatedCount:0,failedCourseCount:2},status));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={priorState}><Consumer/></EdProvider>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Sync'}));
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"failed"');
  expect(screen.getByTestId('sync-state')).toHaveTextContent(JSON.stringify({lastAttemptedAt:validSync.lastAttemptedAt,lastSuccessfulAt:priorState.lastSuccessfulAt,lastErrorCode:code,updatedCount:0,failedCount:2}));
});

it('ignores malformed or unknown failed-result metadata without clearing Ed recovery',async()=>{
  let requests=0;
  vi.stubGlobal('fetch',async()=>++requests===1?json({code:'SYNC_RECOVERY_REQUIRED'},409):json({...validSync,lastErrorCode:'UNKNOWN_PRIVATE_CODE',failedCourseCount:2},502));
  render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Sync admitted'}));
  await user.click(screen.getByRole('button',{name:'Sync fresh admitted'}));
  expect(screen.getByTestId('sync-state')).toHaveTextContent(JSON.stringify(emptyState));
  await user.click(screen.getByRole('button',{name:'Sync'}));
  expect(requests).toBe(2);
  expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"blocked"');
});

it.each([
  [false,'Test connection','/api/sources/ed/test'],[true,'Test connection','/api/sources/ed/test'],
  [false,'Connect Ed','/api/sources/ed/connect'],[true,'Update token','/api/sources/ed/connect'],
  [true,'Refresh courses','/api/sources/ed/refresh'],[true,'Save selection','/api/sources/ed/courses'],
  [true,'Sync Ed','/api/sources/ed/sync'],
] as const)('card Retry retains the Ed operation and choices (%s): %s',async(accepted,buttonName,endpoint)=>{
  const user=userEvent.setup();const requests:Array<{url:string;init?:RequestInit}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{requests.push({url:String(input),init});return json({code:'SERVICE_UNAVAILABLE'},503);}));
  render(<EdProvider connection={accepted?connection:null} initialCourses={accepted?[course]:[]} initialSyncState={emptyState}><EdSourceCard/></EdProvider>);
  await user.type(screen.getByLabelText('Ed API token'),'fresh-memory');
  if(accepted)await user.click(screen.getByRole('checkbox',{name:/CSE 331/}));
  await user.click(screen.getByRole('button',{name:buttonName}));
  await user.click(screen.getByRole('button',{name:'Retry'}));
  expect(requests.map(request=>request.url)).toEqual([endpoint,endpoint]);
  expect(requests[1]?.init).toEqual(requests[0]?.init);
  if(accepted)expect(screen.getByRole('checkbox',{name:/CSE 331/})).toBeChecked();
  expect(screen.getByLabelText('Ed API token')).toHaveValue('fresh-memory');expect(document.documentElement.outerHTML).not.toContain('fresh-memory');
});

beforeEach(()=>{
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("EdProvider",()=>{
  it("presents a bounded admission retry while retaining accepted courses",async()=>{
    vi.stubGlobal("fetch",async()=>json({code:"RATE_LIMITED",message:"synthetic-private-detail",retryAfterSeconds:99999},429));
    render(<EdProvider connection={connection} initialCourses={[course]} initialSyncState={emptyState}><Consumer/></EdProvider>);
    await userEvent.setup().click(screen.getByRole("button",{name:"Test"}));
    await waitFor(()=>expect(screen.getByTestId("message")).toHaveTextContent("Try again in 3600 seconds."));
    expect(screen.getByTestId("message")).not.toHaveTextContent("synthetic-private-detail");
    expect(screen.getByTestId("courses")).toHaveTextContent("123:false");
  });
  it("sends the token only to test/connect and keeps later operations credential-free",async()=>{
    const user=userEvent.setup();
    const calls:Array<{url:string;body:string|null}>=[];

    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      calls.push({url,body:typeof init?.body==="string"?init.body:null});
      if(url.endsWith("/test"))return json({ok:true,itemCount:1});
      if(url.endsWith("/connect"))return json({connection,courses:[course]});
      if(url.endsWith("/refresh"))return json({connection,courses:[course]});
      if(url.endsWith("/courses"))return json({connection,courses:[{...course,enabled:true}]});
      if(url.endsWith("/sync"))return json({
        insertedCount:1,updatedCount:0,statusUpdatedCount:1,failedCourseCount:0,
        lastAttemptedAt:"2026-10-05T12:00:00Z",lastSuccessfulAt:"2026-10-05T12:00:00Z",lastErrorCode:null,
      });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<EdProvider connection={null} initialCourses={[]} initialSyncState={emptyState}><Consumer/></EdProvider>);

    await user.click(screen.getByRole("button",{name:"Test"}));
    await waitFor(()=>expect(screen.getByTestId("message")).toHaveTextContent("1 course"));
    await user.click(screen.getByRole("button",{name:"Connect"}));
    await waitFor(()=>expect(screen.getByTestId("courses")).toHaveTextContent("123:false"));
    await user.click(screen.getByRole("button",{name:"Refresh"}));
    await user.click(screen.getByRole("button",{name:"Save"}));
    await user.click(screen.getByRole("button",{name:"Sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("success"));

    expect(calls.find(call=>call.url.endsWith("/test"))?.body).toContain("fixture-ed-token-never-echo");
    expect(calls.find(call=>call.url.endsWith("/connect"))?.body).toContain("fixture-ed-token-never-echo");
    for(const call of calls.filter(call=>/\/(refresh|courses|sync)$/.test(call.url))){
      expect(call.body??"").not.toContain("fixture-ed-token-never-echo");
    }
  });

  it("surfaces partial sync without discarding public state",async()=>{
    const user=userEvent.setup();
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith("/sync"))return json({
        insertedCount:1,updatedCount:0,statusUpdatedCount:1,failedCourseCount:1,
        lastAttemptedAt:"2026-10-05T12:00:00Z",lastSuccessfulAt:"2026-10-05T12:00:00Z",lastErrorCode:"PARTIAL_SYNC",
      });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<EdProvider connection={connection} initialCourses={[{...course,enabled:true}]} initialSyncState={emptyState}><Consumer/></EdProvider>);
    await user.click(screen.getByRole("button",{name:"Sync"}));
    await waitFor(()=>expect(screen.getByTestId("phase")).toHaveTextContent("partial"));
    expect(screen.getByTestId('outcome')).toHaveTextContent('"status":"partial"');
    expect(screen.getByTestId("message")).toHaveTextContent(/some Ed courses/i);
    expect(screen.getByTestId("courses")).toHaveTextContent("123:true");
  });
});
