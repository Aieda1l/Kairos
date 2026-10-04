// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchCanvasSubmissionStatuses } from "../src/canvas/fetch-statuses";
import type { SubmissionSyncRequestV1 } from "@/lib/extension-protocol/submission-status";

const html=fs.readFileSync(path.join(process.cwd(),"tests/fixtures/canvas-submission-pages/submitted.html"),"utf8");
const signedOut=fs.readFileSync(path.join(process.cwd(),"tests/fixtures/canvas-submission-pages/signed-out.html"),"utf8");
const request=(count=1):SubmissionSyncRequestV1=>({
  protocolVersion:1,
  requestId:"11111111-1111-4111-8111-111111111111",
  assignments:Array.from({length:count},(_,i)=>({
    assignmentLocalId:`local-${i+1}`,
    courseId:"999",
    assignmentId:String(4242+i),
  })),
});
const response=(body:string,status=200,url="https://canvas.uw.edu/courses/999/assignments/4242")=>({
  ok:status>=200&&status<300,status,url,text:async()=>body,
}) as Response;

describe("fetchCanvasSubmissionStatuses",()=>{
  it("uses a same-origin relative Canvas path and includes the signed-in session",async()=>{
    const fetchImpl=vi.fn(async()=>response(html));
    await fetchCanvasSubmissionStatuses(request(),fetchImpl as typeof fetch,()=>new Date("2026-10-04T06:00:00.000Z"));
    expect(fetchImpl).toHaveBeenCalledWith(
      "/courses/999/assignments/4242",
      expect.objectContaining({credentials:"include",redirect:"follow"}),
    );
  });

  it("limits concurrent Canvas requests to four",async()=>{
    let active=0,maxActive=0;
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{
      active++;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,5));
      active--;
      return response(html,200,new URL(String(input),"https://canvas.uw.edu").href);
    });
    const result=await fetchCanvasSubmissionStatuses(request(9),fetchImpl as typeof fetch,()=>new Date("2026-10-04T06:00:00.000Z"));
    expect(result.results).toHaveLength(9);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("rejects a successful response redirected to a different Canvas assignment",async()=>{
    const result=await fetchCanvasSubmissionStatuses(
      request(),
      (async()=>response(html,200,"https://canvas.uw.edu/courses/999/assignments/9999")) as typeof fetch,
      ()=>new Date("2026-10-04T06:00:00.000Z"),
    );

    expect(result.results[0]).toMatchObject({
      assignmentLocalId:"local-1",
      state:"unknown",
      errorCode:"UNRECOGNIZED_STATUS",
    });
    expect(JSON.stringify(result)).not.toContain("<html");
  });


  it("distinguishes missing assignment pages from transport failures",async()=>{
    const missing=await fetchCanvasSubmissionStatuses(
      request(),
      (async()=>response("",404,"https://canvas.uw.edu/courses/999/assignments/4242")) as typeof fetch,
      ()=>new Date("2026-10-04T06:00:00.000Z"),
    );
    expect(missing.results[0].errorCode).toBe("UNRECOGNIZED_STATUS");
  });

  it("maps signed-out, login, and network failures without leaking page HTML",async()=>{
    const unauthorized=await fetchCanvasSubmissionStatuses(request(),(async()=>response("",401)) as typeof fetch,()=>new Date("2026-10-04T06:00:00.000Z"));
    expect(unauthorized.results[0].errorCode).toBe("CANVAS_SIGNED_OUT");

    const login=await fetchCanvasSubmissionStatuses(request(),(async()=>response(signedOut,200,"https://canvas.uw.edu/login/canvas")) as typeof fetch,()=>new Date("2026-10-04T06:00:00.000Z"));
    expect(login.results[0].errorCode).toBe("CANVAS_SIGNED_OUT");
    expect(JSON.stringify(login)).not.toContain("<html");

    const network=await fetchCanvasSubmissionStatuses(request(2),(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith("/4242"))throw new Error("offline");
      return response(html,200,new URL(String(input),"https://canvas.uw.edu").href);
    }) as typeof fetch,()=>new Date("2026-10-04T06:00:00.000Z"));
    expect(network.results.map(r=>r.errorCode??null)).toContain("CANVAS_NETWORK_ERROR");
    expect(network.results.map(r=>r.state)).toContain("submitted");
    expect(network.errorCode).toBe("PARTIAL_SYNC");
  });
});
