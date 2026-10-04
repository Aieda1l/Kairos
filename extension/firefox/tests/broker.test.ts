import { describe, expect, it, vi } from "vitest";
import { handleBridgeRequest, type BrowserBrokerAdapter } from "../src/background/broker";

const syncMessage={
  source:"kairos-page" as const,
  type:"SYNC_SUBMISSION_STATUS" as const,
  protocolVersion:1 as const,
  requestId:"11111111-1111-4111-8111-111111111111",
  payload:{
    protocolVersion:1 as const,
    requestId:"11111111-1111-4111-8111-111111111111",
    assignments:[{assignmentLocalId:"local-1",courseId:"999",assignmentId:"4242"}],
  },
};

describe("handleBridgeRequest",()=>{
  it("reports extension diagnostics without requiring a Canvas tab",async()=>{
    const adapter:BrowserBrokerAdapter={
      extensionVersion:()=>"0.2.0",
      findCanvasTab:async()=>null,
      sendToCanvasTab:vi.fn(),
    };
    await expect(handleBridgeRequest({
      source:"kairos-page",type:"PING",protocolVersion:1,
      requestId:"11111111-1111-4111-8111-111111111111",
    },adapter)).resolves.toMatchObject({
      source:"kairos-extension",type:"PONG",extensionVersion:"0.2.0",canvasTabDetected:false,
    });
  });

  it("returns a stable no-tab error for sync work",async()=>{
    const adapter:BrowserBrokerAdapter={
      extensionVersion:()=>"0.2.0",
      findCanvasTab:async()=>null,
      sendToCanvasTab:vi.fn(),
    };
    await expect(handleBridgeRequest(syncMessage,adapter)).resolves.toMatchObject({
      source:"kairos-extension",type:"ERROR",errorCode:"CANVAS_TAB_UNAVAILABLE",
    });
  });

  it("forwards only the validated sync payload to the Canvas tab",async()=>{
    const sendToCanvasTab=vi.fn(async()=>({
      protocolVersion:1,
      requestId:syncMessage.requestId,
      results:[{
        assignmentLocalId:"local-1",courseId:"999",assignmentId:"4242",state:"submitted",
        isLate:false,isMissing:false,submittedAt:null,checkedAt:"2026-10-04T06:00:00.000Z",extractorVersion:"canvas-html-v1",
      }],
      errorCode:null,
    }));
    const adapter:BrowserBrokerAdapter={
      extensionVersion:()=>"0.2.0",
      findCanvasTab:async()=>({id:7}),
      sendToCanvasTab,
    };
    const result=await handleBridgeRequest(syncMessage,adapter);
    expect(sendToCanvasTab).toHaveBeenCalledWith(7,syncMessage.payload);
    expect(result).toMatchObject({type:"SYNC_SUBMISSION_STATUS_RESULT",payload:{requestId:syncMessage.requestId}});
  });

  it("rejects malformed page messages instead of forwarding them",async()=>{
    const adapter:BrowserBrokerAdapter={
      extensionVersion:()=>"0.2.0",
      findCanvasTab:async()=>({id:7}),
      sendToCanvasTab:vi.fn(),
    };
    await expect(handleBridgeRequest({...syncMessage,url:"https://evil.example"},adapter)).rejects.toThrow();
    expect(adapter.sendToCanvasTab).not.toHaveBeenCalled();
  });
});
