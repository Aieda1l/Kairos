import { formatInTimeZone } from "date-fns-tz";import { validateTimeZone } from "./validate-timezone";
export const DEFAULT_TIME_ZONE="America/Los_Angeles";
export function formatDueDate(dueAt:string|null,timeZone=DEFAULT_TIME_ZONE):string{if(!dueAt)return "No due date";const zone=validateTimeZone(timeZone);return formatInTimeZone(new Date(dueAt),zone,"EEE, MMM d · h:mm a");}
