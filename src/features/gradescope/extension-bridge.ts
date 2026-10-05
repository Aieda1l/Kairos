"use client";

import {
  PROTOCOL_VERSION,
  gradescopeBridgeResponseV1Schema,
  gradescopeDiscoverRequestV1Schema,
  gradescopeSyncRequestV1Schema,
  type GradescopeDiscoverRequestV1,
  type GradescopeDiscoverResultV1,
  type GradescopeSyncErrorCode,
  type GradescopeSyncRequestV1,
  type GradescopeSyncResultV1,
} from "@/lib/extension-protocol/gradescope";

const DEFAULT_TIMEOUT_MS=30_000;

export class GradescopeBridgeError extends Error{
  constructor(
    public readonly code:GradescopeSyncErrorCode,
    message:string,
  ){
    super(message);
    this.name="GradescopeBridgeError";
  }
}

function roundTrip(
  request:Record<string,unknown>,
  requestId:string,
  timeoutMs:number,
):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      window.removeEventListener("message",onMessage);
      window.clearTimeout(timeout);
    };
    const finish=(callback:()=>void)=>{
      if(settled)return;
      settled=true;
      cleanup();
      callback();
    };
    const onMessage=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin)return;
      const parsed=gradescopeBridgeResponseV1Schema.safeParse(event.data);
      if(!parsed.success||parsed.data.requestId!==requestId)return;
      finish(()=>{
        if(parsed.data.type==="ERROR"){
          reject(new GradescopeBridgeError(parsed.data.errorCode,parsed.data.message));
          return;
        }
        resolve(parsed.data);
      });
    };
    const timeout=window.setTimeout(()=>{
      finish(()=>reject(new GradescopeBridgeError("EXTENSION_TIMEOUT","Firefox extension timed out.")));
    },timeoutMs);
    window.addEventListener("message",onMessage);
    try{
      window.postMessage(request,window.location.origin);
    }catch{
      finish(()=>reject(new GradescopeBridgeError("EXTENSION_UNAVAILABLE","Firefox extension not detected")));
    }
  });
}

export async function discoverGradescopeExtension(
  input:GradescopeDiscoverRequestV1,
  timeoutMs=DEFAULT_TIMEOUT_MS,
):Promise<GradescopeDiscoverResultV1>{
  const payload=gradescopeDiscoverRequestV1Schema.parse(input);
  const response=await roundTrip({
    source:"kairos-page",
    type:"GRADESCOPE_DISCOVER_COURSES",
    protocolVersion:PROTOCOL_VERSION,
    requestId:payload.requestId,
    payload,
  },payload.requestId,timeoutMs);
  const parsed=gradescopeBridgeResponseV1Schema.parse(response);
  if(parsed.type!=="GRADESCOPE_DISCOVER_COURSES_RESULT"){
    throw new GradescopeBridgeError("INVALID_RESULT","Firefox extension returned an invalid Gradescope discovery response.");
  }
  return parsed.payload;
}

export async function syncGradescopeExtensionBatch(
  input:GradescopeSyncRequestV1,
  timeoutMs=DEFAULT_TIMEOUT_MS,
):Promise<GradescopeSyncResultV1>{
  const payload=gradescopeSyncRequestV1Schema.parse(input);
  const response=await roundTrip({
    source:"kairos-page",
    type:"GRADESCOPE_SYNC_ASSIGNMENTS",
    protocolVersion:PROTOCOL_VERSION,
    requestId:payload.requestId,
    payload,
  },payload.requestId,timeoutMs);
  const parsed=gradescopeBridgeResponseV1Schema.parse(response);
  if(parsed.type!=="GRADESCOPE_SYNC_ASSIGNMENTS_RESULT"){
    throw new GradescopeBridgeError("INVALID_RESULT","Firefox extension returned an invalid Gradescope sync response.");
  }
  return parsed.payload;
}
