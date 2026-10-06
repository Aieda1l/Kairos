import "server-only";
import type Database from "better-sqlite3";
import type {CalendarAdapterFactory} from "@/lib/calendar/adapter";
import {CalendarCredentialRepository} from "@/lib/db/repositories/calendar-credentials";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {getGoogleCalendarConfig,refreshGoogleAccessToken} from "@/lib/calendar/google/oauth";
import {GoogleCalendarClient} from "@/lib/calendar/google/client";
import {GoogleCalendarAdapter} from "@/lib/calendar/google/adapter";
import {getMicrosoftCalendarConfig,refreshMicrosoftAccessToken} from "@/lib/calendar/microsoft/oauth";
import {MicrosoftCalendarClient} from "@/lib/calendar/microsoft/client";
import {MicrosoftCalendarAdapter} from "@/lib/calendar/microsoft/adapter";
import {CalDavClient} from "@/lib/calendar/caldav/client";
import {CalDavCalendarAdapter} from "@/lib/calendar/caldav/adapter";
import {getCalendarRouteFetch} from "@/lib/calendar/e2e-fixture-fetch";

export function createCalendarAdapterFactory(
  db:Database.Database,
  options:{fetchImpl?:typeof fetch;env?:Record<string,string|undefined>}={},
):CalendarAdapterFactory{
  const fetchImpl=options.fetchImpl??getCalendarRouteFetch();
  const env=options.env??process.env;
  const credentials=new CalendarCredentialRepository(db);

  return async connection=>{
    if(connection.provider==="google"){
      const refreshToken=credentials.getOAuthRefreshToken(connection.id);
      if(!refreshToken){
        throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Reconnect Google Calendar.");
      }
      const config=getGoogleCalendarConfig(env);
      const token=await refreshGoogleAccessToken({...config,refreshToken},fetchImpl);
      if(token.refreshToken){
        credentials.setOAuthRefreshToken(connection.id,token.refreshToken);
      }
      return new GoogleCalendarAdapter(
        connection,
        new GoogleCalendarClient(token.accessToken,fetchImpl),
      );
    }

    if(connection.provider==="microsoft"){
      const refreshToken=credentials.getOAuthRefreshToken(connection.id);
      if(!refreshToken){
        throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Reconnect Microsoft Calendar.");
      }
      const config=getMicrosoftCalendarConfig(env);
      const token=await refreshMicrosoftAccessToken({...config,refreshToken},fetchImpl);
      if(token.refreshToken){
        credentials.setOAuthRefreshToken(connection.id,token.refreshToken);
      }
      return new MicrosoftCalendarAdapter(
        connection,
        new MicrosoftCalendarClient(token.accessToken,fetchImpl),
      );
    }

    const credential=credentials.getCaldavCredentials(connection.id);
    if(!credential){
      throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","Reconnect Apple Calendar.");
    }
    return new CalDavCalendarAdapter(
      connection,
      new CalDavClient(credential.username,credential.secret,fetchImpl),
    );
  };
}
