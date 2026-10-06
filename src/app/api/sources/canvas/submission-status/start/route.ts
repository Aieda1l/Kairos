import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {
  startCanvasSubmissionStatusSync,
  SubmissionStatusSyncServiceError,
} from "@/lib/submission-status/sync-service";

export async function POST(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?startCanvasSubmissionStatusSync(runtime.db)
      :await startCanvasSubmissionStatusSync(runtime.db,runtime.scope);
    return Response.json(result);
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
