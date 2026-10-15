import {abuseErrorResponse} from "@/lib/abuse/guard";
import {withDeletionAttempt} from "@/lib/abuse/deletion-operation";
import {z} from "zod";
import {deleteCurrentAccount} from "@/lib/account/delete-account";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

const schema=z.object({confirmation:z.literal("DELETE")}).strict();

export async function DELETE(request:Request){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  if(resolved.runtime.kind!=="hosted"){
    return Response.json({
      code:"HOSTED_ACCOUNT_REQUIRED",
      message:"Account deletion is available for hosted accounts only.",
    },{status:409});
  }

  const {db,scope}=resolved.runtime;
  try{return await withDeletionAttempt(db,scope,async()=>{
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Type DELETE to confirm account deletion.",
    },{status:400});
  }

  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Type DELETE to confirm account deletion.",
    },{status:400});
  }

  await deleteCurrentAccount(db,scope);
  return new Response(null,{status:204});
  });}catch(error){const response=abuseErrorResponse(error);if(response)return response;throw error;}
}
