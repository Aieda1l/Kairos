import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {consumeOAuthRequest} from "@/lib/calendar/oauth-registry";
import {exchangeMicrosoftAuthorizationCode,getMicrosoftCalendarConfig} from "@/lib/calendar/microsoft/oauth";
import {connectOAuthCalendar} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
export async function GET(request:Request){
  const url=new URL(request.url);const state=url.searchParams.get("state");const code=url.searchParams.get("code");
  if(!state||!code)return Response.json({code:"CALENDAR_AUTH_REQUIRED",message:"Microsoft Calendar authorization was not completed."},{status:400});
  const registered=consumeOAuthRequest(state,"microsoft");
  if(!registered)return Response.json({code:"CALENDAR_AUTH_REQUIRED",message:"Microsoft Calendar authorization request is no longer active."},{status:400});
  try{
    const config=getMicrosoftCalendarConfig();
    const token=await exchangeMicrosoftAuthorizationCode({...config,code,codeVerifier:registered.codeVerifier,redirectUri:registered.redirectUri});
    const db=getDatabase();migrate(db);
    await connectOAuthCalendar(db,{provider:"microsoft",accessToken:token.accessToken,refreshToken:token.refreshToken,connectionId:registered.connectionId});
    return Response.redirect(new URL(registered.returnTo,registered.redirectUri),307);
  }catch(error){
    const e=error instanceof CalendarSyncError?error:new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","Microsoft Calendar could not be connected.");
    return Response.json({code:e.code,message:e.message},{status:e.code==="CALENDAR_AUTH_EXPIRED"?401:502});
  }
}
