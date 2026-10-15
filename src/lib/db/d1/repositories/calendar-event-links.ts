import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarEventLink} from "@/lib/calendar/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

type Row={
  id:string;
  calendar_connection_id:string;
  assignment_id:string;
  sync_key:string;
  remote_event_id:string|null;
  remote_etag:string|null;
  content_hash:string|null;
  last_synced_at:string|null;
  last_error_code:string|null;
};

const map=(row:Row):CalendarEventLink=>({
  id:row.id,
  calendarConnectionId:row.calendar_connection_id,
  assignmentId:row.assignment_id,
  syncKey:row.sync_key,
  remoteEventId:row.remote_event_id,
  remoteEtag:row.remote_etag,
  contentHash:row.content_hash,
  lastSyncedAt:row.last_synced_at,
  lastErrorCode:row.last_error_code,
});

export class D1CalendarEventLinkRepository{
  private readonly select=`
    SELECT id,calendar_connection_id,assignment_id,sync_key,remote_event_id,remote_etag,
      content_hash,last_synced_at,last_error_code
    FROM calendar_event_links
  `;

  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async get(connectionId:string,assignmentId:string):Promise<CalendarEventLink|null>{
    const row=await this.db.prepare(`
      ${this.select}
      WHERE user_id=? AND calendar_connection_id=? AND assignment_id=?
    `).bind(this.scope.userId,connectionId,assignmentId).first<Row>();
    return row?map(row):null;
  }

  async listByConnection(connectionId:string):Promise<CalendarEventLink[]>{
    const result=await this.db.prepare(`
      ${this.select}
      WHERE user_id=? AND calendar_connection_id=?
      ORDER BY created_at ASC,id ASC
    `).bind(this.scope.userId,connectionId).all<Row>();
    return result.results.map(map);
  }

  async ensure(
    connectionId:string,
    assignmentId:string,
    syncKey:string,
    now:Date=new Date(),
  ):Promise<CalendarEventLink>{
    const existing=await this.get(connectionId,assignmentId);
    if(existing)return existing;

    const id=crypto.randomUUID();
    const at=now.toISOString();
    await this.db.prepare(`
      INSERT INTO calendar_event_links(
        user_id,id,calendar_connection_id,assignment_id,sync_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,calendar_connection_id,assignment_id) DO NOTHING
    `).bind(
      this.scope.userId,id,connectionId,assignmentId,syncKey,at,at,
    ).run();

    const created=await this.get(connectionId,assignmentId);
    if(!created)throw new Error("Calendar event link could not be created.");
    return created;
  }

  async markSynced(
    id:string,
    remoteEventId:string,
    remoteEtag:string|null,
    contentHash:string,
    syncedAt:string,
  ):Promise<void>{
    await this.db.prepare(`
      UPDATE calendar_event_links SET
        remote_event_id=?,remote_etag=?,content_hash=?,last_synced_at=?,
        last_error_code=NULL,updated_at=?
      WHERE user_id=? AND id=?
    `).bind(
      remoteEventId,remoteEtag,contentHash,syncedAt,syncedAt,this.scope.userId,id,
    ).run();
  }

  async markError(id:string,errorCode:string,at:string):Promise<void>{
    await this.db.prepare(`
      UPDATE calendar_event_links SET last_error_code=?,updated_at=?
      WHERE user_id=? AND id=?
    `).bind(errorCode,at,this.scope.userId,id).run();
  }

  async delete(id:string):Promise<void>{
    await this.db.prepare(
      "DELETE FROM calendar_event_links WHERE user_id=? AND id=?",
    ).bind(this.scope.userId,id).run();
  }
}
