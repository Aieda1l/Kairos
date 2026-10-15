import {consumeOAuthRequest} from "@/lib/calendar/oauth-registry";
import {
  exchangeMicrosoftAuthorizationCode,
  getMicrosoftCalendarConfig,
} from "@/lib/calendar/microsoft/oauth";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

export async function GET(request:Request){
  const url=new URL(request.url);
  const state=url.searchParams.get("state");
  const code=url.searchParams.get("code");
  if(!state||!code){
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
      await connectOAuthCalendar(
        runtime.db,runtime.scope,runtime.keyring,{
          provider:"microsoft",
          accessToken:token.accessToken,
          refreshToken:token.refreshToken,
          connectionId:registered.connectionId,
        },
      );
    }
    return Response.redirect(
      new URL(registered.returnTo,registered.redirectUri),
      307,
    );
  }catch(error){
    const e=error instanceof CalendarSyncError
      ?error
      :new CalendarSyncError(
        "CALENDAR_UPSTREAM_ERROR",
        "Microsoft Calendar could not be connected.",
      );
    console.warn("Kairos Microsoft Calendar connection failed",{
      stage,code:e.code,
    });
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
