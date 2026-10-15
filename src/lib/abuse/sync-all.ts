import 'server-only';
import type {UserScope} from '@/lib/auth/user-scope';
import type {SyncAllAdmission,SyncAllStep} from '@/lib/sync-all/types';
import type {AbuseRuntime} from './types';
import {AbuseStorageUnavailableError,AbuseSubjectError} from './types';
import {enforceBudget} from './guard';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {D1SourceCourseRepository} from '@/lib/db/d1/repositories/source-courses';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1SettingsRepository} from '@/lib/db/d1/repositories/settings';
import {D1SyncAllRunRepository} from '@/lib/db/d1/repositories/sync-all-runs';
import {SYNC_ALL_STEPS} from '@/lib/sync-all/types';
import {z} from 'zod';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {AsyncLocalStorage} from 'node:async_hooks';
import {providerRuntime} from './provider-operation';

export async function startSyncAll(runtime:AbuseRuntime,scope:UserScope):Promise<SyncAllAdmission>{
  if(!scope.userId?.trim())throw new AbuseSubjectError();
  // Authenticated attempts pay for metadata work, including failed issuance.
  await enforceBudget(runtime,{class:'sync-all',userId:scope.userId});
  const steps:SyncAllStep[]=[];
  try{
    const sources=new D1SourceConnectionRepository(runtime.db,scope);
    const courses=new D1SourceCourseRepository(runtime.db,scope);
    const canvas=await sources.getByKind('canvas');
    if(canvas?.enabled){
      steps.push('canvas-deadlines');
      if(await new D1SettingsRepository(runtime.db,scope).getCanvasSubmissionStatusEnabled())steps.push('canvas-submissions');
    }
    for(const provider of ['gradescope','ed'] as const){
      const connection=await sources.getByKind(provider);
      if(connection?.enabled&&(await courses.listEnabled(connection.id)).length>0)steps.push(provider);
    }
    if((await new D1CalendarConnectionRepository(runtime.db,scope).list()).some(item=>item.enabled))steps.push('calendars');
  }catch{throw new AbuseStorageUnavailableError();}
  const runId=crypto.randomUUID();
  const expiry=await new D1SyncAllRunRepository(runtime.db,scope).create(runId,steps);
  return {runId,expiresAt:new Date(expiry).toISOString(),steps};
}
export async function claimSyncAllStep(runtime:AbuseRuntime,scope:UserScope,runId:string,step:SyncAllStep):Promise<void>{
  if(!scope.userId?.trim()||!z.string().uuid().safeParse(runId).success||!SYNC_ALL_STEPS.includes(step))throw new AbuseSubjectError();
  await new D1SyncAllRunRepository(runtime.db,scope).claim(runId,step);
}

type Fanout={db:D1DatabaseLike;userId:string;step:SyncAllStep|'automatic';active:boolean};
const fanout=new AsyncLocalStorage<Fanout>();
async function runFanout<T>(entry:Fanout,work:()=>Promise<T>):Promise<T>{
  return fanout.run(entry,async()=>{try{return await work();}finally{entry.active=false;}});
}
export async function withSyncAllStep<T>(runtime:AbuseRuntime,scope:UserScope,runId:string,step:SyncAllStep,work:()=>Promise<T>):Promise<T>{
  await claimSyncAllStep(runtime,scope,runId,step);
  return runFanout({db:runtime.db,userId:scope.userId,step,active:true},work);
}
export function isCalendarFanoutPrepaid(db:D1DatabaseLike,scope:UserScope):boolean{
  const entry=fanout.getStore();
  return Boolean(entry?.active&&entry.db===db&&entry.userId===scope.userId&&(entry.step==='calendars'||entry.step==='automatic'));
}
/** Trusted post-source-write call only. No request supplies this context. */
export async function withAutomaticCalendarReconciliation<T>(db:D1DatabaseLike,scope:UserScope,work:()=>Promise<T>):Promise<T>{
  if(!scope.userId?.trim())throw new AbuseSubjectError();
  return runFanout({db,userId:scope.userId,step:'automatic',active:true},work);
}

type RequestRuntime={kind:'legacy'}|{kind:'hosted';db:D1DatabaseLike;scope:UserScope};
export async function withSyncAllRequest<T>(runtime:RequestRuntime,request:Request|undefined,step:SyncAllStep,work:()=>Promise<T>):Promise<T>{
  const runId=request?.headers.get('x-kairos-sync-all-run');
  if(runId===null||runId===undefined)return work();
  if(runtime.kind!=='hosted')throw new AbuseSubjectError();
  return withSyncAllStep(await providerRuntime(runtime.db),runtime.scope,runId,step,work);
}
