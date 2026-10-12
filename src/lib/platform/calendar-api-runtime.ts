import "server-only";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import {
  getCalendarRouteRuntime,
  type CalendarRouteRuntime,
} from "@/lib/platform/calendar-runtime";

export type CalendarApiRuntimeResult=
  |{ok:true;runtime:CalendarRouteRuntime}
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

export async function resolveCalendarApiRuntime():Promise<CalendarApiRuntimeResult>{
  const context=getOperationContext()??createOperationContext("calendar.sync");
  return runWithOperationContext(context,async()=>{
    try{
      return {ok:true,runtime:await getCalendarRouteRuntime()};
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
