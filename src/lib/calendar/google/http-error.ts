import "server-only";
import {z} from "zod";
import {CalendarSyncError,type CalendarSyncErrorCode} from "@/lib/calendar/errors";

const errorReasons=z.object({error:z.object({
  errors:z.array(z.object({reason:z.string()})).optional(),
  details:z.array(z.object({reason:z.string().optional()})).optional(),
})});

/** Classify fixed provider reasons; never retain provider messages or metadata. */
export async function googleCalendarHttpError(response:Response):Promise<CalendarSyncError>{
  let code:CalendarSyncErrorCode=response.status===401?'CALENDAR_AUTH_EXPIRED'
    :response.status===403?'CALENDAR_PERMISSION_DENIED'
      :response.status===429?'CALENDAR_RATE_LIMITED':'CALENDAR_UPSTREAM_ERROR';
  if(response.status===403){
    let body:unknown;
    try{body=await response.json();}catch{}
    const parsed=errorReasons.safeParse(body);
    const reasons=parsed.success
      ?[...(parsed.data.error.errors??[]),...(parsed.data.error.details??[])].map(error=>error.reason)
      :[];
    if(reasons.some(reason=>reason==='accessNotConfigured'||reason==='SERVICE_DISABLED'))code='CALENDAR_CONFIG_MISSING';
    else if(reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded'].includes(reason??'')))code='CALENDAR_RATE_LIMITED';
  }
  return new CalendarSyncError(code,'Google Calendar authorization or access could not be verified.');
}
