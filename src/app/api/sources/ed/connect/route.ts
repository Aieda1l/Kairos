import {z} from "zod";
import {connectEd} from "@/lib/ed/discovery-service";
import {getEdRouteFetch} from "@/lib/ed/e2e-fixture-fetch";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {EdSourceError} from "@/lib/sources/ed/errors";

const schema=z.object({token:z.string().trim().min(1).max(4096)}).strict();

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter an Ed API token."},
      {status:400},
    );
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter an Ed API token."},
      {status:400},
    );
  }

  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?await connectEd(runtime.db,parsed.data.token,getEdRouteFetch())
      :await connectEd(
        runtime.db,runtime.scope,runtime.keyring,
        parsed.data.token,getEdRouteFetch(),
      );
    return Response.json(result);
  }catch(error){
    if(error instanceof EdSourceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="ED_AUTH_INVALID"?401:502},
      );
    }
    return Response.json(
      {code:"ED_UPSTREAM_ERROR",message:"Ed could not be connected. Try again."},
      {status:502},
    );
  }
}
