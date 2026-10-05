import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  startGradescopeSync,
  GradescopeSyncServiceError,
} from "@/lib/gradescope/sync-service";

export async function POST(){
  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(startGradescopeSync(db));
  }catch(error){
    if(error instanceof GradescopeSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="GRADESCOPE_NOT_CONFIGURED"||error.code==="GRADESCOPE_NO_COURSES_ENABLED"?409:400},
      );
    }
    return Response.json(
      {code:"GRADESCOPE_SYNC_FAILED",message:"Gradescope sync could not start."},
      {status:500},
    );
  }
}
