import { getDatabase } from "@/lib/db/client";
import { reconcileCalendarsAfterSourceWrite } from "@/lib/calendar/post-source-sync";
import { migrate } from "@/lib/db/migrate";
import {
  completeCanvasSubmissionStatusSync,
  submissionSyncCompleteInputSchema,
  SubmissionStatusSyncServiceError,
} from "@/lib/submission-status/sync-service";

export async function POST(request:Request){
  let body:unknown;
  try{
    body=await request.json();
  }catch{
    return Response.json({code:"INVALID_RESULT",message:"The submission-status result was invalid."},{status:400});
  }
  const parsed=submissionSyncCompleteInputSchema.safeParse(body);
  if(!parsed.success){
    return Response.json({code:"INVALID_RESULT",message:"The submission-status result was invalid."},{status:400});
  }

  const db=getDatabase();
  migrate(db);
  try{
    const result=completeCanvasSubmissionStatusSync(db,parsed.data);
    await reconcileCalendarsAfterSourceWrite(db,{
      defer:request.headers.get("x-kairos-calendar-sync")==="defer",
      changed:result.updatedCount>0,
    });
    return Response.json(result);
  }catch(error){
    if(error instanceof SubmissionStatusSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="SYNC_REQUEST_NOT_FOUND"?409:400},
      );
    }
    return Response.json(
      {code:"SUBMISSION_SYNC_FAILED",message:"Submission status could not be saved."},
      {status:500},
    );
  }
}
