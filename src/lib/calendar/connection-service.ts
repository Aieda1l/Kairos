import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarAdapterFactory} from "@/lib/calendar/adapter";
import type {CalendarConnection,CalendarProvider} from "@/lib/calendar/types";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
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
import type {CredentialKeyring} from "@/lib/security/credential-cipher";

function pending(provider:CalendarProvider,label:string):CalendarConnection{
  return {
    id:"pending",
    provider,label,accountLabel:null,remoteCalendarId:null,remoteCalendarName:null,
    enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
  };
}

type OAuthConnectInput={
  provider:"google"|"microsoft";
  accessToken:string;
  refreshToken:string|null;
  connectionId?:string|null;
  fetchImpl?:typeof fetch;
};

async function connectOAuthHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  input:OAuthConnectInput,
):Promise<CalendarConnection>{
  const connections=new D1CalendarConnectionRepository(db,scope);
  const credentials=new D1CalendarCredentialRepository(db,scope,keyring);
  const existing=input.connectionId?await connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  }
  if(existing&&existing.provider!==input.provider){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  }

  const storedRefresh=existing?await credentials.getOAuthRefreshToken(existing.id):null;
  const refreshToken=input.refreshToken??storedRefresh;
  if(!refreshToken){
    throw new CalendarSyncError("CALENDAR_AUTH_REQUIRED","The calendar provider did not return offline access.");
  }

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
      remote={
        remoteCalendarId:existing.remoteCalendarId,
        name:existing.remoteCalendarName??"Kairos",
      };
    }catch(error){
      if(
        !(error instanceof CalendarSyncError)
        ||error.code!=="CALENDAR_REMOTE_CALENDAR_MISSING"
      )throw error;
    }
  }
  if(!remote)remote=await adapter.ensureCalendar();

  const connection=existing??await connections.create({provider:input.provider,label});
  const updated=await connections.updateRemoteCalendar(
    connection.id,remote.remoteCalendarId,remote.name,
  );
  await credentials.setOAuthRefreshToken(updated.id,refreshToken);
  return updated;
}

export function connectOAuthCalendar(
  db:LegacyDatabase,
  input:OAuthConnectInput,
):Promise<CalendarConnection>;
export function connectOAuthCalendar(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  input:OAuthConnectInput,
):Promise<CalendarConnection>;
export async function connectOAuthCalendar(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:OAuthConnectInput|UserScope,
  arg3?:CredentialKeyring,
  arg4?:OAuthConnectInput,
):Promise<CalendarConnection>{
  if("userId" in arg2){
    return connectOAuthHosted(db as D1DatabaseLike,arg2,arg3!,arg4!);
  }

  const input=arg2;
  const legacyDb=db as LegacyDatabase;
  const connections=new CalendarConnectionRepository(legacyDb);
  const credentials=new CalendarCredentialRepository(legacyDb);
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

type CaldavConnectInput={
  username:string;
  secret:string;
  connectionId?:string|null;
  fetchImpl?:typeof fetch;
};

async function connectCaldavHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  input:CaldavConnectInput,
):Promise<CalendarConnection>{
  const connections=new D1CalendarConnectionRepository(db,scope);
  const credentials=new D1CalendarCredentialRepository(db,scope,keyring);
  const existing=input.connectionId?await connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  }
  if(existing&&existing.provider!=="caldav"){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  }

  const client=new CalDavClient(
    input.username,input.secret,input.fetchImpl??getCalendarRouteFetch(),
  );
  let remote:{remoteCalendarId:string;name:string}|null=null;
  if(existing?.remoteCalendarId)remote=await client.getCalendar(existing.remoteCalendarId);
  if(!remote)remote=await client.createCalendar("Kairos");

  const connection=existing??await connections.create({
    provider:"caldav",
    label:"Apple iCloud Calendar",
    accountLabel:input.username,
  });
  const updated=await connections.updateRemoteCalendar(
    connection.id,remote.remoteCalendarId,remote.name,
  );
  await credentials.setCaldavCredentials(updated.id,input.username,input.secret);
  return updated;
}

export function connectCaldavCalendar(
  db:LegacyDatabase,
  input:CaldavConnectInput,
):Promise<CalendarConnection>;
export function connectCaldavCalendar(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  input:CaldavConnectInput,
):Promise<CalendarConnection>;
export async function connectCaldavCalendar(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:CaldavConnectInput|UserScope,
  arg3?:CredentialKeyring,
  arg4?:CaldavConnectInput,
):Promise<CalendarConnection>{
  if("userId" in arg2){
    return connectCaldavHosted(db as D1DatabaseLike,arg2,arg3!,arg4!);
  }

  const input=arg2;
  const legacyDb=db as LegacyDatabase;
  const connections=new CalendarConnectionRepository(legacyDb);
  const credentials=new CalendarCredentialRepository(legacyDb);
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

export function disconnectCalendar(
  db:LegacyDatabase,
  connectionId:string,
):boolean;
export function disconnectCalendar(
  db:D1DatabaseLike,
  scope:UserScope,
  connectionId:string,
):Promise<boolean>;
export function disconnectCalendar(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:string|UserScope,
  arg3?:string,
):boolean|Promise<boolean>{
  if(typeof arg2!=="string"){
    return (async()=>{
      const connections=new D1CalendarConnectionRepository(
        db as D1DatabaseLike,arg2,
      );
      const id=arg3!;
      if(!await connections.getById(id))return false;
      await connections.delete(id);
      return true;
    })();
  }

  const connections=new CalendarConnectionRepository(db as LegacyDatabase);
  if(!connections.getById(arg2))return false;
  connections.delete(arg2);
  return true;
}

type RemoveOptions={
  fetchImpl?:typeof fetch;
  env?:Record<string,string|undefined>;
  adapterFactory?:CalendarAdapterFactory;
};

async function removeHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  connectionId:string,
  options:RemoveOptions,
):Promise<{deletedCount:number;failedCount:number}>{
  const connections=new D1CalendarConnectionRepository(db,scope);
  const connection=await connections.getById(connectionId);
  if(!connection)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(!connection.remoteCalendarId)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection has no Kairos calendar.");

  const links=new D1CalendarEventLinkRepository(db,scope);
  const rows=await links.listByConnection(connection.id);
  if(rows.length===0)return {deletedCount:0,failedCount:0};
  const factory=options.adapterFactory
    ??createCalendarAdapterFactory(db,scope,keyring,options);
  const adapter=await factory(connection);
  await adapter.testConnection();

  let deletedCount=0;
  let failedCount=0;
  for(const link of rows){
    if(!link.remoteEventId){failedCount++;continue;}
    try{
      await adapter.deleteEvent(connection.remoteCalendarId,link.remoteEventId);
      await links.delete(link.id);
      deletedCount++;
    }catch{
      failedCount++;
    }
  }
  return {deletedCount,failedCount};
}

export function removeManagedCalendarEvents(
  db:LegacyDatabase,
  connectionId:string,
  options?:RemoveOptions,
):Promise<{deletedCount:number;failedCount:number}>;
export function removeManagedCalendarEvents(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  connectionId:string,
  options?:RemoveOptions,
):Promise<{deletedCount:number;failedCount:number}>;
export async function removeManagedCalendarEvents(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:string|UserScope,
  arg3?:RemoveOptions|CredentialKeyring,
  arg4?:string,
  arg5:RemoveOptions={},
):Promise<{deletedCount:number;failedCount:number}>{
  if(typeof arg2!=="string"){
    return removeHosted(
      db as D1DatabaseLike,
      arg2,
      arg3 as CredentialKeyring,
      arg4!,
      arg5,
    );
  }

  const connectionId=arg2;
  const options=(arg3 as RemoveOptions|undefined)??{};
  const legacyDb=db as LegacyDatabase;
  const connections=new CalendarConnectionRepository(legacyDb);
  const connection=connections.getById(connectionId);
  if(!connection)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(!connection.remoteCalendarId)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection has no Kairos calendar.");
  const links=new CalendarEventLinkRepository(legacyDb);
  const rows=links.listByConnection(connection.id);
  if(rows.length===0)return {deletedCount:0,failedCount:0};
  const factory=options.adapterFactory??createCalendarAdapterFactory(legacyDb,options);
  const adapter=await factory(connection);
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
