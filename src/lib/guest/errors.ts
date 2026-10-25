import { z } from "zod";
import { submissionSyncErrorCodeSchema } from "@/lib/extension-protocol/submission-status";
import { gradescopeSyncErrorCodeSchema } from "@/lib/extension-protocol/gradescope";

export const guestApiErrorCodeSchema = z.enum([
  "GUEST_DISABLED", "GUEST_SESSION_REQUIRED", "GUEST_CHALLENGE_FAILED", "GUEST_CHALLENGE_UNAVAILABLE",
  "BAD_REQUEST", "UNSUPPORTED_MEDIA_TYPE", "UNTRUSTED_ORIGIN", "RATE_LIMITED", "SERVICE_UNAVAILABLE",
  "SOURCE_RESULT_TOO_LARGE", "INVALID_FEED_URL", "INVALID_ICAL", "EMPTY_FEED", "UNAUTHORIZED_OR_EXPIRED_FEED", "NETWORK_ERROR",
  "ED_AUTH_INVALID", "ED_NETWORK_ERROR", "ED_RATE_LIMITED", "ED_UPSTREAM_ERROR", "ED_PARSE_ERROR", "ED_COURSE_UNAVAILABLE",
]);
export const guestSafeCodeSchema = z.enum([
  ...guestApiErrorCodeSchema.options,
  ...submissionSyncErrorCodeSchema.options,
  ...gradescopeSyncErrorCodeSchema.options,
  "GUEST_BUSY", "GUEST_SUPERSEDED", "GUEST_STORAGE_UNAVAILABLE", "GUEST_STORAGE_LIMIT",
  "GUEST_CREDENTIAL_REQUIRED", "GUEST_NOT_CONNECTED", "GUEST_NO_COURSES", "GUEST_NO_ASSIGNMENTS",
  "GUEST_RUN_TIMEOUT", "GUEST_RUN_LIMIT", "GUEST_INTERRUPTED", "INVALID_BACKUP", "UNSUPPORTED_BACKUP_VERSION",
]);
export type GuestSafeCode = z.infer<typeof guestSafeCodeSchema>;
export type GuestApiErrorCode = z.infer<typeof guestApiErrorCodeSchema>;

export const GUEST_SAFE_MESSAGES:Readonly<Record<GuestSafeCode,string>> = Object.freeze({
  GUEST_DISABLED:"Guest mode is unavailable.",
  GUEST_SESSION_REQUIRED:"Start a guest session to continue.",
  GUEST_CHALLENGE_FAILED:"Complete the verification challenge and try again.",
  GUEST_CHALLENGE_UNAVAILABLE:"Verification is temporarily unavailable. Try again later.",
  BAD_REQUEST:"This request could not be read.",
  UNSUPPORTED_MEDIA_TYPE:"This request format is unsupported.",
  UNTRUSTED_ORIGIN:"This request origin is not allowed.",
  RATE_LIMITED:"Too many requests. Try again later.",
  SERVICE_UNAVAILABLE:"This service is temporarily unavailable.",
  SOURCE_RESULT_TOO_LARGE:"This source result exceeds the supported size.",
  INVALID_FEED_URL:"Enter a valid UW Canvas calendar feed URL.",
  INVALID_ICAL:"Canvas returned an invalid calendar feed.",
  EMPTY_FEED:"The Canvas calendar feed has no assignments.",
  UNAUTHORIZED_OR_EXPIRED_FEED:"Update your Canvas calendar feed URL and try again.",
  NETWORK_ERROR:"Canvas could not be reached. Try again.",
  ED_AUTH_INVALID:"Update your Ed API token and try again.",
  ED_NETWORK_ERROR:"Ed could not be reached. Try again.",
  ED_RATE_LIMITED:"Ed is rate limiting requests. Try again later.",
  ED_UPSTREAM_ERROR:"Ed is temporarily unavailable.",
  ED_PARSE_ERROR:"Ed returned data Kairos could not read.",
  ED_COURSE_UNAVAILABLE:"This Ed course could not be read.",
  EXTENSION_UNAVAILABLE:"Connect the Kairos extension to continue.",
  EXTENSION_TIMEOUT:"The Kairos extension did not respond in time.",
  CANVAS_TAB_UNAVAILABLE:"Open Canvas in your browser and try again.",
  CANVAS_SIGNED_OUT:"Sign in to Canvas and try again.",
  CANVAS_NETWORK_ERROR:"Canvas submission status could not be read. Try again.",
  UNRECOGNIZED_STATUS:"The source submission status could not be recognized.",
  PARTIAL_SYNC:"Some source items could not be updated.",
  INVALID_RESULT:"The source returned an invalid result.",
  GRADESCOPE_TAB_UNAVAILABLE:"Open Gradescope in your browser and try again.",
  GRADESCOPE_SIGNED_OUT:"Sign in to Gradescope and try again.",
  GRADESCOPE_NETWORK_ERROR:"Gradescope could not be reached. Try again.",
  GRADESCOPE_COURSE_UNAVAILABLE:"This Gradescope course could not be read.",
  GRADESCOPE_PARSE_ERROR:"Gradescope returned data Kairos could not read.",
  GUEST_BUSY:"Another guest sync is already running.",
  GUEST_SUPERSEDED:"A newer guest operation replaced this one.",
  GUEST_STORAGE_UNAVAILABLE:"Device storage is unavailable.",
  GUEST_STORAGE_LIMIT:"This dataset exceeds the device storage limit.",
  GUEST_CREDENTIAL_REQUIRED:"Enter your source credential to continue.",
  GUEST_NOT_CONNECTED:"Connect this source to continue.",
  GUEST_NO_COURSES:"No enabled courses are available to sync.",
  GUEST_NO_ASSIGNMENTS:"No assignments are available to sync.",
  GUEST_RUN_TIMEOUT:"The guest sync reached its time limit.",
  GUEST_RUN_LIMIT:"The guest sync reached its operation limit. Run sync again to continue.",
  GUEST_INTERRUPTED:"The guest sync was interrupted. Run sync again to continue.",
  INVALID_BACKUP:"This guest backup is invalid.",
  UNSUPPORTED_BACKUP_VERSION:"This guest backup version is unsupported.",
});

export function guestSafeMessage(code:GuestSafeCode):string {
  return GUEST_SAFE_MESSAGES[code];
}

export class GuestDataError extends Error {
  constructor(readonly code:GuestSafeCode) {
    super(guestSafeMessage(code));
    this.name="GuestDataError";
  }
}
