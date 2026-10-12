import {prepareOwned} from "@/lib/db/d1/owned-mutation";
import "server-only";
import type {SourceConnection} from "@/lib/assignments/types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1PreparedStatementLike,D1ResultLike} from "@/lib/db/d1/types";
import type {SourceKind} from "@/lib/sources/types";

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

const map=(row:Row):SourceConnection=>({
  id:row.id,
  kind:row.kind,
  label:row.label,
  enabled:Boolean(row.enabled),
  lastSyncStartedAt:row.last_sync_started_at,
  lastSyncCompletedAt:row.last_sync_completed_at,
  lastSyncStatus:row.last_sync_status,
  lastErrorCode:row.last_error_code,
});

export class D1SourceConnectionRepository{
  private readonly select=`
    SELECT id,kind,label,enabled,last_sync_started_at,last_sync_completed_at,last_sync_status,last_error_code
    FROM source_connections
  `;

  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async getByKind(kind:SourceKind):Promise<SourceConnection|null>{
    const row=await this.prepareGetByKind(kind).first<Row>();
    return row?map(row):null;
  }

  prepareGetByKind(kind:SourceKind):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,`${this.select} WHERE user_id=? AND kind=?`).bind(this.scope.userId,kind);
  }

  connectionFromResult(result:D1ResultLike):SourceConnection{
    return map(result.results[0] as Row);
  }

  async getById(id:string):Promise<SourceConnection|null>{
    const row=await prepareOwned(this.db,this.scope,`${this.select} WHERE user_id=? AND id=?`)
      .bind(this.scope.userId,id).first<Row>();
    return row?map(row):null;
  }

  prepareUpsert(id:string,kind:SourceKind,label:string,at:string):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,`
      INSERT INTO source_connections(user_id,id,kind,label,enabled,last_sync_status,created_at,updated_at)
      VALUES (?,?,?,?,1,'never',?,?)
      ON CONFLICT(user_id,kind) DO UPDATE SET label=excluded.label,enabled=1,updated_at=excluded.updated_at
    `,{kind:"source",id,key:`source:${kind}`}).bind(this.scope.userId,id,kind,label,at,at);
  }

  prepareSyncStarted(id:string,at:string):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,
      "UPDATE source_connections SET last_sync_started_at=?,updated_at=? WHERE user_id=? AND id=?",
    {kind:"source",id}).bind(at,at,this.scope.userId,id);
  }

  prepareSyncSuccess(id:string,at:string,errorCode:string|null=null):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,`
      UPDATE source_connections
      SET last_sync_completed_at=?,last_sync_status='success',last_error_code=?,updated_at=?
      WHERE user_id=? AND id=?
    `,{kind:"source",id}).bind(at,errorCode,at,this.scope.userId,id);
  }

  private async upsert(kind:SourceKind,label:string):Promise<SourceConnection>{
    const existing=await this.getByKind(kind);
    const now=new Date().toISOString();
    if(existing){
      await prepareOwned(this.db,this.scope,
        "UPDATE source_connections SET label=?,enabled=1,updated_at=? WHERE user_id=? AND id=?",
      {kind:"source",id:existing.id,key:`source:${kind}`}).bind(label,now,this.scope.userId,existing.id).run();
      return (await this.getByKind(kind))!;
    }

    const id=crypto.randomUUID();
    await prepareOwned(this.db,this.scope,`
      INSERT INTO source_connections(
        user_id,id,kind,label,enabled,last_sync_status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `,{kind:"source",id:id,key:`source:${kind}`}).bind(this.scope.userId,id,kind,label,1,"never",now,now).run();
    return (await this.getByKind(kind))!;
  }

  upsertCanvas(label:string){return this.upsert("canvas",label);}
  upsertGradescope(label:string){return this.upsert("gradescope",label);}
  upsertEd(label:string){return this.upsert("ed",label);}

  async markSyncStarted(id:string,at:string):Promise<void>{
    await this.prepareSyncStarted(id,at).run();
  }

  async markSyncSuccess(id:string,at:string,errorCode:string|null=null):Promise<void>{
    await this.prepareSyncSuccess(id,at,errorCode).run();
  }

  async markSyncError(id:string,at:string,errorCode:string):Promise<void>{
    await prepareOwned(this.db,this.scope,`
      UPDATE source_connections
      SET last_sync_status='error',last_error_code=?,updated_at=?
      WHERE user_id=? AND id=?
    `,{kind:"source",id}).bind(errorCode,at,this.scope.userId,id).run();
  }
}
