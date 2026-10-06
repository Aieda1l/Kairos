import {
  EdDiscoveryServiceError,
  refreshEdCourses,
} from "@/lib/ed/discovery-service";
import {getEdRouteFetch} from "@/lib/ed/e2e-fixture-fetch";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {EdSourceError} from "@/lib/sources/ed/errors";

export async function POST(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?await refreshEdCourses(runtime.db,getEdRouteFetch())
      :await refreshEdCourses(
        runtime.db,runtime.scope,runtime.keyring,getEdRouteFetch(),
      );
    return Response.json(result);
  }catch(error){
    if(error instanceof EdDiscoveryServiceError){
      return Response.json({code:error.code,message:error.message},{status:409});
    }
    if(error instanceof EdSourceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="ED_AUTH_INVALID"?401:502},
      );
    }
    return Response.json(
      {code:"ED_UPSTREAM_ERROR",message:"Ed courses could not be refreshed."},
      {status:502},
    );
  }
}
