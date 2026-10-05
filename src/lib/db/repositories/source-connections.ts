import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceKind } from "@/lib/sources/types";

type Row={
  id:string;
  kind:SourceKind;
  label:string;
  enabled:number;
  last_sync_started_at:string|null;
  last_sync_completed_at:string|null;
  last_sync_status:SourceConnection["lastSyncStatus"];
  last_error_code:string|null;
};

const map=(r:Row):SourceConnection=>({
  id:r.id,
  kind:r.kind,
  label:r.label,
  enabled:Boolean(r.enabled),
  lastSyncStartedAt:r.last_sync_started_at,
  lastSyncCompletedAt:r.last_sync_completed_at,
  lastSyncStatus:r.last_sync_status,
  lastErrorCode:r.last_error_code,
});

export class SourceConnectionRepository{
  constructor(private db:Database.Database){}
  private select="SELECT id,kind,label,enabled,last_sync_started_at,last_sync_completed_at,last_sync_status,last_error_code FROM source_connections";

  getByKind(kind:SourceKind){
    const r=this.db.prepare(`${this.select} WHERE kind=?`).get(kind) as Row|undefined;
    return r?map(r):null;
  }

  getById(id:string){
    const r=this.db.prepare(`${this.select} WHERE id=?`).get(id) as Row|undefined;
    return r?map(r):null;
  }

  private upsert(kind:SourceKind,label:string):SourceConnection{
    const existing=this.getByKind(kind);
    const now=new Date().toISOString();
    if(existing){
      this.db.prepare("UPDATE source_connections SET label=?,enabled=1,updated_at=? WHERE id=?").run(label,now,existing.id);
      return this.getByKind(kind)!;
    }
    const id=crypto.randomUUID();
    this.db.prepare("INSERT INTO source_connections(id,kind,label,enabled,last_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id,kind,label,1,"never",now,now);
    return this.getByKind(kind)!;
  }

  upsertCanvas(label:string):SourceConnection{return this.upsert("canvas",label);}
  upsertGradescope(label:string):SourceConnection{return this.upsert("gradescope",label);}

  markSyncStarted(id:string,at:string){
    this.db.prepare("UPDATE source_connections SET last_sync_started_at=?,updated_at=? WHERE id=?").run(at,at,id);
  }

  markSyncSuccess(id:string,at:string,errorCode:string|null=null){
    this.db.prepare("UPDATE source_connections SET last_sync_completed_at=?,last_sync_status='success',last_error_code=?,updated_at=? WHERE id=?")
      .run(at,errorCode,at,id);
  }

  markSyncError(id:string,at:string,errorCode:string){
    this.db.prepare("UPDATE source_connections SET last_sync_status='error',last_error_code=?,updated_at=? WHERE id=?")
      .run(errorCode,at,id);
  }
}
