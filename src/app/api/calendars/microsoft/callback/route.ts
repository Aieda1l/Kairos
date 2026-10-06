import {consumeOAuthRequest} from "@/lib/calendar/oauth-registry";
import {
  exchangeMicrosoftAuthorizationCode,
  getMicrosoftCalendarConfig,
} from "@/lib/calendar/microsoft/oauth";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {getCalendarRouteRuntime} from "@/lib/platform/calendar-runtime";

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

  const runtime=await getCalendarRouteRuntime();
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

  try{
    const config=getMicrosoftCalendarConfig();
    const token=await exchangeMicrosoftAuthorizationCode({
      ...config,
      code,
      codeVerifier:registered.codeVerifier,
      redirectUri:registered.redirectUri,
    });
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
    return Response.json(
      {code:e.code,message:e.message},
      {status:e.code==="CALENDAR_AUTH_EXPIRED"?401:502},
    );
  }
}
