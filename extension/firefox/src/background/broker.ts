import {
  PROTOCOL_VERSION,
  canvasBatchResultV1Schema,
  type CanvasBatchResultV1,
  type SubmissionSyncRequestV1,
} from "@/lib/extension-protocol/submission-status";
import {
  gradescopeDiscoverResultV1Schema,
  gradescopeSyncResultV1Schema,
  type GradescopeDiscoverRequestV1,
  type GradescopeSyncRequestV1,
} from "@/lib/extension-protocol/gradescope";
import {
  kairosBridgeRequestV1Schema,
  kairosBridgeResponseV1Schema,
  type KairosBridgeResponseV1,
} from "@/lib/extension-protocol/bridge";

export type BrowserBrokerAdapter={
  extensionVersion:()=>string;
  findCanvasTab:()=>Promise<{id:number}|null>;
  sendToCanvasTab:(tabId:number,request:SubmissionSyncRequestV1)=>Promise<unknown>;
  findGradescopeTab:()=>Promise<{id:number}|null>;
  sendToGradescopeTab:(tabId:number,request:GradescopeDiscoverRequestV1|GradescopeSyncRequestV1)=>Promise<unknown>;
};

function bridgeError(
  requestId:string,
  errorCode:string,
  message:string,
):KairosBridgeResponseV1 {
  return kairosBridgeResponseV1Schema.parse({
    source:"kairos-extension",
    type:"ERROR",
    protocolVersion:PROTOCOL_VERSION,
    requestId,
    errorCode,
    message,
  });
}

export async function handleBridgeRequest(
  message:unknown,
  adapter:BrowserBrokerAdapter,
):Promise<KairosBridgeResponseV1> {
  const parsed=kairosBridgeRequestV1Schema.parse(message);

  if(parsed.type==="PING"){
    const [canvasTab,gradescopeTab]=await Promise.all([
      adapter.findCanvasTab(),
      adapter.findGradescopeTab(),
    ]);
    return kairosBridgeResponseV1Schema.parse({
      source:"kairos-extension",
      type:"PONG",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      extensionVersion:adapter.extensionVersion(),
      canvasTabDetected:Boolean(canvasTab),
      gradescopeTabDetected:Boolean(gradescopeTab),
    });
  }

  if(parsed.requestId!==parsed.payload.requestId){
    return bridgeError(
      parsed.requestId,
      "INVALID_RESULT",
      "The sync request identifiers did not match.",
    );
  }

  if(parsed.type==="SYNC_SUBMISSION_STATUS"){
    const tab=await adapter.findCanvasTab();
    if(!tab){
      return bridgeError(
        parsed.requestId,
        "CANVAS_TAB_UNAVAILABLE",
        "Open Canvas in Firefox, then try again.",
      );
    }

    let payload:CanvasBatchResultV1;
    try{
      payload=canvasBatchResultV1Schema.parse(
        await adapter.sendToCanvasTab(tab.id,parsed.payload),
      );
    }catch{
      return bridgeError(
        parsed.requestId,
        "INVALID_RESULT",
        "Canvas returned an invalid status result.",
      );
    }

    if(payload.requestId!==parsed.requestId){
      return bridgeError(
        parsed.requestId,
        "INVALID_RESULT",
        "Canvas returned a result for a different request.",
      );
    }

    return kairosBridgeResponseV1Schema.parse({
      source:"kairos-extension",
      type:"SYNC_SUBMISSION_STATUS_RESULT",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      payload,
    });
  }

  const tab=await adapter.findGradescopeTab();
  if(!tab){
    return bridgeError(
      parsed.requestId,
      "GRADESCOPE_TAB_UNAVAILABLE",
      "Open Gradescope in Firefox, then try again.",
    );
  }

  if(parsed.type==="GRADESCOPE_DISCOVER_COURSES"){
    try{
      const payload=gradescopeDiscoverResultV1Schema.parse(
        await adapter.sendToGradescopeTab(tab.id,parsed.payload),
      );
      if(payload.requestId!==parsed.requestId){
        return bridgeError(
          parsed.requestId,
          "INVALID_RESULT",
          "Gradescope returned a result for a different request.",
        );
      }
      return kairosBridgeResponseV1Schema.parse({
        source:"kairos-extension",
        type:"GRADESCOPE_DISCOVER_COURSES_RESULT",
        protocolVersion:PROTOCOL_VERSION,
        requestId:parsed.requestId,
        payload,
      });
    }catch{
      return bridgeError(
        parsed.requestId,
        "INVALID_RESULT",
        "Gradescope returned an invalid course discovery result.",
      );
    }
  }

  try{
    const payload=gradescopeSyncResultV1Schema.parse(
      await adapter.sendToGradescopeTab(tab.id,parsed.payload),
    );
    if(payload.requestId!==parsed.requestId){
      return bridgeError(
        parsed.requestId,
        "INVALID_RESULT",
        "Gradescope returned a result for a different request.",
      );
    }
    return kairosBridgeResponseV1Schema.parse({
      source:"kairos-extension",
      type:"GRADESCOPE_SYNC_ASSIGNMENTS_RESULT",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      payload,
    });
  }catch{
    return bridgeError(
      parsed.requestId,
      "INVALID_RESULT",
      "Gradescope returned an invalid assignment sync result.",
    );
  }
}
