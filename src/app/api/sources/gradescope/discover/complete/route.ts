import {gradescopeDiscoverResultV1Schema} from "@/lib/extension-protocol/gradescope";
import {
  completeGradescopeDiscovery,
  GradescopeDiscoveryServiceError,
} from "@/lib/gradescope/discovery-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_RESULT",message:"The Gradescope discovery result was invalid."},
      {status:400},
    );
  }

  const parsed=gradescopeDiscoverResultV1Schema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_RESULT",message:"The Gradescope discovery result was invalid."},
      {status:400},
    );
  }

  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?completeGradescopeDiscovery(runtime.db,parsed.data)
      :await completeGradescopeDiscovery(runtime.db,runtime.scope,parsed.data);
    return Response.json(result);
  }catch(error){
    if(error instanceof GradescopeDiscoveryServiceError){
      if(error.code==="SYNC_REQUEST_NOT_FOUND"){
        return Response.json({code:error.code,message:error.message},{status:409});
      }
      if(error.code==="GRADESCOPE_DISCOVERY_FAILED"){
        return Response.json(
          {code:error.sourceCode??error.code,message:error.message},
          {status:502},
        );
      }
      return Response.json({code:error.code,message:error.message},{status:400});
    }
    return Response.json(
      {code:"GRADESCOPE_DISCOVERY_FAILED",message:"Gradescope course discovery could not be saved."},
      {status:500},
    );
  }
}
