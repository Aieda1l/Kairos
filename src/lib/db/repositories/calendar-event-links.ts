import "server-only";
import crypto from "node:crypto";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {CalendarEventLink} from "@/lib/calendar/types";

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

export class CalendarEventLinkRepository{
  constructor(private readonly db:LegacyDatabase){}
  private readonly select="SELECT id,calendar_connection_id,assignment_id,sync_key,remote_event_id,remote_etag,content_hash,last_synced_at,last_error_code FROM calendar_event_links";

  get(connectionId:string,assignmentId:string):CalendarEventLink|null{
    const row=this.db.prepare(`${this.select} WHERE calendar_connection_id=? AND assignment_id=?`)
      .get(connectionId,assignmentId) as Row|undefined;
    return row?map(row):null;
  }

  listByConnection(connectionId:string):CalendarEventLink[]{
    return (this.db.prepare(`${this.select} WHERE calendar_connection_id=? ORDER BY created_at ASC,id ASC`)
      .all(connectionId) as Row[]).map(map);
  }

  ensure(connectionId:string,assignmentId:string,syncKey:string,now:Date=new Date()):CalendarEventLink{
    const existing=this.get(connectionId,assignmentId);
    if(existing)return existing;
    const id=crypto.randomUUID();
    const at=now.toISOString();
    this.db.prepare(`INSERT INTO calendar_event_links(
      id,calendar_connection_id,assignment_id,sync_key,created_at,updated_at
    ) VALUES (?,?,?,?,?,?)
    ON CONFLICT(calendar_connection_id,assignment_id) DO NOTHING`)
      .run(id,connectionId,assignmentId,syncKey,at,at);
    return this.get(connectionId,assignmentId)!;
  }

  markSynced(id:string,remoteEventId:string,remoteEtag:string|null,contentHash:string,syncedAt:string):void{
    this.db.prepare(`UPDATE calendar_event_links SET
      remote_event_id=?,remote_etag=?,content_hash=?,last_synced_at=?,last_error_code=NULL,updated_at=?
      WHERE id=?`).run(remoteEventId,remoteEtag,contentHash,syncedAt,syncedAt,id);
  }

  markError(id:string,errorCode:string,at:string):void{
    this.db.prepare("UPDATE calendar_event_links SET last_error_code=?,updated_at=? WHERE id=?").run(errorCode,at,id);
  }

  delete(id:string):void{
    this.db.prepare("DELETE FROM calendar_event_links WHERE id=?").run(id);
  }
}
