import {currentOperation,holdBridgeOperation,cancelBridgeRegistration,claimBridgeCompletion,OperationOwnershipError} from "@/lib/abuse/operation-lock";
import {prepareOwned} from "@/lib/db/d1/owned-mutation";
import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

export type SyncRequestKind=
  | "canvas_submission"
  | "gradescope_discovery"
  | "gradescope_sync";

export type RegisteredSyncRequest<T=unknown>={
  requestId:string;
  kind:SyncRequestKind;
  payload:T;
  createdAt:string;
  expiresAt:string;
};

export type SyncRequestRegistration<T=unknown>=RegisteredSyncRequest<T>;

type Row={
  request_id:string;
  kind:SyncRequestKind;
  payload_json:string;
  created_at:string;
  expires_at:string;
};

export class D1SyncRequestRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async register<T>(input:SyncRequestRegistration<T>):Promise<void>{
    const lock=holdBridgeOperation(this.db);
    try{
      const result=await prepareOwned(this.db,this.scope,`
        INSERT INTO sync_requests(
          user_id,request_id,kind,payload_json,created_at,expires_at,consumed_at,operation_key,owner_nonce
        ) VALUES (?,?,?,?,?,?,NULL,?,?)
      `,{kind:"bridge",id:input.requestId,key:input.kind==="canvas_submission"?"source:canvas":"source:gradescope"}).bind(
        this.scope.userId,
        input.requestId,
        input.kind,
        JSON.stringify(input.payload),
        input.createdAt,
        input.expiresAt,lock.operationKey,lock.ownerNonce,
      ).run();
      if(!result.success||result.meta.changes!==1)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
    }catch(error){cancelBridgeRegistration(this.db);throw error;}
  }

  async consume<T=unknown>(
    requestId:string,
    expectedKind:SyncRequestKind,
    now:Date=new Date(),
  ):Promise<RegisteredSyncRequest<T>|null>{
    const lock=currentOperation(this.db);
    if(!lock)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
    const consumedAt=now.toISOString();
    const claimed=await prepareOwned(this.db,this.scope,`
      UPDATE sync_requests
      SET consumed_at=?
      WHERE user_id=?
        AND request_id=?
        AND kind=?
        AND consumed_at IS NULL
        AND expires_at>=? AND operation_key=? AND owner_nonce=?
    `,{kind:"bridge",id:requestId}).bind(
      consumedAt,
      this.scope.userId,
      requestId,
      expectedKind,
      consumedAt,lock.operationKey,lock.ownerNonce,
    ).run();

    if((claimed.meta.changes??0)!==1)return null;
    claimBridgeCompletion(this.db);

    const row=await this.db.prepare(`
      SELECT request_id,kind,payload_json,created_at,expires_at
      FROM sync_requests
      WHERE user_id=? AND request_id=? AND kind=? AND consumed_at=?
    `).bind(
      this.scope.userId,
      requestId,
      expectedKind,
      consumedAt,
    ).first<Row>();
    if(!row)return null;

    let payload:T;
    try{
      payload=JSON.parse(row.payload_json) as T;
    }catch{
      return null;
    }

    return {
      requestId:row.request_id,
      kind:row.kind,
      payload,
      createdAt:row.created_at,
      expiresAt:row.expires_at,
    };
  }
}

export function registerSyncRequest<T>(
  db:D1DatabaseLike,
  scope:UserScope,
  input:SyncRequestRegistration<T>,
):Promise<void>{
  return new D1SyncRequestRepository(db,scope).register(input);
}

export function consumeSyncRequest<T=unknown>(
  db:D1DatabaseLike,
  scope:UserScope,
  requestId:string,
  expectedKind:SyncRequestKind,
  now:Date=new Date(),
):Promise<RegisteredSyncRequest<T>|null>{
  return new D1SyncRequestRepository(db,scope).consume<T>(
    requestId,
    expectedKind,
    now,
  );
}
