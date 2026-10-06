import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {disconnectCalendar} from "@/lib/calendar/connection-service";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const db=getDatabase();migrate(db);
  if(!disconnectCalendar(db,id))return Response.json({code:"CALENDAR_NOT_FOUND",message:"Calendar connection not found."},{status:404});
  return Response.json({ok:true});
}
