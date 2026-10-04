export class CanvasFeedUrlError extends Error {
  readonly code = "INVALID_FEED_URL";
  constructor(message = "Enter a valid HTTPS Canvas calendar feed URL.") { super(message); this.name = "CanvasFeedUrlError"; }
}

export function validateCanvasFeedUrl(raw: string, options: { allowLoopbackHttp?: boolean } = {}): URL {
  if (!raw.trim()) throw new CanvasFeedUrlError();
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new CanvasFeedUrlError(); }
  if (url.username || url.password) throw new CanvasFeedUrlError("Feed URLs with embedded credentials are not supported.");
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  const allowedHttp = options.allowLoopbackHttp === true && loopback && url.protocol === "http:";
  if (url.protocol !== "https:" && !allowedHttp) throw new CanvasFeedUrlError();
  return url;
}
