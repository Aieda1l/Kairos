import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {syncCanvasConnection} from "@/lib/sync/sync-source";
import {SyncServiceError} from "@/lib/sync/types";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";

export async function POST(request?:Request){
  const db=getDatabase();
  migrate(db);
  const connection=new SourceConnectionRepository(db).getByKind("canvas");
  if(!connection){
    return Response.json(
      {code:"CANVAS_NOT_CONFIGURED",message:"Connect Canvas before syncing."},
      {status:409},
    );
  }
  try{
    const result=await syncCanvasConnection(connection.id,{db});
    await reconcileCalendarsAfterSourceWrite(db,{
      defer:request?.headers.get("x-kairos-calendar-sync")==="defer",
      changed:result.inserted+result.updated>0,
    });
    return Response.json(result);
  }catch(error){
    if(error instanceof SyncServiceError||error instanceof CanvasSourceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="SYNC_IN_PROGRESS"?409:502},
      );
    }
    return Response.json(
      {code:"SYNC_FAILED",message:"Canvas sync failed. Try again."},
      {status:502},
    );
  }
}
