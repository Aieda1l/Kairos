import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function GET(){
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
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
