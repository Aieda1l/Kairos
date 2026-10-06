import "server-only";
import type Database from "better-sqlite3";
import type {CalendarConnection,CalendarProvider} from "@/lib/calendar/types";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarCredentialRepository} from "@/lib/db/repositories/calendar-credentials";
import {CalendarEventLinkRepository} from "@/lib/db/repositories/calendar-event-links";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {GoogleCalendarClient} from "@/lib/calendar/google/client";
import {GoogleCalendarAdapter} from "@/lib/calendar/google/adapter";
import {MicrosoftCalendarClient} from "@/lib/calendar/microsoft/client";
import {MicrosoftCalendarAdapter} from "@/lib/calendar/microsoft/adapter";
import {CalDavClient} from "@/lib/calendar/caldav/client";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {getCalendarRouteFetch} from "@/lib/calendar/e2e-fixture-fetch";

function pending(provider:CalendarProvider,label:string):CalendarConnection{
  return {
    id:"pending",
    provider,label,accountLabel:null,remoteCalendarId:null,remoteCalendarName:null,
    enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
  };
}

export async function connectOAuthCalendar(
  db:Database.Database,
  input:{
    provider:"google"|"microsoft";
    accessToken:string;
    refreshToken:string|null;
    connectionId?:string|null;
    fetchImpl?:typeof fetch;
  },
):Promise<CalendarConnection>{
  const connections=new CalendarConnectionRepository(db);
  const credentials=new CalendarCredentialRepository(db);
  const existing=input.connectionId?connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(existing&&existing.provider!==input.provider)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  const storedRefresh=existing?credentials.getOAuthRefreshToken(existing.id):null;
  const refreshToken=input.refreshToken??storedRefresh;
  if(!refreshToken)throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","The calendar provider did not return offline access.");
  const label=input.provider==="google"?"Google Calendar":"Outlook / Microsoft 365";
  const base=existing??pending(input.provider,label);
  const client=input.provider==="google"
    ?new GoogleCalendarClient(input.accessToken,input.fetchImpl??fetch)
    :new MicrosoftCalendarClient(input.accessToken,input.fetchImpl??fetch);
  const adapter=input.provider==="google"
    ?new GoogleCalendarAdapter(base,client as GoogleCalendarClient)
    :new MicrosoftCalendarAdapter(base,client as MicrosoftCalendarClient);

  let remote:{remoteCalendarId:string;name:string}|null=null;
  if(existing?.remoteCalendarId){
    try{
      await adapter.testConnection();
      remote={remoteCalendarId:existing.remoteCalendarId,name:existing.remoteCalendarName??"Kairos"};
    }catch(error){
      if(!(error instanceof CalendarSyncError)||error.code!=="CALENDAR_REMOTE_CALENDAR_MISSING")throw error;
    }
  }
  if(!remote)remote=await adapter.ensureCalendar();

  const connection=existing??connections.create({provider:input.provider,label});
  const updated=connections.updateRemoteCalendar(connection.id,remote.remoteCalendarId,remote.name);
  credentials.setOAuthRefreshToken(updated.id,refreshToken);
  return updated;
}

export async function testCaldavCredentials(
  username:string,
  secret:string,
  fetchImpl:typeof fetch=getCalendarRouteFetch(),
):Promise<{calendarCount:number}>{
  const client=new CalDavClient(username,secret,fetchImpl);
  const calendars=await client.discoverCalendars();
  return {calendarCount:calendars.filter(item=>item.writable).length};
}

export async function connectCaldavCalendar(
  db:Database.Database,
  input:{username:string;secret:string;connectionId?:string|null;fetchImpl?:typeof fetch},
):Promise<CalendarConnection>{
  const connections=new CalendarConnectionRepository(db);
  const credentials=new CalendarCredentialRepository(db);
  const existing=input.connectionId?connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(existing&&existing.provider!=="caldav")throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  const client=new CalDavClient(input.username,input.secret,input.fetchImpl??getCalendarRouteFetch());
  let remote:{remoteCalendarId:string;name:string}|null=null;
  if(existing?.remoteCalendarId)remote=await client.getCalendar(existing.remoteCalendarId);
  if(!remote)remote=await client.createCalendar("Kairos");

  const connection=existing??connections.create({
    provider:"caldav",
    label:"Apple iCloud Calendar",
    accountLabel:input.username,
  });
  const updated=connections.updateRemoteCalendar(connection.id,remote.remoteCalendarId,remote.name);
  credentials.setCaldavCredentials(updated.id,input.username,input.secret);
  return updated;
}

export function disconnectCalendar(db:Database.Database,connectionId:string):boolean{
  const connections=new CalendarConnectionRepository(db);
  if(!connections.getById(connectionId))return false;
  connections.delete(connectionId);
  return true;
}

export async function removeManagedCalendarEvents(
  db:Database.Database,
  connectionId:string,
  options:{fetchImpl?:typeof fetch;env?:Record<string,string|undefined>}={},
):Promise<{deletedCount:number;failedCount:number}>{
  const connections=new CalendarConnectionRepository(db);
  const connection=connections.getById(connectionId);
  if(!connection)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(!connection.remoteCalendarId)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection has no Kairos calendar.");
  const links=new CalendarEventLinkRepository(db);
  const rows=links.listByConnection(connection.id);
  if(rows.length===0)return {deletedCount:0,failedCount:0};
  const adapter=await createCalendarAdapterFactory(db,options)(connection);
  await adapter.testConnection();
  let deletedCount=0,failedCount=0;
  for(const link of rows){
    if(!link.remoteEventId){failedCount++;continue;}
    try{
      await adapter.deleteEvent(connection.remoteCalendarId,link.remoteEventId);
      links.delete(link.id);
      deletedCount++;
    }catch{
      failedCount++;
    }
  }
  return {deletedCount,failedCount};
}
