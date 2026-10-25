import { CanvasSourceError } from "./errors";
import {CanvasFeedUrlError,validateCanvasFeedUrl} from "./validate-url";
import {reportSourceRequestFailure} from "@/lib/sources/upstream-diagnostics";
import {fetchCanvasFeedResponse} from "./transport";
export async function fetchCanvasFeed(url: URL, fetchImpl: typeof fetch = fetch): Promise<string> {
  const current=validateCanvasFeedUrl(url.href);
  const signal=AbortSignal.timeout(15_000);
  let response:Response;
  try{
    response=await fetchCanvasFeedResponse(current,fetchImpl,signal);
  }catch(error){
    if(error instanceof CanvasSourceError||error instanceof CanvasFeedUrlError)throw error;
    reportSourceRequestFailure("canvas",signal.aborted?"timeout":"transport");
    throw new CanvasSourceError("NETWORK_ERROR","Canvas could not be reached from Kairos. Try again shortly.");
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
