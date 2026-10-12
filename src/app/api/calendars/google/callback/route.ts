import {settleCalendarWrite} from "@/lib/calendar/adapter";
import {withOwnedOperation,ownedFetch,OperationControlVersionChangedError} from "@/lib/abuse/operation-lock";
import {consumeOAuthRequest} from "@/lib/calendar/oauth-registry";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleCalendarConfig,
} from "@/lib/calendar/google/oauth";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";
import {abuseErrorResponse} from "@/lib/abuse/guard";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";

export async function GET(request:Request){
  return runWithOperationContext(createOperationContext("calendar.connect"),async()=>{
    try{return await completeCallback(request);}catch(error){
      const admission=abuseErrorResponse(error);
      emitOperationEvent(getOperationContext()!,{code:"SERVICE_UNAVAILABLE",result:"error",provider:"google",
        ...(admission?{status:admission.status}:{})});
      if(admission)return admission;
      throw error;
    }
  });
}

async function completeCallback(request:Request){
  const context=getOperationContext()!;
  const url=new URL(request.url);
  const state=url.searchParams.get("state");
  const code=url.searchParams.get("code");
  if(!state||!code){
    emitOperationEvent(context,{code:"CALENDAR_AUTH_REQUIRED",result:"rejected",provider:"google",status:400});
    return Response.json({
      code:"CALENDAR_AUTH_REQUIRED",
      message:"Google Calendar authorization was not completed.",
    },{status:400});
  }

  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const registered=runtime.kind==="legacy"
    ?consumeOAuthRequest(state,"google")
    :await consumeOAuthRequest(
      runtime.db,runtime.scope,runtime.keyring,state,"google",
    );
  if(!registered){
    emitOperationEvent(context,{code:"CALENDAR_AUTH_REQUIRED",result:"rejected",provider:"google",status:400});
    return Response.json({
      code:"CALENDAR_AUTH_REQUIRED",
      message:"Google Calendar authorization request is no longer active.",
    },{status:400});
  }

  try{
    if(runtime.kind==="hosted"&&(!Number.isSafeInteger(registered.controlVersion)||registered.controlVersion!<0))throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Calendar authorization request is no longer active.");
    const work=async()=>{
      const config=getGoogleCalendarConfig();
      const token=await settleCalendarWrite(()=>exchangeGoogleAuthorizationCode({
        ...config,
        code,
        codeVerifier:registered.codeVerifier,
        redirectUri:registered.redirectUri,
      },ownedFetch(fetch)));
      if(runtime.kind==="legacy"){
        await connectOAuthCalendar(runtime.db,{
          provider:"google",
          accessToken:token.accessToken,
          refreshToken:token.refreshToken,
          connectionId:registered.connectionId,
        });
      }else{
        const control=await new D1AbuseControlRepository(runtime.db).get("provider:google");
        if(!control.enabled||control.version!==registered.controlVersion)throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Calendar authorization request is no longer active.");
        await settleCalendarWrite(()=>connectOAuthCalendar(
          runtime.db,runtime.scope,runtime.keyring,{
            provider:"google",
            accessToken:token.accessToken,
            refreshToken:token.refreshToken,
            connectionId:registered.connectionId,
          },
        ));
      }
      const response=Response.redirect(
        new URL(registered.returnTo,registered.redirectUri),
        307,
      );
      return response;
    };
    const response=await (runtime.kind==="legacy"?work():withOwnedOperation(runtime.db,runtime.scope,"calendar:google",work,{expectedControlVersion:registered.controlVersion}));
    emitOperationEvent(context,{code:"CALENDAR_CONNECTED",result:"ok",provider:"google",status:307});
    return response;
  }catch(error){
    if(abuseErrorResponse(error))throw error;
    const e=error instanceof OperationControlVersionChangedError
      ?new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Calendar authorization request is no longer active.")
      :error instanceof CalendarSyncError
      ?error
      :new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Google Calendar could not be connected.",
      );
    const status=e.code==="CALENDAR_AUTH_EXPIRED"?401:502;
    emitOperationEvent(context,{code:e.code,result:"error",provider:"google",status});
    return Response.json(
      {code:e.code,message:e.message},
      {status},
    );
  }
}
