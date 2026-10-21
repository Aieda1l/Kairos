import {currentProviderWork,withProviderService} from "@/lib/abuse/provider-operation";
import {guardCalendarAdapter} from "@/lib/calendar/adapter";
import {ownedFetch,uncertainOwnedWork,uncertainOwnedCalendarWrite,throttleOwnedWork,ownedWorkStopped} from "@/lib/abuse/operation-lock";
import "server-only";
import {z} from "zod";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarAdapterFactory,CalendarDestinationAdapter} from "@/lib/calendar/adapter";
import type {CalendarConnection,CalendarProvider} from "@/lib/calendar/types";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1OnboardingDraftRepository} from "@/lib/db/d1/repositories/onboarding-drafts";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarCredentialRepository} from "@/lib/db/repositories/calendar-credentials";
import {CalendarEventLinkRepository} from "@/lib/db/repositories/calendar-event-links";
import {CalendarSyncError,type CalendarSyncErrorCode} from "@/lib/calendar/errors";
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

const googleAccess=z.object({id:z.string(),accessRole:z.string()});
const googleEventAccess=z.object({accessRole:z.string()});
const microsoftAccess=z.object({id:z.string(),canEdit:z.boolean()});

async function requireWritableOAuthCalendar(input:OAuthConnectInput,calendarId:string):Promise<void>{
  const id=encodeURIComponent(calendarId);
  const url=input.provider==="google"
    ?`https://www.googleapis.com/calendar/v3/users/me/calendarList/${id}`
    :`https://graph.microsoft.com/v1.0/me/calendars/${id}`;
  let response:Response;
  let eventAccess=false;
  let calendarListError:CalendarSyncError|undefined;
  try{
    response=await (ownedFetch(input.fetchImpl??fetch))(url,{method:"GET",headers:{authorization:`Bearer ${input.accessToken}`}});
    if(input.provider==='google'&&response.status===403){
      calendarListError=await googleAccessError(response);
      // CalendarList rejection alone does not establish the effective event
      // role on this exact saved calendar. Verify it without requesting
      // broader scopes or reading event details. A denied/read-only role fails.
      if(calendarListError.code==='CALENDAR_PERMISSION_DENIED'){
        response=await ownedFetch(input.fetchImpl??fetch)(`https://www.googleapis.com/calendar/v3/calendars/${id}/events?maxResults=1&fields=accessRole`,{
          method:'GET',headers:{authorization:`Bearer ${input.accessToken}`},
        });
        eventAccess=true;
      }
    }
  }catch{
    throw new CalendarSyncError("CALENDAR_NETWORK_ERROR","The calendar provider could not be reached.");
  }
  if(calendarListError&&!eventAccess)throw calendarListError;
  if(eventAccess)return requireGoogleEventAccess(response);
  if(response.status===404){
    throw new CalendarSyncError("CALENDAR_REMOTE_CALENDAR_MISSING","The existing Kairos calendar is missing. Choose calendar recovery before recreating it.");
  }
  if(!response.ok){
    const code=response.status===401
      ?"CALENDAR_AUTH_EXPIRED":response.status===403?"CALENDAR_PERMISSION_DENIED"
        :response.status===429?"CALENDAR_RATE_LIMITED":"CALENDAR_UPSTREAM_ERROR";
    throw new CalendarSyncError(code,"Calendar authorization or access could not be verified.");
  }
  let body:unknown;
  try{body=await response.json();}catch{
    throw new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","The calendar provider returned an unexpected response.");
  }
  const parsed=input.provider==="google"?googleAccess.safeParse(body):microsoftAccess.safeParse(body);
  if(!parsed.success||parsed.data.id!==calendarId){
    throw new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","The calendar provider returned an unexpected calendar response.");
  }
  const writable="accessRole" in parsed.data
    ?["owner","writer","writerWithoutPrivateAccess"].includes(parsed.data.accessRole)
    :parsed.data.canEdit;
  if(!writable)throw new CalendarSyncError("CALENDAR_PERMISSION_DENIED","The Kairos calendar is not writable with this authorization.");
}

async function requireGoogleEventAccess(response:Response):Promise<void>{
  if(response.status===404)throw new CalendarSyncError('CALENDAR_REMOTE_CALENDAR_MISSING','The existing Kairos calendar is missing. Choose calendar recovery before recreating it.');
  if(!response.ok){
    throw await googleAccessError(response);
  }
  let body:unknown;try{body=await response.json();}catch{throw new CalendarSyncError('CALENDAR_UPSTREAM_ERROR','The calendar provider returned an unexpected response.');}
  const parsed=googleEventAccess.safeParse(body);
  if(!parsed.success)throw new CalendarSyncError('CALENDAR_UPSTREAM_ERROR','The calendar provider returned an unexpected calendar response.');
  if(!['owner','writer','writerWithoutPrivateAccess'].includes(parsed.data.accessRole))throw new CalendarSyncError('CALENDAR_PERMISSION_DENIED','The Kairos calendar is not writable with this authorization.');
}

async function googleAccessError(response:Response):Promise<CalendarSyncError>{
  let code:CalendarSyncErrorCode=response.status===401?'CALENDAR_AUTH_EXPIRED':response.status===403?'CALENDAR_PERMISSION_DENIED':response.status===429?'CALENDAR_RATE_LIMITED':'CALENDAR_UPSTREAM_ERROR';
  if(response.status===403){
    let body:unknown;try{body=await response.json();}catch{}
    const parsed=z.object({error:z.object({errors:z.array(z.object({reason:z.string()})).optional(),details:z.array(z.object({reason:z.string().optional()})).optional()})}).safeParse(body);
    const reasons=parsed.success?[...(parsed.data.error.errors??[]),...(parsed.data.error.details??[])].map(e=>e.reason):[];
    if(reasons.some(reason=>['accessNotConfigured','SERVICE_DISABLED'].includes(reason??'')))code='CALENDAR_CONFIG_MISSING';
    else if(reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded'].includes(reason??'')))code='CALENDAR_RATE_LIMITED';
  }
  return new CalendarSyncError(code,'Calendar authorization or access could not be verified.');
}

async function acceptedOAuthRemote(input:OAuthConnectInput,adapter:CalendarDestinationAdapter,existing:CalendarConnection|null){
  if(existing&&!existing.remoteCalendarId){
    throw new CalendarSyncError("CALENDAR_REMOTE_CALENDAR_MISSING","The existing Kairos calendar is missing. Choose calendar recovery before recreating it.");
  }
  // Reauthorization never implicitly recreates a missing destination or its mappings.
  const remote=existing
    ?{remoteCalendarId:existing.remoteCalendarId!,name:existing.remoteCalendarName??"Kairos"}
    :await adapter.ensureCalendar();
  await requireWritableOAuthCalendar(input,remote.remoteCalendarId);
  return remote;
}

async function acceptedCaldavRemote(client:CalDavClient,existing:CalendarConnection|null){
  const calendars=await client.discoverCalendars();
  const remote=existing
    ?calendars.find(calendar=>calendar.remoteCalendarId===existing.remoteCalendarId)
    :calendars.find(calendar=>calendar.name==="Kairos"&&calendar.writable);
  if(existing&&!remote){
    throw new CalendarSyncError("CALENDAR_REMOTE_CALENDAR_MISSING","The existing Kairos iCloud calendar is missing. Choose calendar recovery before selecting a replacement.");
  }
  if(!remote?.writable){
    throw new CalendarSyncError("CALDAV_NOT_WRITABLE","Create a writable calendar named Kairos in iCloud Calendar, then reconnect.");
  }
  return {remoteCalendarId:remote.remoteCalendarId,name:remote.name};
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
  if(!currentProviderWork(db,scope,input.provider,"credential")){
    if(input.connectionId){const existing=await new D1CalendarConnectionRepository(db,scope).getById(input.connectionId);if(!existing||existing.provider!==input.provider)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");}
    return withProviderService(db,scope,{provider:input.provider,operation:"credential",...(input.connectionId?{resourceId:input.connectionId}:{})},()=>connectOAuthHosted(db,scope,keyring,input));
  }
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
  const base=existing??{...pending(input.provider,label),id:crypto.randomUUID()};
  const credential=await credentials.prepareOAuthRefreshToken(base.id,input.provider,refreshToken);
  const client=input.provider==="google"
    ?new GoogleCalendarClient(input.accessToken,ownedFetch(input.fetchImpl??fetch))
    :new MicrosoftCalendarClient(input.accessToken,ownedFetch(input.fetchImpl??fetch));
  const adapter=input.provider==="google"
    ?new GoogleCalendarAdapter(base,client as GoogleCalendarClient)
    :new MicrosoftCalendarAdapter(base,client as MicrosoftCalendarClient);

  let remote:Awaited<ReturnType<typeof acceptedOAuthRemote>>;
  try{remote=await acceptedOAuthRemote(input,adapter,existing);}catch(error){
    if(!existing&&(!(error instanceof CalendarSyncError)||["CALENDAR_NETWORK_ERROR","CALENDAR_UPSTREAM_ERROR"].includes(error.code)))uncertainOwnedCalendarWrite();
    throw error;
  }
  const updated={...base,enabled:true,remoteCalendarId:remote.remoteCalendarId,remoteCalendarName:remote.name};
  // Provisioning cannot join this transaction; never delete remote data to compensate.
  try{await db.batch([connections.prepareAcceptedConnection(updated,new Date().toISOString()),credential]);}catch(error){
    uncertainOwnedCalendarWrite();
    throw error;
  }
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
    ?new GoogleCalendarClient(input.accessToken,ownedFetch(input.fetchImpl??fetch))
    :new MicrosoftCalendarClient(input.accessToken,ownedFetch(input.fetchImpl??fetch));
  const adapter=input.provider==="google"
    ?new GoogleCalendarAdapter(base,client as GoogleCalendarClient)
    :new MicrosoftCalendarAdapter(base,client as MicrosoftCalendarClient);

  const remote=await acceptedOAuthRemote(input,adapter,existing);
  return legacyDb.transaction(()=>{
    const connection=existing??connections.create({provider:input.provider,label});
    const updated=connections.updateRemoteCalendar(connection.id,remote.remoteCalendarId,remote.name);
    credentials.setOAuthRefreshToken(updated.id,refreshToken);
    return updated;
  })();
}

export function testCaldavCredentials(username:string,secret:string,fetchImpl?:typeof fetch):Promise<{calendarCount:number}>;
export function testCaldavCredentials(db:D1DatabaseLike,scope:UserScope,username:string,secret:string,fetchImpl?:typeof fetch):Promise<{calendarCount:number}>;
export async function testCaldavCredentials(arg1:string|D1DatabaseLike,arg2:string|UserScope,arg3?:typeof fetch|string,arg4?:string,arg5?:typeof fetch):Promise<{calendarCount:number}>{
  if(typeof arg1!=="string")return withProviderService(arg1,arg2 as UserScope,{provider:"caldav",operation:"credential"},()=>testCaldavCredentials(arg3 as string,arg4!,ownedFetch(arg5??getCalendarRouteFetch())));
  const client=new CalDavClient(arg1,arg2 as string,(arg3 as typeof fetch|undefined)??getCalendarRouteFetch());
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
  candidateEnvelope?:string|null,
):Promise<CalendarConnection>{
  if(!currentProviderWork(db,scope,"caldav","credential")){
    if(input.connectionId){const existing=await new D1CalendarConnectionRepository(db,scope).getById(input.connectionId);if(!existing||existing.provider!=="caldav")throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");}
    return withProviderService(db,scope,{provider:"caldav",operation:"credential",...(input.connectionId?{resourceId:input.connectionId}:{})},()=>connectCaldavHosted(db,scope,keyring,input,candidateEnvelope));
  }
  const connections=new D1CalendarConnectionRepository(db,scope);
  const credentials=new D1CalendarCredentialRepository(db,scope,keyring);
  const existing=input.connectionId?await connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  }
  if(existing&&existing.provider!=="caldav"){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  }

  const base=existing??{...pending("caldav","Apple iCloud Calendar"),id:crypto.randomUUID()};
  const drafts=new D1OnboardingDraftRepository(db,scope);
  const candidate=candidateEnvelope===undefined?await drafts.envelope("caldav"):candidateEnvelope;
  const credential=await credentials.prepareCaldavCredentials(base.id,input.username,input.secret);
  const client=new CalDavClient(
    input.username,input.secret,ownedFetch(input.fetchImpl??getCalendarRouteFetch()),
  );
  const remote=await acceptedCaldavRemote(client,existing);
  const updated={...base,accountLabel:input.username,remoteCalendarId:remote.remoteCalendarId,remoteCalendarName:remote.name};
  await db.batch([connections.prepareAcceptedConnection(updated,new Date().toISOString()),credential,drafts.prepareAcceptedCleanup("caldav",candidate)]);
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
  candidateEnvelope?:string|null,
):Promise<CalendarConnection>;
export async function connectCaldavCalendar(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:CaldavConnectInput|UserScope,
  arg3?:CredentialKeyring,
  arg4?:CaldavConnectInput,
  candidateEnvelope?:string|null,
):Promise<CalendarConnection>{
  if("userId" in arg2){
    return connectCaldavHosted(db as D1DatabaseLike,arg2,arg3!,arg4!,candidateEnvelope);
  }

  const input=arg2;
  const legacyDb=db as LegacyDatabase;
  const connections=new CalendarConnectionRepository(legacyDb);
  const credentials=new CalendarCredentialRepository(legacyDb);
  const existing=input.connectionId?connections.getById(input.connectionId):null;
  if(input.connectionId&&!existing)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
  if(existing&&existing.provider!=="caldav")throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar provider does not match the connection.");
  const client=new CalDavClient(input.username,input.secret,ownedFetch(input.fetchImpl??getCalendarRouteFetch()));
  const remote=await acceptedCaldavRemote(client,existing);
  return legacyDb.transaction(()=>{
    const connection=existing??connections.create({
      provider:"caldav",label:"Apple iCloud Calendar",accountLabel:input.username,
    });
    const updated=connections.updateRemoteCalendar(connection.id,remote.remoteCalendarId,remote.name);
    credentials.setCaldavCredentials(updated.id,input.username,input.secret);
    return updated;
  })();
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
  if(!currentProviderWork(db,scope,connection.provider,"manual-sync",connection.id))return withProviderService(db,scope,{provider:connection.provider,operation:"manual-sync",resourceId:connection.id},()=>removeHosted(db,scope,keyring,connectionId,options));
  if(!connection.remoteCalendarId)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection has no Kairos calendar.");

  const links=new D1CalendarEventLinkRepository(db,scope);
  const rows=await links.listByConnection(connection.id);
  if(rows.length===0)return {deletedCount:0,failedCount:0};
  const factory=options.adapterFactory
    ??createCalendarAdapterFactory(db,scope,keyring,options);
  const adapter=guardCalendarAdapter(await factory(connection));
  await adapter.testConnection();

  let deletedCount=0;
  let failedCount=0;
  for(const link of rows){
    if(ownedWorkStopped())break;
    if(!link.remoteEventId){failedCount++;continue;}
    try{
      await adapter.deleteEvent(connection.remoteCalendarId,link.remoteEventId);
      await links.delete(link.id);
      deletedCount++;
    }catch(error){
      if(error instanceof CalendarSyncError&&error.code==="CALENDAR_RATE_LIMITED")throttleOwnedWork();
      else if(!(error instanceof CalendarSyncError)||["CALENDAR_NETWORK_ERROR","CALENDAR_UPSTREAM_ERROR"].includes(error.code))uncertainOwnedWork();
      failedCount++;
    }
  }
  if(ownedWorkStopped())failedCount=rows.length-deletedCount;
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
  const adapter=guardCalendarAdapter(await factory(connection));
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
