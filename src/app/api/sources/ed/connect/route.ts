import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { connectEd } from "@/lib/ed/discovery-service";
import { EdSourceError } from "@/lib/sources/ed/errors";

const schema=z.object({token:z.string().trim().min(1).max(4096)}).strict();

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}catch{
    return Response.json({code:"INVALID_REQUEST",message:"Enter an Ed API token."},{status:400});
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({code:"INVALID_REQUEST",message:"Enter an Ed API token."},{status:400});
  }
  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(await connectEd(db,parsed.data.token));
  }catch(error){
    if(error instanceof EdSourceError){
      return Response.json({code:error.code,message:error.message},{status:error.code==="ED_AUTH_INVALID"?401:502});
    }
    return Response.json({code:"ED_UPSTREAM_ERROR",message:"Ed could not be connected. Try again."},{status:502});
  }
}
