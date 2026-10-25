export type BoundedBodyCode="BODY_TOO_LARGE"|"INVALID_UTF8"|"INVALID_JSON"|"BODY_ABORTED";
export class BoundedBodyError extends Error {
  constructor(readonly code:BoundedBodyCode){super(code);this.name="BoundedBodyError";}
}
type BodyOptions={maxBytes:number;signal:AbortSignal};

/** Count bytes from the stream itself. Cancellation is best effort and never awaited. */
export async function readBoundedUtf8(stream:ReadableStream<Uint8Array>|null,{maxBytes,signal}:BodyOptions):Promise<string>{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError("Invalid body byte limit.");
  if(signal.aborted)throw new BoundedBodyError("BODY_ABORTED");
  if(!stream)return "";
  const reader=stream.getReader();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let rejectRead:((error:BoundedBodyError)=>void)|null=null;
  const abort=()=>rejectRead?.(new BoundedBodyError("BODY_ABORTED"));
  signal.addEventListener("abort",abort,{once:true});
  let complete=false;
  try{
    const parts:string[]=[];let bytes=0;
    while(true){
      if(signal.aborted)throw new BoundedBodyError("BODY_ABORTED");
      // Only the active read retains an abort continuation, even with tiny chunks.
      const chunk=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
        rejectRead=reject;
        void reader.read().then(resolve,reject);
      });
      rejectRead=null;
      if(signal.aborted)throw new BoundedBodyError("BODY_ABORTED");
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>maxBytes)throw new BoundedBodyError("BODY_TOO_LARGE");
      try{const decoded=decoder.decode(chunk.value,{stream:true});if(decoded)parts.push(decoded);}catch{throw new BoundedBodyError("INVALID_UTF8");}
    }
    try{parts.push(decoder.decode());}catch{throw new BoundedBodyError("INVALID_UTF8");}
    complete=true;
    return parts.join("");
  }finally{
    signal.removeEventListener("abort",abort);
    if(!complete){try{void reader.cancel().catch(()=>{});}catch{/* Best effort cleanup only. */}}
    reader.releaseLock();
  }
}

export async function readBoundedJson(stream:ReadableStream<Uint8Array>|null,options:BodyOptions):Promise<unknown>{
  const text=await readBoundedUtf8(stream,options);
  if(options.signal.aborted)throw new BoundedBodyError("BODY_ABORTED");
  let parsed:unknown;
  try{parsed=JSON.parse(text);}catch{throw new BoundedBodyError("INVALID_JSON");}
  if(options.signal.aborted)throw new BoundedBodyError("BODY_ABORTED");
  return parsed;
}
