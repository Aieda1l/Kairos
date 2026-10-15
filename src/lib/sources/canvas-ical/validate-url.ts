export class CanvasFeedUrlError extends Error {
  readonly code = "INVALID_FEED_URL";
  constructor(message = "Enter a valid UW Canvas calendar feed URL from https://canvas.uw.edu.") { super(message); this.name = "CanvasFeedUrlError"; }
}

export function validateCanvasFeedUrl(raw: string): URL {
  if (!raw.trim()) throw new CanvasFeedUrlError();
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new CanvasFeedUrlError(); }
  if (url.username || url.password) throw new CanvasFeedUrlError("Feed URLs with embedded credentials are not supported.");
  if (url.origin !== "https://canvas.uw.edu") throw new CanvasFeedUrlError();
  return url;
}
