import {z} from "zod";
import {getMicrosoftCalendarConfig,buildMicrosoftAuthorizationUrl} from "@/lib/calendar/microsoft/oauth";
import {getLocalOAuthRedirectUri} from "@/lib/calendar/local-oauth-origin";
import {registerOAuthRequest} from "@/lib/calendar/oauth-registry";
import {CalendarSyncError} from "@/lib/calendar/errors";
const schema=z.object({connectionId:z.string().min(1).optional()}).strict();
export async function POST(request:Request){
  let body:unknown={};try{body=await request.json();}catch{}
  const parsed=schema.safeParse(body);if(!parsed.success)return Response.json({code:"INVALID_REQUEST",message:"Invalid calendar request."},{status:400});
  try{
    const config=getMicrosoftCalendarConfig();
    const redirectUri=getLocalOAuthRedirectUri(request.url,"/api/calendars/microsoft/callback");
    const registered=registerOAuthRequest({provider:"microsoft",redirectUri,connectionId:parsed.data.connectionId??null});
    return Response.json({authorizationUrl:buildMicrosoftAuthorizationUrl({...config,...registered,redirectUri}).toString()});
  }catch(error){
    const e=error instanceof CalendarSyncError?error:new CalendarSyncError("CALENDAR_CONFIG_MISSING","Microsoft Calendar could not start authorization.");
    return Response.json({code:e.code,message:e.message},{status:400});
  }
}
