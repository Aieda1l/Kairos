import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarConnection,CalendarProvider,CalendarSyncStatus} from "@/lib/calendar/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

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

export class D1CalendarConnectionRepository{
  private readonly select=`
    SELECT id,provider,label,account_label,remote_calendar_id,remote_calendar_name,enabled,
      last_sync_started_at,last_sync_completed_at,last_sync_status,last_error_code
    FROM calendar_connections
  `;

  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async list():Promise<CalendarConnection[]>{
    const result=await this.db.prepare(`
      ${this.select} WHERE user_id=? ORDER BY created_at ASC,id ASC
    `).bind(this.scope.userId).all<Row>();
    return result.results.map(map);
  }

  async getById(id:string):Promise<CalendarConnection|null>{
    const row=await this.db.prepare(`${this.select} WHERE user_id=? AND id=?`)
      .bind(this.scope.userId,id).first<Row>();
    return row?map(row):null;
  }

  async create(input:{
    provider:CalendarProvider;
    label:string;
    accountLabel?:string|null;
    enabled?:boolean;
  },now:Date=new Date()):Promise<CalendarConnection>{
    const id=crypto.randomUUID();
    const at=now.toISOString();
    await this.db.prepare(`
      INSERT INTO calendar_connections(
        user_id,id,provider,label,account_label,enabled,last_sync_status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      this.scope.userId,id,input.provider,input.label,input.accountLabel??null,
      input.enabled===false?0:1,"never",at,at,
    ).run();
    return (await this.getById(id))!;
  }

  async updateRemoteCalendar(
    id:string,
    remoteCalendarId:string,
    remoteCalendarName:string,
    now:Date=new Date(),
  ):Promise<CalendarConnection>{
    await this.db.prepare(`
      UPDATE calendar_connections
      SET remote_calendar_id=?,remote_calendar_name=?,updated_at=?
      WHERE user_id=? AND id=?
    `).bind(
      remoteCalendarId,remoteCalendarName,now.toISOString(),this.scope.userId,id,
    ).run();
    const updated=await this.getById(id);
    if(!updated)throw new Error("Calendar connection not found.");
    return updated;
  }

  async markSyncStarted(id:string,at:string):Promise<void>{
    await this.db.prepare(`
      UPDATE calendar_connections SET last_sync_started_at=?,updated_at=?
      WHERE user_id=? AND id=?
    `).bind(at,at,this.scope.userId,id).run();
  }

  async markSyncResult(id:string,input:{
    completedAt:string;
    status:Exclude<CalendarSyncStatus,"never">;
    errorCode:string|null;
  }):Promise<void>{
    await this.db.prepare(`
      UPDATE calendar_connections SET
        last_sync_completed_at=CASE WHEN ? IN ('success','partial') THEN ? ELSE last_sync_completed_at END,
        last_sync_status=?,
        last_error_code=?,
        updated_at=?
      WHERE user_id=? AND id=?
    `).bind(
      input.status,input.completedAt,input.status,input.errorCode,input.completedAt,
      this.scope.userId,id,
    ).run();
  }

  async delete(id:string):Promise<void>{
    await this.db.prepare(
      "DELETE FROM calendar_connections WHERE user_id=? AND id=?",
    ).bind(this.scope.userId,id).run();
  }
}
