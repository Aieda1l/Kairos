import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {
  completeCanvasSubmissionStatusSync,
  submissionSyncCompleteInputSchema,
  SubmissionStatusSyncServiceError,
} from "@/lib/submission-status/sync-service";

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_RESULT",message:"The submission-status result was invalid."},
      {status:400},
    );
  }
  const parsed=submissionSyncCompleteInputSchema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_RESULT",message:"The submission-status result was invalid."},
      {status:400},
    );
  }

  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?completeCanvasSubmissionStatusSync(runtime.db,parsed.data)
      :await completeCanvasSubmissionStatusSync(
        runtime.db,runtime.scope,parsed.data,
      );

    const options={
      defer:request.headers.get("x-kairos-calendar-sync")==="defer",
      changed:result.updatedCount>0,
    };
    if(runtime.kind==="legacy"){
      await reconcileCalendarsAfterSourceWrite(runtime.db,options);
    }else{
      await reconcileCalendarsAfterSourceWrite(
        runtime.db,runtime.scope,runtime.keyring,options,
      );
    }
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
