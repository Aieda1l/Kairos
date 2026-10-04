export type CanvasErrorCode = "INVALID_ICAL" | "EMPTY_FEED" | "UNAUTHORIZED_OR_EXPIRED_FEED" | "NETWORK_ERROR";
export class CanvasSourceError extends Error {
  constructor(readonly code: CanvasErrorCode, message: string) { super(message); this.name="CanvasSourceError"; }
}
