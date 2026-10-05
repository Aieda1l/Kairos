import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { EdSyncServiceError, syncEdConnection } from "@/lib/ed/sync-service";

export async function POST(){
  const db=getDatabase();
  migrate(db);
  try{
    const result=await syncEdConnection(db);
    const status=result.lastErrorCode==="ED_AUTH_INVALID"?401
      :result.lastErrorCode&&result.lastErrorCode!=="PARTIAL_SYNC"?502
      :200;
    return Response.json(result,{status});
  }catch(error){
    if(error instanceof EdSyncServiceError){
      return Response.json({code:error.code,message:error.message},{status:409});
    }
    return Response.json({code:"ED_UPSTREAM_ERROR",message:"Ed sync could not be completed."},{status:502});
  }
}
