// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

const {refresh}=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));

import { EdProvider, useEd } from "@/features/ed/ed-provider";

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
  return <div>
    <span data-testid="phase">{ed.phase}</span>
    <span data-testid="message">{ed.message}</span>
    <span data-testid="courses">{ed.courses.map(c=>`${c.externalCourseId}:${c.enabled}`).join(",")}</span>
    <button onClick={()=>void ed.testToken("fixture-ed-token-never-echo")}>Test</button>
    <button onClick={()=>void ed.connect("fixture-ed-token-never-echo")}>Connect</button>
    <button onClick={()=>void ed.refreshCourses()}>Refresh</button>
    <button onClick={()=>void ed.saveEnabledCourses(["123"])}>Save</button>
    <button onClick={()=>void ed.syncNow()}>Sync</button>
  </div>;
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

beforeEach(()=>{
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("EdProvider",()=>{
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
    expect(screen.getByTestId("message")).toHaveTextContent(/some Ed courses/i);
    expect(screen.getByTestId("courses")).toHaveTextContent("123:true");
  });
});
