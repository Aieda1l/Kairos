import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileCalendarConnection} from "@/lib/calendar/reconcile";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function POST(
  _request:Request,
  {params}:{params:Promise<{id:string}>},
){
  const {id}=await params;
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  if(runtime.kind==="legacy"){
    if(!new CalendarConnectionRepository(runtime.db).getById(id)){
      return Response.json({
        code:"CALENDAR_NOT_FOUND",
        message:"Calendar connection not found.",
      },{status:404});
    }
    return Response.json(await reconcileCalendarConnection(runtime.db,id,{
      adapterFactory:createCalendarAdapterFactory(runtime.db),
    }));
  }

  if(!await new D1CalendarConnectionRepository(runtime.db,runtime.scope).getById(id)){
    return Response.json({
      code:"CALENDAR_NOT_FOUND",
      message:"Calendar connection not found.",
    },{status:404});
  }
  return Response.json(await reconcileCalendarConnection(
    runtime.db,runtime.scope,id,{
      adapterFactory:createCalendarAdapterFactory(
        runtime.db,runtime.scope,runtime.keyring,
      ),
    },
  ));
}
