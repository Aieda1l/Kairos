import type {useCalendarSync} from '@/features/calendars/calendar-provider';

type RetryActions=Pick<ReturnType<typeof useCalendarSync>,
  'recoveryOperationFor'|'syncAll'|'removeEvents'|'disconnect'|'syncConnection'>;

/** Cards retain authorization/draft ordering; provider error state owns Retry intent. */
export async function retryOAuthCalendarCard(
  calendars:RetryActions,key:string,connectionId:string|undefined,start:()=>Promise<void>,
):Promise<void>{
  const operation=calendars.recoveryOperationFor?.(key);
  if(operation==='authorize')await start();
  else if(operation==='sync-all')await calendars.syncAll();
  else if(connectionId!==undefined){
    if(operation==='remove-events')await calendars.removeEvents(connectionId);
    else if(operation==='disconnect')await calendars.disconnect(connectionId);
    else await calendars.syncConnection(connectionId);
  }
}
