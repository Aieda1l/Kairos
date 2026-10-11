import {disconnectCalendar} from "@/lib/calendar/connection-service";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function POST(
  _request:Request,
  {params}:{params:Promise<{id:string}>},
){
  const {id}=await params;
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const removed=runtime.kind==="legacy"
    ?disconnectCalendar(runtime.db,id)
    :await disconnectCalendar(runtime.db,runtime.scope,id);

  if(!removed){
    return Response.json({
      code:"CALENDAR_NOT_FOUND",
      message:"Calendar connection not found.",
    },{status:404});
  }
  return Response.json({ok:true});
}
