import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  startCanvasSubmissionStatusSync,
  SubmissionStatusSyncServiceError,
} from "@/lib/submission-status/sync-service";

export async function POST(){
  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(startCanvasSubmissionStatusSync(db));
  }catch(error){
    if(error instanceof SubmissionStatusSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="CANVAS_NOT_CONFIGURED"?409:400},
      );
    }
    return Response.json(
      {code:"SUBMISSION_SYNC_FAILED",message:"Submission status sync could not start."},
      {status:500},
    );
  }
}
