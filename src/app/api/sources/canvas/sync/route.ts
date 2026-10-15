import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {syncCanvasConnection} from "@/lib/sync/sync-source";
import {SyncServiceError} from "@/lib/sync/types";

export async function POST(request?:Request){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  const connection=runtime.kind==="legacy"
    ?new SourceConnectionRepository(runtime.db).getByKind("canvas")
    :await new D1SourceConnectionRepository(runtime.db,runtime.scope)
      .getByKind("canvas");

  if(!connection){
    return Response.json(
      {code:"CANVAS_NOT_CONFIGURED",message:"Connect Canvas before syncing."},
      {status:409},
    );
  }

  try{
    const result=runtime.kind==="legacy"
      ?await syncCanvasConnection(connection.id,{db:runtime.db})
      :await syncCanvasConnection(connection.id,{
        db:runtime.db,
        scope:runtime.scope,
        keyring:runtime.keyring,
      });

    const reconcileOptions={
      defer:request?.headers.get("x-kairos-calendar-sync")==="defer",
      changed:result.inserted+result.updated>0,
    };
    if(runtime.kind==="legacy"){
      await reconcileCalendarsAfterSourceWrite(runtime.db,reconcileOptions);
    }else{
      await reconcileCalendarsAfterSourceWrite(
        runtime.db,runtime.scope,runtime.keyring,reconcileOptions,
      );
    }
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
