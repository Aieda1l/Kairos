import {
  PROTOCOL_VERSION,
  kairosBridgeRequestV1Schema,
  kairosBridgeResponseV1Schema,
} from "@/lib/extension-protocol/submission-status";

const allowedOrigins=new Set(["http://localhost:3000","http://127.0.0.1:3000"]);

if(allowedOrigins.has(window.location.origin)){
  window.addEventListener("message",(event:MessageEvent)=>{
    if(event.source!==window||event.origin!==window.location.origin)return;
    const parsed=kairosBridgeRequestV1Schema.safeParse(event.data);
    if(!parsed.success)return;

    void browser.runtime.sendMessage(parsed.data).then(response=>{
      const safe=kairosBridgeResponseV1Schema.safeParse(response);
      if(safe.success)window.postMessage(safe.data,window.location.origin);
    }).catch(()=>{
      window.postMessage({
        source:"kairos-extension",
        type:"ERROR",
        protocolVersion:PROTOCOL_VERSION,
        requestId:parsed.data.requestId,
        errorCode:"EXTENSION_UNAVAILABLE",
        message:"Firefox extension communication failed.",
      },window.location.origin);
    });
  });
}
