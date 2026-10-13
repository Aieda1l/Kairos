import {abuseErrorResponse} from "@/lib/abuse/guard";
import {withSyncAllRequest} from '@/lib/abuse/sync-all';
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function POST(request?:Request){
  try{
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  return await withSyncAllRequest(runtime,request,'calendars',async()=>{
  if(runtime.kind==="legacy"){
    return Response.json(await reconcileAllCalendars(runtime.db,{
      adapterFactory:createCalendarAdapterFactory(runtime.db),
    }));
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
