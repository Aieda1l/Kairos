import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";
import {getEdRouteFetch} from "@/lib/ed/e2e-fixture-fetch";
import {EdSyncServiceError,syncEdConnection} from "@/lib/ed/sync-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

export async function POST(request?:Request){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?await syncEdConnection(runtime.db,{fetchImpl:getEdRouteFetch()})
      :await syncEdConnection(
        runtime.db,runtime.scope,runtime.keyring,
        {fetchImpl:getEdRouteFetch()},
      );

    const options={
      defer:request?.headers.get("x-kairos-calendar-sync")==="defer",
      changed:result.insertedCount+result.updatedCount+result.statusUpdatedCount>0,
    };
    if(runtime.kind==="legacy"){
      await reconcileCalendarsAfterSourceWrite(runtime.db,options);
    }else{
      await reconcileCalendarsAfterSourceWrite(
        runtime.db,runtime.scope,runtime.keyring,options,
      );
    }

    const status=result.lastErrorCode==="ED_AUTH_INVALID"?401
      :result.lastErrorCode&&result.lastErrorCode!=="PARTIAL_SYNC"?502
      :200;
    return Response.json(result,{status});
  }catch(error){
    if(error instanceof EdSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:409},
      );
    }
    return Response.json(
      {code:"ED_UPSTREAM_ERROR",message:"Ed sync could not be completed."},
      {status:502},
    );
  }
}
