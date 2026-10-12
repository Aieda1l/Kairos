import "server-only";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import {
  getSourceRuntimeContext,
  type SourceRuntimeContext,
} from "@/lib/platform/source-runtime";

export type SourceRouteRuntime=
  |{kind:"legacy";db:LegacyDatabase}
  |({kind:"hosted"}&SourceRuntimeContext);

export type SourceApiRuntimeResult=
  |{ok:true;runtime:SourceRouteRuntime}
  |{ok:false;response:Response};

function isAuthenticationRequired(error:unknown):boolean{
  return error instanceof AuthenticationRequiredError
    ||(
      typeof error==="object"
      && error!==null
      && "code" in error
      && (error as {code?:unknown}).code==="AUTH_REQUIRED"
    );
}

export async function getSourceRouteRuntime():Promise<SourceRouteRuntime>{
  return {kind:"hosted",...await getSourceRuntimeContext()};
}

export async function resolveSourceApiRuntime():Promise<SourceApiRuntimeResult>{
  const context=getOperationContext()??createOperationContext("source.sync");
  return runWithOperationContext(context,async()=>{
    try{
      return {ok:true,runtime:await getSourceRouteRuntime()};
    }catch(error){
      if(!isAuthenticationRequired(error)){
        emitOperationEvent(context,{code:"SERVICE_UNAVAILABLE",result:"error",status:503});
        throw error;
      }
      emitOperationEvent(context,{code:"AUTH_REQUIRED",result:"rejected",status:401});
      return {
        ok:false,
        response:Response.json({
          code:"AUTH_REQUIRED",
          message:"Authentication required.",
        },{status:401}),
      };
    }
  });
}
