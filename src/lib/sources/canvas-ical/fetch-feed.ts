import { CanvasSourceError } from "./errors";
export async function fetchCanvasFeed(url: URL, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try { response = await fetchImpl(url, { headers: { Accept: "text/calendar,text/plain;q=0.9" }, cache: "no-store" }); }
  catch { throw new CanvasSourceError("NETWORK_ERROR", "Canvas could not be reached. Check your connection and try again."); }
  if (response.status === 401 || response.status === 403) throw new CanvasSourceError("UNAUTHORIZED_OR_EXPIRED_FEED", "Canvas rejected this feed. Copy a fresh calendar feed URL and try again.");
  if (!response.ok) throw new CanvasSourceError("NETWORK_ERROR", "Canvas returned an unexpected response. Try again shortly.");
  return response.text();
}
