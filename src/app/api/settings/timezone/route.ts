import {z} from "zod";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {SettingsRepository} from "@/lib/db/repositories/settings";
import {getCalendarRouteRuntime} from "@/lib/platform/calendar-runtime";

const schema=z.object({timeZone:z.string().min(1).max(100)});

export async function GET(){
  const runtime=await getCalendarRouteRuntime();
  const timeZone=runtime.kind==="legacy"
    ?new SettingsRepository(runtime.db).getTimeZone()
    :await new D1SettingsRepository(runtime.db,runtime.scope).getTimeZone();
  return Response.json({timeZone});
}

export async function PUT(request:Request){
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
    const runtime=await getCalendarRouteRuntime();
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
