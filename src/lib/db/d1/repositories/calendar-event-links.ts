import {prepareOwned} from "@/lib/db/d1/owned-mutation";
import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarEventLink,CalendarLinkSyncWrite} from "@/lib/calendar/types";
import type {D1DatabaseLike,D1Read} from "@/lib/db/d1/types";

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
    const row=await prepareOwned(this.db,this.scope,`
      ${this.select}
      WHERE user_id=? AND calendar_connection_id=? AND assignment_id=?
    `).bind(this.scope.userId,connectionId,assignmentId).first<Row>();
    return row?map(row):null;
  }

  async listByConnection(connectionId:string):Promise<CalendarEventLink[]>{
    const prepared=this.prepareListByConnection(connectionId);
    return prepared.read(await prepared.statement.all());
  }

  prepareListByConnection(connectionId:string):D1Read<CalendarEventLink[]>{
    return {statement:prepareOwned(this.db,this.scope,`
      ${this.select}
      WHERE user_id=? AND calendar_connection_id=?
      ORDER BY created_at ASC,id ASC
    `).bind(this.scope.userId,connectionId),read:result=>(result.results as Row[]).map(map)};
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
    await prepareOwned(this.db,this.scope,`
      INSERT INTO calendar_event_links(
        user_id,id,calendar_connection_id,assignment_id,sync_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,calendar_connection_id,assignment_id) DO NOTHING
    `,{kind:"calendar",id:connectionId}).bind(
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
    await prepareOwned(this.db,this.scope,`
      UPDATE calendar_event_links SET
        remote_event_id=?,remote_etag=?,content_hash=?,last_synced_at=?,
        last_error_code=NULL,updated_at=?
      WHERE user_id=? AND id=?
    `,{kind:"calendar-link",id}).bind(
      remoteEventId,remoteEtag,contentHash,syncedAt,syncedAt,this.scope.userId,id,
    ).run();
  }

  async markExistingSyncedMany(connectionId:string,writes:CalendarLinkSyncWrite[]):Promise<number>{
    const json=JSON.stringify(writes);
    if(!writes.length||writes.length>100||new Set(writes.map(w=>w.id)).size!==writes.length||new TextEncoder().encode(json).byteLength>1_000_000)throw new Error('Invalid calendar completion batch.');
    const result=await prepareOwned(this.db,this.scope,`
      INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,remote_etag,content_hash,last_synced_at,last_error_code,created_at,updated_at)
      SELECT link.user_id,link.id,link.calendar_connection_id,link.assignment_id,link.sync_key,
        json_extract(item.value,'$.remoteEventId'),json_extract(item.value,'$.remoteEtag'),json_extract(item.value,'$.contentHash'),
        json_extract(item.value,'$.syncedAt'),NULL,link.created_at,json_extract(item.value,'$.syncedAt')
      FROM calendar_event_links link JOIN json_each(?) item ON link.id=json_extract(item.value,'$.id')
      WHERE link.user_id=? AND link.calendar_connection_id=?
      ON CONFLICT(user_id,id) DO UPDATE SET remote_event_id=excluded.remote_event_id,remote_etag=excluded.remote_etag,
        content_hash=excluded.content_hash,last_synced_at=excluded.last_synced_at,last_error_code=NULL,updated_at=excluded.updated_at
    `,{kind:'calendar',id:connectionId}).bind(json,this.scope.userId,connectionId).run();
    const changed=Number(result.meta.changes);
    if(!result.success||!Number.isSafeInteger(changed)||changed<0||changed>writes.length)throw new Error('Calendar completion failed.');
    return changed;
  }

  async markError(id:string,errorCode:string,at:string):Promise<void>{
    await prepareOwned(this.db,this.scope,`
      UPDATE calendar_event_links SET last_error_code=?,updated_at=?
      WHERE user_id=? AND id=?
    `,{kind:"calendar-link",id}).bind(errorCode,at,this.scope.userId,id).run();
  }

  async delete(id:string):Promise<void>{
    await prepareOwned(this.db,this.scope,
      "DELETE FROM calendar_event_links WHERE user_id=? AND id=?",
    {kind:"calendar-link",id}).bind(this.scope.userId,id).run();
  }
}
