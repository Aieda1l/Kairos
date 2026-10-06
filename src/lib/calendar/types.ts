export type CalendarProvider="google"|"microsoft"|"caldav";
export type CalendarSyncStatus="never"|"success"|"partial"|"error";

export type CalendarConnection={
  id:string;
  provider:CalendarProvider;
  label:string;
  accountLabel:string|null;
  remoteCalendarId:string|null;
  remoteCalendarName:string|null;
  enabled:boolean;
  lastSyncStartedAt:string|null;
  lastSyncCompletedAt:string|null;
  lastSyncStatus:CalendarSyncStatus;
  lastErrorCode:string|null;
};

export type CalendarEventLink={
  id:string;
  calendarConnectionId:string;
  assignmentId:string;
  syncKey:string;
  remoteEventId:string|null;
  remoteEtag:string|null;
  contentHash:string|null;
  lastSyncedAt:string|null;
  lastErrorCode:string|null;
};
