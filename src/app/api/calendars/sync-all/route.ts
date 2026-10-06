import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
export async function POST(){
  const db=getDatabase();migrate(db);
  return Response.json(await reconcileAllCalendars(db,{adapterFactory:createCalendarAdapterFactory(db)}));
}
