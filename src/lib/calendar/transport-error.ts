import 'server-only';
import {RateLimitedError} from '@/lib/abuse/types';
import {CalendarSyncError} from './errors';

/** Preserve a known pre-transport throttle without exposing transport details. */
export function calendarTransportError(error:unknown,networkMessage:string):CalendarSyncError{
  return error instanceof RateLimitedError
    ?new CalendarSyncError('CALENDAR_RATE_LIMITED','Calendar provider scheduling is paused for the retry window.',error.retryAfterSeconds)
    :new CalendarSyncError('CALENDAR_NETWORK_ERROR',networkMessage);
}
