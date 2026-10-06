import "server-only";
import type Database from "better-sqlite3";
import {AssignmentRepository} from "@/lib/db/repositories/assignments";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarEventLinkRepository} from "@/lib/db/repositories/calendar-event-links";
import type {CalendarSyncStatus} from "@/lib/calendar/types";
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

export async function reconcileCalendarConnection(
  db:Database.Database,
  connectionId:string,
  options:ReconcileOptions,
):Promise<CalendarSyncResult>{
  const now=options.now??new Date();
  const completedAt=now.toISOString();
  const connections=new CalendarConnectionRepository(db);
  const connection=connections.getById(connectionId);
  if(!connection)throw new Error("Calendar connection not found.");

  connections.markSyncStarted(connection.id,completedAt);

  if(!connection.remoteCalendarId){
    const result=emptyResult(connection.id,completedAt,"error","CALENDAR_CONFIG_MISSING");
    connections.markSyncResult(connection.id,{completedAt,status:"error",errorCode:result.errorCode});
    return result;
  }

  let adapter:Awaited<ReturnType<CalendarAdapterFactory>>;
  try{
    adapter=await options.adapterFactory(connection);
    await adapter.testConnection();
  }catch(error){
    const code=errorCode(error);
    const result=emptyResult(connection.id,completedAt,"error",code);
    connections.markSyncResult(connection.id,{completedAt,status:"error",errorCode:code});
    return result;
  }

  const assignments=new AssignmentRepository(db).list();
  const links=new CalendarEventLinkRepository(db);
  let cursor=0;
  const outcomes:Array<Outcome|undefined>=new Array(assignments.length);

  const reconcileOne=async(index:number):Promise<Outcome>=>{
    const assignment=assignments[index]!;
    const projection=projectAssignment(assignment);
    let link=links.get(connection.id,assignment.id);

    if(!projection){
      if(!link)return {kind:"skipped"};
      if(!link.remoteEventId){
        const code:CalendarSyncErrorCode="CALENDAR_EVENT_INVALID";
        links.markError(link.id,code,completedAt);
        return {kind:"failed",errorCode:code};
      }
      try{
        await adapter.deleteEvent(connection.remoteCalendarId!,link.remoteEventId);
        links.delete(link.id);
        return {kind:"deleted"};
      }catch(error){
        const code=errorCode(error);
        links.markError(link.id,code,completedAt);
        return {kind:"failed",errorCode:code};
      }
    }

    if(!link){
      link=links.ensure(
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
            const adopted=await adapter.updateEvent(
              connection.remoteCalendarId!,
              existing.remoteEventId,
              projection,
              existing.etag,
            );
            links.markSynced(link.id,adopted.remoteEventId,adopted.etag,hash,completedAt);
            return {kind:"updated"};
          }
        }
        const created=await adapter.createEvent(connection.remoteCalendarId!,projection,link.syncKey);
        links.markSynced(link.id,created.remoteEventId,created.etag,hash,completedAt);
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
            links.markSynced(link.id,adopted.remoteEventId,adopted.etag,hash,completedAt);
            return {kind:"updated"};
          }
        }
        const created=await adapter.createEvent(connection.remoteCalendarId!,projection,link.syncKey);
        links.markSynced(link.id,created.remoteEventId,created.etag,hash,completedAt);
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
      links.markSynced(link.id,updated.remoteEventId,updated.etag,hash,completedAt);
      return {kind:"updated"};
    }catch(error){
      const code=errorCode(error);
      links.markError(link.id,code,completedAt);
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

  const workerCount=Math.min(clampConcurrency(options.concurrency),Math.max(assignments.length,1));
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
    failedCount===0?null:status==="partial"?"CALENDAR_PARTIAL_SYNC":failures[0]??"CALENDAR_UPSTREAM_ERROR";

  connections.markSyncResult(connection.id,{
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

export async function reconcileAllCalendars(
  db:Database.Database,
  options:ReconcileOptions,
):Promise<CalendarSyncAllResult>{
  const connections=new CalendarConnectionRepository(db).list().filter(item=>item.enabled);
  const results:CalendarSyncResult[]=[];
  for(const connection of connections){
    results.push(await reconcileCalendarConnection(db,connection.id,options));
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
