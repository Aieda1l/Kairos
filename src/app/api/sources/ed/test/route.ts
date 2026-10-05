import { z } from "zod";
import { testEdConnection } from "@/lib/ed/discovery-service";
import { EdSourceError } from "@/lib/sources/ed/errors";
import { getEdRouteFetch } from "@/lib/ed/e2e-fixture-fetch";

const schema=z.object({token:z.string().trim().min(1).max(4096)}).strict();

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}catch{
    return Response.json({ok:false,code:"INVALID_REQUEST",message:"Enter an Ed API token."},{status:400});
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({ok:false,code:"INVALID_REQUEST",message:"Enter an Ed API token."},{status:400});
  }
  try{
    return Response.json(await testEdConnection(parsed.data.token,getEdRouteFetch()));
  }catch(error){
    if(error instanceof EdSourceError){
      return Response.json({ok:false,code:error.code,message:error.message},{status:error.code==="ED_AUTH_INVALID"?401:502});
    }
    return Response.json({ok:false,code:"ED_UPSTREAM_ERROR",message:"Ed could not be tested. Try again."},{status:502});
  }
}
