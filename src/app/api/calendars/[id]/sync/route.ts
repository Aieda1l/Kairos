import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileCalendarConnection} from "@/lib/calendar/reconcile";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const db=getDatabase();migrate(db);
  if(!new CalendarConnectionRepository(db).getById(id))return Response.json({code:"CALENDAR_NOT_FOUND",message:"Calendar connection not found."},{status:404});
  return Response.json(await reconcileCalendarConnection(db,id,{adapterFactory:createCalendarAdapterFactory(db)}));
}
