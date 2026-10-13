import type {SyncAllOptions} from './types';

/** Run metadata stays in the app's HTTP requests; it is not a bridge payload. */
export function syncAllRequestInit(options?:SyncAllOptions):Pick<RequestInit,'headers'>{
  const headers:Record<string,string>={};
  if(options?.deferCalendarSync)headers['x-kairos-calendar-sync']='defer';
  if(options?.syncAllRunId!==undefined)headers['x-kairos-sync-all-run']=options.syncAllRunId;
  return Object.keys(headers).length?{headers}:{};
}
