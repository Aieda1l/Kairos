import {CanvasSourceError} from "./errors";
import {CanvasFeedUrlError,validateCanvasFeedUrl} from "./validate-url";

/** Destination/header policy shared by hosted and guest callers; bodies remain caller owned. */
export async function fetchCanvasFeedResponse(url:URL,fetchImpl:typeof fetch,signal:AbortSignal):Promise<Response>{
  let current=validateCanvasFeedUrl(url.href);
  for(let hop=0;hop<=5;hop++){
    signal.throwIfAborted();
    const response=await fetchImpl(current,{
      headers:{Accept:"text/calendar,text/plain;q=0.9","User-Agent":"Kairos/0.1 (+https://mykairos.me)"},
      cache:"no-store",redirect:"manual",signal,
    });
    if(![301,302,303,307,308].includes(response.status))return response;
    try{
      const location=response.headers.get("location");
      if(!location)throw new CanvasFeedUrlError();
      let next:URL;
      try{next=new URL(location,current);}catch{throw new CanvasFeedUrlError();}
      current=validateCanvasFeedUrl(next.href);
      if(hop===5)throw new CanvasSourceError("NETWORK_ERROR","Canvas returned too many redirects. Try again shortly.");
    }finally{
      // Untrusted cancellation can stall; it must never extend the operation.
      try{void response.body?.cancel().catch(()=>{});}catch{/* Best effort only. */}
    }
  }
  throw new CanvasSourceError("NETWORK_ERROR","Canvas returned too many redirects. Try again shortly.");
}
