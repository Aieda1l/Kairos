import {abuseErrorResponse} from "@/lib/abuse/guard";
import {withSyncAllRequest} from '@/lib/abuse/sync-all';
import {
  startGradescopeSync,
  GradescopeSyncServiceError,
} from "@/lib/gradescope/sync-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

export async function POST(request?:Request){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    return await withSyncAllRequest(runtime,request,'gradescope',async()=>{
    const result=runtime.kind==="legacy"
      ?startGradescopeSync(runtime.db)
      :await startGradescopeSync(runtime.db,runtime.scope);
    return Response.json(result);
    });
  }catch(error){
    const ownership=abuseErrorResponse(error);if(ownership)return ownership;
    if(error instanceof GradescopeSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:
          error.code==="GRADESCOPE_NOT_CONFIGURED"
          ||error.code==="GRADESCOPE_NO_COURSES_ENABLED"
            ?409
            :400},
      );
    }
    return Response.json(
      {code:"GRADESCOPE_SYNC_FAILED",message:"Gradescope sync could not start."},
      {status:500},
    );
  }
}
