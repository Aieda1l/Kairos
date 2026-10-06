export type CalendarSyncErrorCode=
  |"CALENDAR_AUTH_REQUIRED"
  |"CALENDAR_AUTH_EXPIRED"
  |"CALENDAR_CONFIG_MISSING"
  |"CALENDAR_NETWORK_ERROR"
  |"CALENDAR_RATE_LIMITED"
  |"CALENDAR_UPSTREAM_ERROR"
  |"CALENDAR_REMOTE_CALENDAR_MISSING"
  |"CALENDAR_EVENT_INVALID"
  |"CALENDAR_PARTIAL_SYNC"
  |"CALDAV_DISCOVERY_FAILED"
  |"CALDAV_NOT_WRITABLE";

export class CalendarSyncError extends Error{
  constructor(
    public readonly code:CalendarSyncErrorCode,
    message:string,
  ){
    super(message);
    this.name="CalendarSyncError";
  }
}
