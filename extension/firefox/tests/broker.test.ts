import { describe, expect, it, vi } from "vitest";
import { handleBridgeRequest, type BrowserBrokerAdapter } from "../src/background/broker";

const requestId="11111111-1111-4111-8111-111111111111";
const syncMessage={
  source:"kairos-page" as const,
  type:"SYNC_SUBMISSION_STATUS" as const,
  protocolVersion:1 as const,
  requestId,
  payload:{
    protocolVersion:1 as const,
    requestId,
    assignments:[{assignmentLocalId:"local-1",courseId:"999",assignmentId:"4242"}],
  },
};
const gradescopeDiscoverMessage={
  source:"kairos-page" as const,
  type:"GRADESCOPE_DISCOVER_COURSES" as const,
  protocolVersion:1 as const,
  requestId,
  payload:{protocolVersion:1 as const,requestId},
};
const adapter=(overrides:Partial<BrowserBrokerAdapter>={}):BrowserBrokerAdapter=>({
  extensionVersion:()=>"0.3.0",
  findCanvasTab:async()=>null,
  sendToCanvasTab:vi.fn(),
  findGradescopeTab:async()=>null,
  sendToGradescopeTab:vi.fn(),
  ...overrides,
});

describe("handleBridgeRequest",()=>{
  it("reports both source tab diagnostics without requiring either tab",async()=>{
    await expect(handleBridgeRequest({
      source:"kairos-page",type:"PING",protocolVersion:1,requestId,
    },adapter())).resolves.toMatchObject({
      source:"kairos-extension",
      type:"PONG",
      extensionVersion:"0.3.0",
      canvasTabDetected:false,
      gradescopeTabDetected:false,
    });
  });

  it("preserves the stable Canvas no-tab behavior",async()=>{
    await expect(handleBridgeRequest(syncMessage,adapter())).resolves.toMatchObject({
      source:"kairos-extension",type:"ERROR",errorCode:"CANVAS_TAB_UNAVAILABLE",
    });
  });

  it("forwards only validated Canvas sync payloads to Canvas",async()=>{
    const sendToCanvasTab=vi.fn(async()=>({
      protocolVersion:1,requestId,
      results:[{
        assignmentLocalId:"local-1",courseId:"999",assignmentId:"4242",state:"submitted",
        isLate:false,isMissing:false,submittedAt:null,checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",
      }],
      errorCode:null,
    }));
    const result=await handleBridgeRequest(syncMessage,adapter({
      findCanvasTab:async()=>({id:7}),
      sendToCanvasTab,
    }));
    expect(sendToCanvasTab).toHaveBeenCalledWith(7,syncMessage.payload);
    expect(result).toMatchObject({type:"SYNC_SUBMISSION_STATUS_RESULT",payload:{requestId}});
  });

  it("routes Gradescope discovery only to a Gradescope tab",async()=>{
    const sendToGradescopeTab=vi.fn(async()=>({
      protocolVersion:1,requestId,
      courses:[{courseId:"123",shortName:"CSE",fullName:"Course",term:null,year:null}],
      errorCode:null,
    }));
    const result=await handleBridgeRequest(gradescopeDiscoverMessage,adapter({
      findCanvasTab:async()=>({id:7}),
      findGradescopeTab:async()=>({id:9}),
      sendToGradescopeTab,
    }));
    expect(sendToGradescopeTab).toHaveBeenCalledWith(9,gradescopeDiscoverMessage.payload);
    expect(result).toMatchObject({type:"GRADESCOPE_DISCOVER_COURSES_RESULT",payload:{requestId}});
  });

  it("distinguishes a detected Gradescope tab whose content script is unavailable",async()=>{
    const result=await handleBridgeRequest(
      gradescopeDiscoverMessage,
      adapter({
        findGradescopeTab:async()=>({id:9}),
        sendToGradescopeTab:async()=>{throw new Error("Receiving end does not exist.");},
      }),
    );
    expect(result).toMatchObject({
      source:"kairos-extension",
      type:"ERROR",
      errorCode:"INVALID_RESULT",
      message:"Refresh the Gradescope tab after reloading the Kairos extension, then try again.",
    });
  });

  it("returns a stable Gradescope no-tab error",async()=>{
    await expect(handleBridgeRequest(gradescopeDiscoverMessage,adapter())).resolves.toMatchObject({
      source:"kairos-extension",type:"ERROR",errorCode:"GRADESCOPE_TAB_UNAVAILABLE",
    });
  });

  it("rejects malformed page messages instead of forwarding them",async()=>{
    const sendToCanvasTab=vi.fn();
    const sendToGradescopeTab=vi.fn();
    await expect(handleBridgeRequest(
      {...syncMessage,url:"https://evil.example"},
      adapter({findCanvasTab:async()=>({id:7}),sendToCanvasTab,sendToGradescopeTab}),
    )).rejects.toThrow();
    expect(sendToCanvasTab).not.toHaveBeenCalled();
    expect(sendToGradescopeTab).not.toHaveBeenCalled();
  });
});
