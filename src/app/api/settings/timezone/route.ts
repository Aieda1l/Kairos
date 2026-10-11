import {z} from "zod";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {SettingsRepository} from "@/lib/db/repositories/settings";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

const schema=z.object({timeZone:z.string().min(1).max(100)});

export async function GET(){
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const timeZone=runtime.kind==="legacy"
    ?new SettingsRepository(runtime.db).getTimeZone()
    :await new D1SettingsRepository(runtime.db,runtime.scope).getTimeZone();
  return Response.json({timeZone});
}

export async function PUT(request:Request){
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Choose a valid timezone.",
    },{status:400});
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Choose a valid timezone.",
    },{status:400});
  }

  try{
    if(runtime.kind==="legacy"){
      new SettingsRepository(runtime.db).setTimeZone(parsed.data.timeZone);
    }else{
      await new D1SettingsRepository(runtime.db,runtime.scope)
        .setTimeZone(parsed.data.timeZone);
    }
    return Response.json({timeZone:parsed.data.timeZone});
  }catch{
    return Response.json({
      code:"INVALID_TIMEZONE",
      message:"Choose a valid IANA timezone.",
    },{status:400});
  }
}
