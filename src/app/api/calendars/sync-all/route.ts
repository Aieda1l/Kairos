import {abuseErrorResponse} from "@/lib/abuse/guard";
import {withSyncAllRequest} from '@/lib/abuse/sync-all';
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";
import {prepareCalendarInvocations} from '@/lib/calendar/invocations';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {isCalendarFanoutPrepaid} from '@/lib/abuse/sync-all';
import {enforceBudget} from '@/lib/abuse/guard';
import {providerRuntime} from '@/lib/abuse/provider-operation';

export async function POST(request?:Request){
  try{
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  return await withSyncAllRequest(runtime,request,'calendars',async()=>{
  if(runtime.kind==='hosted'&&request?.headers.get('x-kairos-calendar-invocations')==='separate'){
    return Response.json(await prepareCalendarInvocations(runtime.db,runtime.scope),{headers:{'cache-control':'no-store'}});
  }
  if(runtime.kind==="legacy"){
    return Response.json(await reconcileAllCalendars(runtime.db,{
      adapterFactory:createCalendarAdapterFactory(runtime.db),
    }));
  }
  if((await new D1CalendarConnectionRepository(runtime.db,runtime.scope).list()).filter(c=>c.enabled).length>1){
    if(!isCalendarFanoutPrepaid(runtime.db,runtime.scope))await enforceBudget(await providerRuntime(runtime.db),{class:'sync-all',userId:runtime.scope.userId});
    return Response.json({code:'CALENDAR_SPLIT_REQUIRED',message:'Reload Kairos to synchronize calendar destinations separately.'},{status:409});
  }
  return Response.json(await reconcileAllCalendars(
    runtime.db,
    runtime.scope,
    {
      adapterFactory:createCalendarAdapterFactory(
        runtime.db,runtime.scope,runtime.keyring,
      ),
    },
  ));
  });
  }catch(error){const ownership=abuseErrorResponse(error);if(ownership)return ownership;throw error;}
}
