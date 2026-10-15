import "server-only";
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
  try{
    return {ok:true,runtime:await getCalendarRouteRuntime()};
  }catch(error){
    if(!isAuthenticationRequired(error))throw error;
    return {
      ok:false,
      response:Response.json({
        code:"AUTH_REQUIRED",
        message:"Authentication required.",
      },{status:401}),
    };
  }
}
