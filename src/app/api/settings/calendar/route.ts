import {z} from "zod";
import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {SettingsRepository} from "@/lib/db/repositories/settings";

const schema=z.object({
  hideSubmitted:z.boolean(),
}).strict();

function repo(){
  const db=getDatabase();
  migrate(db);
  return new SettingsRepository(db);
}

export async function GET(){
  return Response.json({
    hideSubmitted:repo().getCalendarHideSubmitted(),
  });
}

export async function PUT(request:Request){
  let body:unknown;
  try{
    body=await request.json();
  }catch{
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
  repo().setCalendarHideSubmitted(parsed.data.hideSubmitted);
  return Response.json({hideSubmitted:parsed.data.hideSubmitted});
}
