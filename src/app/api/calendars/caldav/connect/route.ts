import {z} from "zod";
import {connectCaldavCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

const schema=z.object({
  username:z.string().min(1),
  secret:z.string().min(1),
  connectionId:z.string().min(1).optional(),
}).strict();

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Enter an Apple Account email and app-specific password.",
    },{status:400});
  }

  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  try{
    const connection=runtime.kind==="legacy"
      ?await connectCaldavCalendar(runtime.db,parsed.data)
      :await connectCaldavCalendar(
        runtime.db,runtime.scope,runtime.keyring,parsed.data,
      );
    return Response.json({connection});
  }catch(error){
    const e=error instanceof CalendarSyncError
      ?error
      :new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Apple Calendar could not be connected.",
      );
    const status=(e.code==="CALENDAR_AUTH_EXPIRED"||e.code==="CALENDAR_AUTH_REQUIRED")
      ?401
      :e.code==="CALENDAR_CONFIG_MISSING"
        ?404
        :502;
    return Response.json({code:e.code,message:e.message},{status});
  }
}
