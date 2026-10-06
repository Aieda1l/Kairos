import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {CalendarConnection,CalendarProvider,CalendarSyncStatus} from "@/lib/calendar/types";

type Row={
  id:string;
  provider:CalendarProvider;
  label:string;
  account_label:string|null;
  remote_calendar_id:string|null;
  remote_calendar_name:string|null;
  enabled:number;
  last_sync_started_at:string|null;
  last_sync_completed_at:string|null;
  last_sync_status:CalendarSyncStatus;
  last_error_code:string|null;
};

const map=(row:Row):CalendarConnection=>({
  id:row.id,
  provider:row.provider,
  label:row.label,
  accountLabel:row.account_label,
  remoteCalendarId:row.remote_calendar_id,
  remoteCalendarName:row.remote_calendar_name,
  enabled:Boolean(row.enabled),
  lastSyncStartedAt:row.last_sync_started_at,
  lastSyncCompletedAt:row.last_sync_completed_at,
  lastSyncStatus:row.last_sync_status,
  lastErrorCode:row.last_error_code,
});

export class CalendarConnectionRepository{
  constructor(private readonly db:Database.Database){}
  private readonly select="SELECT id,provider,label,account_label,remote_calendar_id,remote_calendar_name,enabled,last_sync_started_at,last_sync_completed_at,last_sync_status,last_error_code FROM calendar_connections";

  list():CalendarConnection[]{
    return (this.db.prepare(`${this.select} ORDER BY created_at ASC,id ASC`).all() as Row[]).map(map);
  }

  getById(id:string):CalendarConnection|null{
    const row=this.db.prepare(`${this.select} WHERE id=?`).get(id) as Row|undefined;
    return row?map(row):null;
  }

  create(input:{
    provider:CalendarProvider;
    label:string;
    accountLabel?:string|null;
    enabled?:boolean;
  },now:Date=new Date()):CalendarConnection{
    const id=crypto.randomUUID();
    const at=now.toISOString();
    this.db.prepare(`INSERT INTO calendar_connections(
      id,provider,label,account_label,enabled,last_sync_status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`).run(
      id,input.provider,input.label,input.accountLabel??null,input.enabled===false?0:1,"never",at,at,
    );
    return this.getById(id)!;
  }

  updateRemoteCalendar(id:string,remoteCalendarId:string,remoteCalendarName:string,now:Date=new Date()):CalendarConnection{
    this.db.prepare("UPDATE calendar_connections SET remote_calendar_id=?,remote_calendar_name=?,updated_at=? WHERE id=?")
      .run(remoteCalendarId,remoteCalendarName,now.toISOString(),id);
    const updated=this.getById(id);
    if(!updated)throw new Error("Calendar connection not found.");
    return updated;
  }

  markSyncStarted(id:string,at:string):void{
    this.db.prepare("UPDATE calendar_connections SET last_sync_started_at=?,updated_at=? WHERE id=?").run(at,at,id);
  }

  markSyncResult(id:string,input:{completedAt:string;status:Exclude<CalendarSyncStatus,"never">;errorCode:string|null}):void{
    this.db.prepare(`UPDATE calendar_connections SET
      last_sync_completed_at=CASE WHEN ? IN ('success','partial') THEN ? ELSE last_sync_completed_at END,
      last_sync_status=?,
      last_error_code=?,
      updated_at=?
      WHERE id=?`).run(input.status,input.completedAt,input.status,input.errorCode,input.completedAt,id);
  }

  delete(id:string):void{
    this.db.prepare("DELETE FROM calendar_connections WHERE id=?").run(id);
  }
}
