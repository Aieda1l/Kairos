import {z} from "zod";
import {
  buildGoogleAuthorizationUrl,
  getGoogleCalendarConfig,
} from "@/lib/calendar/google/oauth";
import {getOAuthRedirectUri} from "@/lib/calendar/local-oauth-origin";
import {registerOAuthRequest} from "@/lib/calendar/oauth-registry";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

const schema=z.object({connectionId:z.string().min(1).optional()}).strict();

export async function POST(request:Request){
  let body:unknown={};
  try{body=await request.json();}catch{}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({
      code:"INVALID_REQUEST",
      message:"Invalid calendar request.",
    },{status:400});
  }

  try{
    const config=getGoogleCalendarConfig();
    const resolved=await resolveCalendarApiRuntime();
    if(!resolved.ok)return resolved.response;
    const runtime=resolved.runtime;
    const redirectUri=getOAuthRedirectUri(
      request.url,
      "/api/calendars/google/callback",
      process.env,
    );
    const input={
      provider:"google" as const,
      redirectUri,
      connectionId:parsed.data.connectionId??null,
    };
    const registered=runtime.kind==="legacy"
      ?registerOAuthRequest(input)
      :await registerOAuthRequest(
        runtime.db,runtime.scope,runtime.keyring,input,
      );
    return Response.json({
      authorizationUrl:buildGoogleAuthorizationUrl({
        ...config,
        ...registered,
        redirectUri,
      }).toString(),
    });
  }catch(error){
    const e=error instanceof CalendarSyncError
      ?error
      :new CalendarSyncError(
        "CALENDAR_CONFIG_MISSING",
        "Google Calendar could not start authorization.",
      );
    return Response.json({code:e.code,message:e.message},{status:400});
  }
}
