import {z} from "zod";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {SettingsRepository} from "@/lib/db/repositories/settings";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

const schema=z.object({hideSubmitted:z.boolean()}).strict();

export async function GET(){
  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const hideSubmitted=runtime.kind==="legacy"
    ?new SettingsRepository(runtime.db).getCalendarHideSubmitted()
    :await new D1SettingsRepository(runtime.db,runtime.scope).getCalendarHideSubmitted();
  return Response.json({hideSubmitted});
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
      message:"Choose whether submitted assignments should be hidden.",
    },{status:400});
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Choose whether submitted assignments should be hidden.",
    },{status:400});
  }

  if(runtime.kind==="legacy"){
    new SettingsRepository(runtime.db).setCalendarHideSubmitted(parsed.data.hideSubmitted);
  }else{
    await new D1SettingsRepository(runtime.db,runtime.scope)
      .setCalendarHideSubmitted(parsed.data.hideSubmitted);
  }
  return Response.json({hideSubmitted:parsed.data.hideSubmitted});
}
