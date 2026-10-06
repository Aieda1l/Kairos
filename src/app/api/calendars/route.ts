import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
export async function GET(){
  const db=getDatabase();migrate(db);
  return Response.json({connections:new CalendarConnectionRepository(db).list()});
}
