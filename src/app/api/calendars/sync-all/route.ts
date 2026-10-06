import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
import {getCalendarRouteRuntime} from "@/lib/platform/calendar-runtime";

export async function POST(){
  const runtime=await getCalendarRouteRuntime();
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
