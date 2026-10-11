import { CanvasSourceError } from "./errors";
import {CanvasFeedUrlError,validateCanvasFeedUrl} from "./validate-url";
import {reportSourceRequestFailure} from "@/lib/sources/upstream-diagnostics";
export async function fetchCanvasFeed(url: URL, fetchImpl: typeof fetch = fetch): Promise<string> {
  let current=validateCanvasFeedUrl(url.href);
  const signal=AbortSignal.timeout(15_000);
  let response!:Response;
  // Canvas enforces an identified User-Agent at its edge. Workers fetch does
  // not supply one automatically, unlike browsers and many Node HTTP clients.
  for(let hop=0;hop<=5;hop++){
    try{
      response=await fetchImpl(current,{
        headers:{Accept:"text/calendar,text/plain;q=0.9","User-Agent":"Kairos/0.1 (+https://mykairos.me)"},
        cache:"no-store",redirect:"manual",signal,
      });
    }catch{
      reportSourceRequestFailure("canvas",signal.aborted?"timeout":"transport");
      throw new CanvasSourceError("NETWORK_ERROR","Canvas could not be reached from Kairos. Try again shortly.");
    }
    if(![301,302,303,307,308].includes(response.status))break;
    try{
      const location=response.headers.get("location");
      if(!location)throw new CanvasFeedUrlError();
      let next:URL;
      try{next=new URL(location,current);}catch{throw new CanvasFeedUrlError();}
      current=validateCanvasFeedUrl(next.href);
      if(hop===5)throw new CanvasSourceError("NETWORK_ERROR","Canvas returned too many redirects. Try again shortly.");
    }finally{
      await response.body?.cancel();
    }
  }
  if (response.status === 401 || response.status === 403) {
    reportSourceRequestFailure("canvas","http",response.status);
    const message=response.status===401
      ?"Canvas rejected the calendar feed (HTTP 401). Copy a fresh feed URL and try again."
      :"Canvas denied the feed request (HTTP 403). Try a fresh feed URL. If it works in your browser, Canvas may be blocking requests from the hosting network.";
    throw new CanvasSourceError("UNAUTHORIZED_OR_EXPIRED_FEED",message);
  }
  if (!response.ok) {
    reportSourceRequestFailure("canvas","http",response.status);
    throw new CanvasSourceError("NETWORK_ERROR",`Canvas returned HTTP ${response.status}. Try again shortly.`);
  }
  try{return await response.text();}catch{
    reportSourceRequestFailure("canvas",signal.aborted?"timeout":"transport");
    throw new CanvasSourceError("NETWORK_ERROR","Canvas could not be reached from Kairos. Try again shortly.");
  }
}
