import {
  PROTOCOL_VERSION,
  canvasBatchResultV1Schema,
  kairosBridgeRequestV1Schema,
  type CanvasBatchResultV1,
  type KairosBridgeResponseV1,
  type SubmissionSyncRequestV1,
} from "@/lib/extension-protocol/submission-status";

export type BrowserBrokerAdapter={
  extensionVersion:()=>string;
  findCanvasTab:()=>Promise<{id:number}|null>;
  sendToCanvasTab:(tabId:number,request:SubmissionSyncRequestV1)=>Promise<unknown>;
};

export async function handleBridgeRequest(
  message:unknown,
  adapter:BrowserBrokerAdapter,
):Promise<KairosBridgeResponseV1> {
  const parsed=kairosBridgeRequestV1Schema.parse(message);

  if(parsed.type==="PING"){
    const tab=await adapter.findCanvasTab();
    return {
      source:"kairos-extension",
      type:"PONG",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      extensionVersion:adapter.extensionVersion(),
      canvasTabDetected:Boolean(tab),
    };
  }

  if(parsed.requestId!==parsed.payload.requestId){
    return {
      source:"kairos-extension",
      type:"ERROR",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      errorCode:"INVALID_RESULT",
      message:"The sync request identifiers did not match.",
    };
  }

  const tab=await adapter.findCanvasTab();
  if(!tab){
    return {
      source:"kairos-extension",
      type:"ERROR",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      errorCode:"CANVAS_TAB_UNAVAILABLE",
      message:"Open Canvas in Firefox, then try again.",
    };
  }

  let payload:CanvasBatchResultV1;
  try{
    payload=canvasBatchResultV1Schema.parse(await adapter.sendToCanvasTab(tab.id,parsed.payload));
  }catch{
    return {
      source:"kairos-extension",
      type:"ERROR",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      errorCode:"INVALID_RESULT",
      message:"Canvas returned an invalid status result.",
    };
  }

  if(payload.requestId!==parsed.requestId){
    return {
      source:"kairos-extension",
      type:"ERROR",
      protocolVersion:PROTOCOL_VERSION,
      requestId:parsed.requestId,
      errorCode:"INVALID_RESULT",
      message:"Canvas returned a result for a different request.",
    };
  }

  return {
    source:"kairos-extension",
    type:"SYNC_SUBMISSION_STATUS_RESULT",
    protocolVersion:PROTOCOL_VERSION,
    requestId:parsed.requestId,
    payload,
  };
}
