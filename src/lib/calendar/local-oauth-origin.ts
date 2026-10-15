import "server-only";
import {CalendarSyncError} from "@/lib/calendar/errors";

const PRODUCTION_ORIGIN="https://mykairos.me";

function invalidOrigin(message:string):never{
  throw new CalendarSyncError("CALENDAR_CONFIG_MISSING",message);
}

function validateCallbackPath(callbackPath:string):void{
  if(
    !callbackPath.startsWith("/")
    || callbackPath.startsWith("//")
    || callbackPath.includes("\\")
  ){
    invalidOrigin("OAuth callback path is invalid.");
  }
}

export function getOAuthRedirectUri(
  requestUrl:string,
  callbackPath:string,
  env:Record<string,string|undefined>=process.env,
):string{
  validateCallbackPath(callbackPath);

  const configured=env.KAIROS_APP_URL?.trim();
  if(configured){
    let app:URL;
    try{app=new URL(configured);}
    catch{invalidOrigin("OAuth production origin is invalid.");}
    if(
      app.origin!==PRODUCTION_ORIGIN
      || app.pathname!=="/"
      || Boolean(app.search)
      || Boolean(app.hash)
      || Boolean(app.username)
      || Boolean(app.password)
    ){
      invalidOrigin("OAuth production origin must be https://mykairos.me.");
    }
    return new URL(callbackPath,PRODUCTION_ORIGIN).toString();
  }

  let request:URL;
  try{
    request=new URL(requestUrl);
  }catch{
    invalidOrigin("OAuth callback origin is invalid.");
  }
  if(
    request.protocol!=="http:"
    ||(request.hostname!=="localhost"&&request.hostname!=="127.0.0.1")
    ||Boolean(request.username)
    ||Boolean(request.password)
  ){
    invalidOrigin("OAuth callbacks require a local Kairos HTTP origin.");
  }
  const origin=`${request.protocol}//${request.host}`;
  return new URL(callbackPath,origin).toString();
}

export function getLocalOAuthRedirectUri(
  requestUrl:string,
  callbackPath:string,
):string{
  return getOAuthRedirectUri(requestUrl,callbackPath,{});
}
