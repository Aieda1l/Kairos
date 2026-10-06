import "server-only";
import type Database from "better-sqlite3";
import type {UserScope} from "@/lib/auth/user-scope";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {AssignmentRepository} from "@/lib/db/repositories/assignments";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarEventLinkRepository} from "@/lib/db/repositories/calendar-event-links";
import {SettingsRepository} from "@/lib/db/repositories/settings";
import type {Assignment} from "@/lib/assignments/types";
import type {CalendarConnection,CalendarEventLink,CalendarSyncStatus} from "@/lib/calendar/types";
import type {CalendarAdapterFactory} from "@/lib/calendar/adapter";
import {CalendarSyncError,type CalendarSyncErrorCode} from "@/lib/calendar/errors";
import {createCalendarSyncKey} from "@/lib/calendar/sync-key";
import {hashCalendarProjection,projectAssignment} from "@/lib/calendar/projection";

type CompletedCalendarSyncStatus=Exclude<CalendarSyncStatus,"never">;

export type CalendarSyncResult={
  connectionId:string;
  status:CompletedCalendarSyncStatus;
  createdCount:number;
  updatedCount:number;
  deletedCount:number;
  unchangedCount:number;
  failedCount:number;
  completedAt:string;
  errorCode:CalendarSyncErrorCode|null;
};

export type CalendarSyncAllResult={
  status:CompletedCalendarSyncStatus;
  results:CalendarSyncResult[];
};

type ReconcileOptions={
  adapterFactory:CalendarAdapterFactory;
  now?:Date;
  concurrency?:number;
};

type Outcome=
  |{kind:"created"|"updated"|"deleted"|"unchanged"}
  |{kind:"skipped"}
  |{kind:"failed";errorCode:CalendarSyncErrorCode};

type CalendarRepositories={
  connections:{
    list():Promise<CalendarConnection[]>;
    getById(id:string):Promise<CalendarConnection|null>;
    markSyncStarted(id:string,at:string):Promise<void>;
    markSyncResult(id:string,input:{
      completedAt:string;
      status:Exclude<CalendarSyncStatus,"never">;
      errorCode:string|null;
    }):Promise<void>;
  };
  assignments:{list():Promise<Assignment[]>};
  settings:{getCalendarHideSubmitted():Promise<boolean>};
  links:{
    get(connectionId:string,assignmentId:string):Promise<CalendarEventLink|null>;
    ensure(connectionId:string,assignmentId:string,syncKey:string,now?:Date):Promise<CalendarEventLink>;
    markSynced(id:string,remoteEventId:string,remoteEtag:string|null,contentHash:string,syncedAt:string):Promise<void>;
    markError(id:string,errorCode:string,at:string):Promise<void>;
    delete(id:string):Promise<void>;
  };
};

function legacyRepositories(db:Database.Database):CalendarRepositories{
  const connections=new CalendarConnectionRepository(db);
  const assignments=new AssignmentRepository(db);
  const settings=new SettingsRepository(db);
  const links=new CalendarEventLinkRepository(db);
  return {
    connections:{
      list:async()=>connections.list(),
      getById:async id=>connections.getById(id),
      markSyncStarted:async(id,at)=>{connections.markSyncStarted(id,at);},
      markSyncResult:async(id,input)=>{connections.markSyncResult(id,input);},
    },
    assignments:{list:async()=>assignments.list()},
    settings:{getCalendarHideSubmitted:async()=>settings.getCalendarHideSubmitted()},
    links:{
      get:async(connectionId,assignmentId)=>links.get(connectionId,assignmentId),
      ensure:async(connectionId,assignmentId,syncKey,now)=>links.ensure(connectionId,assignmentId,syncKey,now),
      markSynced:async(id,remoteEventId,remoteEtag,contentHash,syncedAt)=>{
        links.markSynced(id,remoteEventId,remoteEtag,contentHash,syncedAt);
      },
      markError:async(id,errorCode,at)=>{links.markError(id,errorCode,at);},
      delete:async id=>{links.delete(id);},
    },
  };
}

function hostedRepositories(db:D1DatabaseLike,scope:UserScope):CalendarRepositories{
  const connections=new D1CalendarConnectionRepository(db,scope);
  const assignments=new D1AssignmentRepository(db,scope);
  const settings=new D1SettingsRepository(db,scope);
  const links=new D1CalendarEventLinkRepository(db,scope);
  return {
    connections:{
      list:()=>connections.list(),
      getById:id=>connections.getById(id),
      markSyncStarted:(id,at)=>connections.markSyncStarted(id,at),
      markSyncResult:(id,input)=>connections.markSyncResult(id,input),
    },
    assignments:{list:()=>assignments.list()},
    settings:{getCalendarHideSubmitted:()=>settings.getCalendarHideSubmitted()},
    links:{
      get:(connectionId,assignmentId)=>links.get(connectionId,assignmentId),
      ensure:(connectionId,assignmentId,syncKey,now)=>links.ensure(connectionId,assignmentId,syncKey,now),
      markSynced:(id,remoteEventId,remoteEtag,contentHash,syncedAt)=>
        links.markSynced(id,remoteEventId,remoteEtag,contentHash,syncedAt),
      markError:(id,errorCode,at)=>links.markError(id,errorCode,at),
      delete:id=>links.delete(id),
    },
  };
}

function errorCode(error:unknown):CalendarSyncErrorCode{
  return error instanceof CalendarSyncError?error.code:"CALENDAR_UPSTREAM_ERROR";
}

function emptyResult(
  connectionId:string,
  completedAt:string,
  status:CompletedCalendarSyncStatus,
  code:CalendarSyncErrorCode|null,
):CalendarSyncResult{
  return {
    connectionId,
    status,
    createdCount:0,
    updatedCount:0,
    deletedCount:0,
    unchangedCount:0,
    failedCount:0,
    completedAt,
    errorCode:code,
  };
}

function clampConcurrency(value:number|undefined):number{
  if(value===undefined||!Number.isFinite(value))return 4;
  return Math.max(1,Math.min(4,Math.floor(value)));
}

async function reconcileWithRepositories(
  repositories:CalendarRepositories,
  connectionId:string,
  options:ReconcileOptions,
):Promise<CalendarSyncResult>{
  const now=options.now??new Date();
  const completedAt=now.toISOString();
  const connection=await repositories.connections.getById(connectionId);
  if(!connection)throw new Error("Calendar connection not found.");

  await repositories.connections.markSyncStarted(connection.id,completedAt);

  if(!connection.remoteCalendarId){
    const result=emptyResult(connection.id,completedAt,"error","CALENDAR_CONFIG_MISSING");
    await repositories.connections.markSyncResult(connection.id,{
      completedAt,
      status:"error",
      errorCode:result.errorCode,
    });
    return result;
  }

  let adapter:Awaited<ReturnType<CalendarAdapterFactory>>;
  try{
    adapter=await options.adapterFactory(connection);
    await adapter.testConnection();
  }catch(error){
    const code=errorCode(error);
    const result=emptyResult(connection.id,completedAt,"error",code);
    await repositories.connections.markSyncResult(connection.id,{
      completedAt,
      status:"error",
      errorCode:code,
    });
    return result;
  }

  const assignments=await repositories.assignments.list();
  const hideSubmitted=await repositories.settings.getCalendarHideSubmitted();
  let cursor=0;
  const outcomes:Array<Outcome|undefined>=new Array(assignments.length);

  const reconcileOne=async(index:number):Promise<Outcome>=>{
    const assignment=assignments[index]!;
    const projection=projectAssignment(assignment,{hideSubmitted});
    let link=await repositories.links.get(connection.id,assignment.id);

    if(!projection){
      if(!link)return {kind:"skipped"};
      if(!link.remoteEventId){
        const code:CalendarSyncErrorCode="CALENDAR_EVENT_INVALID";
        await repositories.links.markError(link.id,code,completedAt);
        return {kind:"failed",errorCode:code};
      }
      try{
        await adapter.deleteEvent(connection.remoteCalendarId!,link.remoteEventId);
        await repositories.links.delete(link.id);
        return {kind:"deleted"};
      }catch(error){
        const code=errorCode(error);
        await repositories.links.markError(link.id,code,completedAt);
        return {kind:"failed",errorCode:code};
      }
    }

    if(!link){
      link=await repositories.links.ensure(
        connection.id,
        assignment.id,
        createCalendarSyncKey(connection.id,assignment.id),
        now,
      );
    }

    const hash=hashCalendarProjection(projection);
    try{
      if(!link.remoteEventId){
        if(adapter.findEventByAssignment){
          const existing=await adapter.findEventByAssignment(
            connection.remoteCalendarId!,
            projection.assignmentId,
          );
          if(existing){
            const recoveredCreate=Boolean(link.lastErrorCode);
            const adopted=await adapter.updateEvent(
              connection.remoteCalendarId!,
              existing.remoteEventId,
              projection,
              existing.etag,
            );
            await repositories.links.markSynced(
              link.id,adopted.remoteEventId,adopted.etag,hash,completedAt,
            );
            return {kind:recoveredCreate?"created":"updated"};
          }
        }
        const created=await adapter.createEvent(
          connection.remoteCalendarId!,
          projection,
          link.syncKey,
        );
        await repositories.links.markSynced(
          link.id,created.remoteEventId,created.etag,hash,completedAt,
        );
        return {kind:"created"};
      }

      const remote=await adapter.getEvent(connection.remoteCalendarId!,link.remoteEventId);
      if(!remote){
        if(adapter.findEventByAssignment){
          const existing=await adapter.findEventByAssignment(
            connection.remoteCalendarId!,
            projection.assignmentId,
          );
          if(existing){
            const adopted=await adapter.updateEvent(
              connection.remoteCalendarId!,
              existing.remoteEventId,
              projection,
              existing.etag,
            );
            await repositories.links.markSynced(
              link.id,adopted.remoteEventId,adopted.etag,hash,completedAt,
            );
            return {kind:"updated"};
          }
        }
        const created=await adapter.createEvent(
          connection.remoteCalendarId!,
          projection,
          link.syncKey,
        );
        await repositories.links.markSynced(
          link.id,created.remoteEventId,created.etag,hash,completedAt,
        );
        return {kind:"created"};
      }

      const needsManagedIdentity=
        Boolean(adapter.findEventByAssignment)
        &&remote.managedAssignmentId!==projection.assignmentId;

      if(link.contentHash===hash&&!needsManagedIdentity){
        return {kind:"unchanged"};
      }

      const updated=await adapter.updateEvent(
        connection.remoteCalendarId!,
        link.remoteEventId,
        projection,
        remote.etag,
      );
      await repositories.links.markSynced(
        link.id,updated.remoteEventId,updated.etag,hash,completedAt,
      );
      return {kind:"updated"};
    }catch(error){
      const code=errorCode(error);
      await repositories.links.markError(link.id,code,completedAt);
      return {kind:"failed",errorCode:code};
    }
  };

  const worker=async()=>{
    while(true){
      const index=cursor++;
      if(index>=assignments.length)return;
      outcomes[index]=await reconcileOne(index);
    }
  };

  const workerCount=Math.min(
    clampConcurrency(options.concurrency),
    Math.max(assignments.length,1),
  );
  await Promise.all(Array.from({length:workerCount},()=>worker()));

  let createdCount=0;
  let updatedCount=0;
  let deletedCount=0;
  let unchangedCount=0;
  let failedCount=0;
  const failures:CalendarSyncErrorCode[]=[];

  for(const outcome of outcomes){
    if(!outcome||outcome.kind==="skipped")continue;
    switch(outcome.kind){
      case "created":createdCount++;break;
      case "updated":updatedCount++;break;
      case "deleted":deletedCount++;break;
      case "unchanged":unchangedCount++;break;
      case "failed":
        failedCount++;
        failures.push(outcome.errorCode);
        break;
    }
  }

  const successfulCount=createdCount+updatedCount+deletedCount+unchangedCount;
  const status:CompletedCalendarSyncStatus=
    failedCount===0?"success":successfulCount>0?"partial":"error";
  const resultError:CalendarSyncErrorCode|null=
    failedCount===0
      ?null
      :status==="partial"
        ?"CALENDAR_PARTIAL_SYNC"
        :failures[0]??"CALENDAR_UPSTREAM_ERROR";

  await repositories.connections.markSyncResult(connection.id,{
    completedAt,
    status,
    errorCode:resultError,
  });

  return {
    connectionId:connection.id,
    status,
    createdCount,
    updatedCount,
    deletedCount,
    unchangedCount,
    failedCount,
    completedAt,
    errorCode:resultError,
  };
}

export function reconcileCalendarConnection(
  db:Database.Database,
  connectionId:string,
  options:ReconcileOptions,
):Promise<CalendarSyncResult>;
export function reconcileCalendarConnection(
  db:D1DatabaseLike,
  scope:UserScope,
  connectionId:string,
  options:ReconcileOptions,
):Promise<CalendarSyncResult>;
export function reconcileCalendarConnection(
  db:Database.Database|D1DatabaseLike,
  arg2:string|UserScope,
  arg3:string|ReconcileOptions,
  arg4?:ReconcileOptions,
):Promise<CalendarSyncResult>{
  if(typeof arg2==="string"){
    return reconcileWithRepositories(
      legacyRepositories(db as Database.Database),
      arg2,
      arg3 as ReconcileOptions,
    );
  }
  return reconcileWithRepositories(
    hostedRepositories(db as D1DatabaseLike,arg2),
    arg3 as string,
    arg4!,
  );
}

async function reconcileAllWithRepositories(
  repositories:CalendarRepositories,
  runOne:(connectionId:string)=>Promise<CalendarSyncResult>,
):Promise<CalendarSyncAllResult>{
  const connections=(await repositories.connections.list()).filter(item=>item.enabled);
  const results:CalendarSyncResult[]=[];
  for(const connection of connections){
    results.push(await runOne(connection.id));
  }
  const statuses=results.map(result=>result.status);
  const status:CompletedCalendarSyncStatus=
    statuses.length===0||statuses.every(value=>value==="success")
      ?"success"
      :statuses.every(value=>value==="error")
        ?"error"
        :"partial";
  return {status,results};
}

export function reconcileAllCalendars(
  db:Database.Database,
  options:ReconcileOptions,
):Promise<CalendarSyncAllResult>;
export function reconcileAllCalendars(
  db:D1DatabaseLike,
  scope:UserScope,
  options:ReconcileOptions,
):Promise<CalendarSyncAllResult>;
export function reconcileAllCalendars(
  db:Database.Database|D1DatabaseLike,
  arg2:ReconcileOptions|UserScope,
  arg3?:ReconcileOptions,
):Promise<CalendarSyncAllResult>{
  if("adapterFactory" in arg2){
    const options=arg2;
    const repositories=legacyRepositories(db as Database.Database);
    return reconcileAllWithRepositories(
      repositories,
      id=>reconcileWithRepositories(repositories,id,options),
    );
  }
  const scope=arg2;
  const options=arg3!;
  const repositories=hostedRepositories(db as D1DatabaseLike,scope);
  return reconcileAllWithRepositories(
    repositories,
    id=>reconcileWithRepositories(repositories,id,options),
  );
}
