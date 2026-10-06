import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {removeManagedCalendarEvents} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const db=getDatabase();migrate(db);
  try{return Response.json(await removeManagedCalendarEvents(db,id));}
  catch(error){
    if(error instanceof CalendarSyncError){
      const status=error.code==="CALENDAR_CONFIG_MISSING"?404:error.code==="CALENDAR_AUTH_EXPIRED"?401:502;
      return Response.json({code:error.code,message:error.message},{status});
    }
    return Response.json({code:"CALENDAR_UPSTREAM_ERROR",message:"Calendar events could not be removed."},{status:502});
  }
}
