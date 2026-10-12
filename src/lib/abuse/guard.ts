import {getOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {OperationOwnershipError,OperationControlVersionChangedError} from "./operation-lock";
import "server-only";
import {D1RateLimitRepository} from "@/lib/db/d1/repositories/rate-limits";
import {hashRateKey,rateKeyParts} from "./keys";
import {budgetForSubject} from "./policy";
import {AbuseClientAddressError,AbuseConfigurationError,AbuseStorageUnavailableError,AbuseSubjectError,RateLimitedError,
  type AbuseRuntime,type RateSubject} from "./types";

export async function enforceBudget(runtime:AbuseRuntime,subject:RateSubject):Promise<void>{
  const budget=budgetForSubject(subject,runtime.policy);
  const keyHash=await hashRateKey(runtime.hmacKey,rateKeyParts(subject));
  const decision=await new D1RateLimitRepository(runtime.db).consume({keyHash,
    userId:subject.class==="auth-initiation"?null:subject.userId,...budget});
  if(!decision.allowed)throw new RateLimitedError(decision.retryAfterSeconds);
}

export function abuseErrorResponse(error:unknown):Response|null{
  const headers=new Headers({"Cache-Control":"no-store"});
  if(error instanceof OperationControlVersionChangedError){
    const context=getOperationContext();if(context)emitOperationEvent(context,{code:"CREDENTIAL_REJECTED",result:"rejected",status:409});
    return Response.json({code:error.code,message:error.message},{status:409,headers});
  }
  if(error instanceof OperationOwnershipError){
    const context=getOperationContext();if(context)emitOperationEvent(context,{code:error.code,result:"rejected",status:409});
    return Response.json({code:error.code,message:error.message},{status:409,headers});
  }
  if(error instanceof RateLimitedError){
    headers.set("Retry-After",String(error.retryAfterSeconds));
    return Response.json({code:error.code,message:error.message,retryAfterSeconds:error.retryAfterSeconds},{status:429,headers});
  }
  if(error instanceof AbuseStorageUnavailableError||error instanceof AbuseConfigurationError){
    return Response.json({code:error.code,message:error.message},{status:503,headers});
  }
  if(error instanceof AbuseClientAddressError||error instanceof AbuseSubjectError){
    return Response.json({code:error.code,message:error.message},{status:400,headers});
  }
  return null;
}
