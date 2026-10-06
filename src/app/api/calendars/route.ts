import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {getCalendarRouteRuntime} from "@/lib/platform/calendar-runtime";

export async function GET(){
  const runtime=await getCalendarRouteRuntime();
  if(runtime.kind==="legacy"){
    return Response.json({
      connections:new CalendarConnectionRepository(runtime.db).list(),
    });
  }
  return Response.json({
    connections:await new D1CalendarConnectionRepository(
      runtime.db,runtime.scope,
    ).list(),
  });
}
