import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function POST(){
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
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
}
