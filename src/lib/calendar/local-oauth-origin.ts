import "server-only";
import {CalendarSyncError} from "@/lib/calendar/errors";

export function getLocalOAuthRedirectUri(requestUrl:string,callbackPath:string):string{
  let request:URL;
  try{
    request=new URL(requestUrl);
  }catch{
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","OAuth callback origin is invalid.");
  }
  if(
    request.protocol!=="http:"
    ||(request.hostname!=="localhost"&&request.hostname!=="127.0.0.1")
    ||Boolean(request.username)
    ||Boolean(request.password)
  ){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","OAuth callbacks require a local Kairos HTTP origin.");
  }
  if(!callbackPath.startsWith("/")||callbackPath.startsWith("//")){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","OAuth callback path is invalid.");
  }
  const origin=`${request.protocol}//${request.host}`;
  return new URL(callbackPath,origin).toString();
}
