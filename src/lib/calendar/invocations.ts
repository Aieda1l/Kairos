import 'server-only';
import {z} from 'zod';
import {enforceBudget} from '@/lib/abuse/guard';
import {providerRuntime} from '@/lib/abuse/provider-operation';
import {isCalendarFanoutPrepaid} from '@/lib/abuse/sync-all';
import {AbuseSubjectError} from '@/lib/abuse/types';
import type {UserScope} from '@/lib/auth/user-scope';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1SyncAllRunRepository} from '@/lib/db/d1/repositories/sync-all-runs';
import {MAX_CALENDAR_INVOCATIONS} from '@/lib/sync-all/types';

export async function prepareCalendarInvocations(db:D1DatabaseLike,scope:UserScope){
  if(!isCalendarFanoutPrepaid(db,scope))await enforceBudget(await providerRuntime(db),{class:'sync-all',userId:scope.userId});
  const destinations=(await new D1CalendarConnectionRepository(db,scope).list()).filter(c=>c.enabled);
  if(destinations.length>MAX_CALENDAR_INVOCATIONS)throw new AbuseSubjectError();
  const runs=new D1SyncAllRunRepository(db,scope),invocations=[];
  for(const connection of destinations){
    const runId=crypto.randomUUID();
    await runs.createCalendarStep(runId,connection.id);
    invocations.push({connectionId:connection.id,runId});
  }
  return {invocations};
}

export async function claimCalendarInvocation(db:D1DatabaseLike,scope:UserScope,connectionId:string,runId:string){
  if(!z.string().uuid().safeParse(runId).success)throw new AbuseSubjectError();
  await new D1SyncAllRunRepository(db,scope).claimCalendarStep(runId,connectionId);
}
