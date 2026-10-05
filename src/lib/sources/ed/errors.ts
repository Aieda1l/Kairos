export type EdErrorCode =
  | "ED_AUTH_INVALID"
  | "ED_NETWORK_ERROR"
  | "ED_RATE_LIMITED"
  | "ED_UPSTREAM_ERROR"
  | "ED_PARSE_ERROR"
  | "ED_COURSE_UNAVAILABLE";

export class EdSourceError extends Error {
  constructor(public readonly code:EdErrorCode,message:string){
    super(message);
    this.name="EdSourceError";
  }
}
