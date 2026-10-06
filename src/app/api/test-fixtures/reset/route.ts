import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {resetE2ECalendarFixture} from "@/lib/calendar/e2e-fixture-fetch";

export async function POST(){
  if(process.env.E2E_FIXTURES!=="1"){
    return new Response("Not found",{status:404});
  }

  const db=getDatabase();
  migrate(db);
  db.transaction(()=>{
    db.prepare("DELETE FROM calendar_connections").run();
    db.prepare("DELETE FROM source_connections").run();
  })();
  resetE2ECalendarFixture();

  return Response.json({ok:true});
}
