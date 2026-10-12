import {consumeOAuthRequest} from "@/lib/calendar/oauth-registry";
import {
  exchangeMicrosoftAuthorizationCode,
  getMicrosoftCalendarConfig,
} from "@/lib/calendar/microsoft/oauth";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";
import {abuseErrorResponse} from "@/lib/abuse/guard";

export async function GET(request:Request){
  return runWithOperationContext(createOperationContext("calendar.connect"),async()=>{
    try{return await completeCallback(request);}catch(error){
      const admission=abuseErrorResponse(error);
      emitOperationEvent(getOperationContext()!,{code:"SERVICE_UNAVAILABLE",result:"error",provider:"microsoft",
        ...(admission?{status:admission.status}:{})});
      if(admission)return admission;
      throw error;
    }
  });
}

async function completeCallback(request:Request){
  const context=getOperationContext()!;
  const started=performance.now();
  const url=new URL(request.url);
  const state=url.searchParams.get("state");
  const code=url.searchParams.get("code");
  if(!state||!code){
    emitOperationEvent(context,{code:"CALENDAR_AUTH_REQUIRED",result:"rejected",provider:"microsoft",status:400});
    return Response.json({
      code:"CALENDAR_AUTH_REQUIRED",
      message:"Microsoft Calendar authorization was not completed.",
    },{status:400});
  }

  const resolved=await resolveCalendarApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const registered=runtime.kind==="legacy"
    ?consumeOAuthRequest(state,"microsoft")
    :await consumeOAuthRequest(
      runtime.db,runtime.scope,runtime.keyring,state,"microsoft",
    );
  if(!registered){
    emitOperationEvent(context,{code:"CALENDAR_AUTH_REQUIRED",result:"rejected",provider:"microsoft",status:400});
    return Response.json({
      code:"CALENDAR_AUTH_REQUIRED",
      message:"Microsoft Calendar authorization request is no longer active.",
    },{status:400});
  }

  let stage:"configuration"|"token_exchange"|"calendar_setup"="configuration";
  try{
    const config=getMicrosoftCalendarConfig();
    stage="token_exchange";
    const token=await exchangeMicrosoftAuthorizationCode({
      ...config,
      code,
      codeVerifier:registered.codeVerifier,
      redirectUri:registered.redirectUri,
    });
    stage="calendar_setup";
    if(runtime.kind==="legacy"){
      await connectOAuthCalendar(runtime.db,{
        provider:"microsoft",
        accessToken:token.accessToken,
        refreshToken:token.refreshToken,
        connectionId:registered.connectionId,
      });
    }else{
      const control=await new D1AbuseControlRepository(runtime.db).get("provider:microsoft");
      if(!control.enabled||control.version!==registered.controlVersion)throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Calendar authorization request is no longer active.");
      await connectOAuthCalendar(
        runtime.db,runtime.scope,runtime.keyring,{
          provider:"microsoft",
          accessToken:token.accessToken,
          refreshToken:token.refreshToken,
          connectionId:registered.connectionId,
        },
      );
    }
    const response=Response.redirect(
      new URL(registered.returnTo,registered.redirectUri),
      307,
    );
    emitOperationEvent(context,{code:"CALENDAR_CONNECTED",result:"ok",provider:"microsoft",status:307,durationMs:performance.now()-started});
    return response;
  }catch(error){
    if(abuseErrorResponse(error))throw error;
    const e=error instanceof CalendarSyncError
      ?error
      :new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar could not be connected.",
      );
    emitOperationEvent(context,{code:e.code,result:"error",provider:"microsoft",status:303,durationMs:performance.now()-started});
    // A browser follows this callback after consent. Return to the app and
    // remove the one-time authorization code from the address bar/history.
    // Only a fixed application error code is carried to the UI.
    const destination=new URL(registered.returnTo,registered.redirectUri);
    destination.searchParams.set("calendarProvider","microsoft");
    destination.searchParams.set("calendarError",e.code);
    destination.searchParams.set("calendarStage",stage);
    return new Response(null,{
      status:303,
      headers:{location:destination.toString(),"cache-control":"no-store"},
    });
  }
}
