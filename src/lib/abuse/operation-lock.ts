import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";
import {AbuseStorageUnavailableError,AbuseSubjectError,RateLimitedError,boundedRetryAfter,type AbuseRuntime,type IntegrationProvider} from "./types";

export type OperationKey=`source:${"canvas"|"ed"|"gradescope"}`|`calendar:${"google"|"microsoft"|"caldav"}`;
export type OperationLock={userId:string;operationKey:string;ownerNonce:string};
export type OperationOptions=Readonly<{expectedControlVersion?:number}>;
export class OperationControlVersionChangedError extends Error{
  readonly code="PROVIDER_AUTHORIZATION_CHANGED";
  constructor(){super("Provider authorization is no longer active.");this.name="OperationControlVersionChangedError";}
}
export class OperationOwnershipError extends Error{
  readonly status=409;
  constructor(readonly code:"SYNC_IN_PROGRESS"|"SYNC_RECOVERY_REQUIRED"){
    super(code==="SYNC_IN_PROGRESS"?"Provider work is already running. Wait for it to finish.":
      "Prior provider work needs recovery. Accepted data and calendar mappings are retained; do not retry remote writes until prior work has settled and its outcome has been confirmed.");
    this.name="OperationOwnershipError";
  }
}
const clock="CAST(strftime('%s','now') AS INTEGER)*1000";
const databases=new WeakMap<OperationLock,D1DatabaseLike>();
const controlVersions=new WeakMap<OperationLock,number>();
export function operationControlVersion(lock:OperationLock):number|undefined{return controlVersions.get(lock);}
type Owner={db:D1DatabaseLike;lock:OperationLock;held:boolean;uncertain:boolean;stopped:boolean;cooldown:number;claimed:boolean;executing:boolean;pending:Set<Promise<unknown>>;calendarWriteStarted:boolean;admissionFailed:boolean;authorizationChanged:boolean};
const owners=new AsyncLocalStorage<Owner>();
const activeOwners=new WeakMap<OperationLock,Owner>();

function bindLock(db:D1DatabaseLike,lock:OperationLock):OperationLock{databases.set(lock,db);return lock;}
export function acquireOperation(runtime:AbuseRuntime,scope:UserScope,key:OperationKey,options:OperationOptions={}):Promise<OperationLock>{
  return acquireFromDatabase(runtime.db,scope,key,options);
}
async function acquireFromDatabase(db:D1DatabaseLike,scope:UserScope,key:OperationKey,options:OperationOptions={}):Promise<OperationLock>{
  const expected=options.expectedControlVersion;
  if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected<0))throw new OperationControlVersionChangedError();
  if(!scope.userId||! /^(source:(canvas|ed|gradescope)|calendar:(google|microsoft|caldav))$/.test(key))throw new AbuseSubjectError();
  const lock=bindLock(db,Object.freeze({userId:scope.userId,operationKey:key,ownerNonce:crypto.randomUUID()}));
  if(expected!==undefined)controlVersions.set(lock,expected);
  try{
    const result=await db.prepare(`INSERT INTO operation_locks(user_id,operation_key,owner_nonce,state,started_at_ms,stale_at_ms,not_before_ms)
      SELECT ?,?,?,'running',${clock},${clock}+600000,0 WHERE EXISTS (SELECT 1 FROM abuse_controls WHERE control_key=? AND enabled=1${expected===undefined?"":" AND version=?"})
      ON CONFLICT(user_id,operation_key) DO UPDATE SET owner_nonce=excluded.owner_nonce,state='running',
        started_at_ms=excluded.started_at_ms,stale_at_ms=excluded.stale_at_ms
      WHERE operation_locks.state='idle' AND operation_locks.not_before_ms<=${clock}`)
      .bind(lock.userId,key,lock.ownerNonce,`provider:${key.split(":")[1]}`,...(expected===undefined?[]:[expected])).run();
    if(!result.success||![0,1].includes(result.meta.changes as number))throw new AbuseStorageUnavailableError();
    if(result.meta.changes===1)return lock;
    const row=await db.prepare(`SELECT lock.state,lock.stale_at_ms,lock.not_before_ms,${clock} AS now,control.enabled,control.version
      FROM abuse_controls control LEFT JOIN operation_locks lock ON lock.user_id=? AND lock.operation_key=? WHERE control.control_key=?`)
      .bind(scope.userId,key,`provider:${key.split(":")[1]}`).first<{state:string|null;stale_at_ms:number;not_before_ms:number;now:number;enabled:number;version:number}>();
    if(!row||row.enabled!==1)throw new AbuseStorageUnavailableError();
    if(expected!==undefined&&row.version!==expected)throw new OperationControlVersionChangedError();
    if(!row.state)throw new AbuseStorageUnavailableError();
    if(row.state==='uncertain'||(row.state==='running'&&row.stale_at_ms<=row.now))throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
    if(row.state==='running')throw new OperationOwnershipError("SYNC_IN_PROGRESS");
    throw new RateLimitedError((row.not_before_ms-row.now)/1000);
  }catch(error){
    if(error instanceof OperationOwnershipError||error instanceof RateLimitedError||error instanceof OperationControlVersionChangedError)throw error;
    throw new AbuseStorageUnavailableError();
  }
}
export async function releaseOperation(lock:OperationLock):Promise<boolean>{
  const db=databases.get(lock);if(!db)return false;
  const active=activeOwners.get(lock);if(active?.executing||active?.held||active?.pending.size)return false;
  return releaseOwnedRow(db,lock);
}
async function releaseOwnedRow(db:D1DatabaseLike,lock:OperationLock):Promise<boolean>{
  try{
    const result=await db.prepare("UPDATE operation_locks SET state='idle' WHERE user_id=? AND operation_key=? AND owner_nonce=? AND state='running'")
      .bind(lock.userId,lock.operationKey,lock.ownerNonce).run();
    if(!result.success||![0,1].includes(result.meta.changes as number))throw new AbuseStorageUnavailableError();
    return result.meta.changes===1;
  }catch{throw new AbuseStorageUnavailableError();}
}
export async function markOperationUncertain(lock:OperationLock):Promise<void>{
  const db=databases.get(lock);if(!db)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  try{
    const result=await db.prepare("UPDATE operation_locks SET state='uncertain' WHERE user_id=? AND operation_key=? AND owner_nonce=? AND state='running'")
      .bind(lock.userId,lock.operationKey,lock.ownerNonce).run();
    if(!result.success||![0,1].includes(result.meta.changes as number))throw new AbuseStorageUnavailableError();
  }catch{throw new AbuseStorageUnavailableError();}
}
export function currentOperation(db:D1DatabaseLike):OperationLock|null{const owner=owners.getStore();return owner?.db===db?owner.lock:null;}
export function ownsOperation(db:D1DatabaseLike,scope:UserScope,key:OperationKey):boolean{
  const owner=owners.getStore();return owner?.db===db&&owner.executing&&!owner.held&&owner.lock.userId===scope.userId&&owner.lock.operationKey===key;
}
export function holdBridgeOperation(db:D1DatabaseLike):OperationLock{
  const owner=owners.getStore();if(owner?.db!==db)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  if(owner.held)throw new OperationOwnershipError("SYNC_IN_PROGRESS");
  owner.held=true;return owner.lock;
}
export function cancelBridgeRegistration(db:D1DatabaseLike):void{const owner=owners.getStore();if(owner?.db===db)owner.held=false;}
export function claimBridgeCompletion(db:D1DatabaseLike):void{const owner=owners.getStore();if(owner?.db===db)owner.claimed=true;}
export function ownedWorkStopped():boolean{return owners.getStore()?.stopped??false;}
export function uncertainOwnedWork():void{const owner=owners.getStore();if(owner){owner.uncertain=true;owner.stopped=true;}}
export function uncertainOwnedCalendarWrite():void{const owner=owners.getStore();if(owner?.calendarWriteStarted&&!owner.admissionFailed&&!owner.authorizationChanged)uncertainOwnedWork();}
export function throttleOwnedWork(seconds?:number):void{const owner=owners.getStore();if(owner){owner.stopped=true;owner.cooldown=Math.max(owner.cooldown,boundedRetryAfter(seconds??(owner.cooldown||60)));}}

async function runOwner<T>(owner:Owner,work:()=>Promise<T>,bridgeCompletion=false):Promise<T>{
  const previous=activeOwners.get(owner.lock);
  if(previous!==owner&&(previous?.executing||previous?.held))throw new OperationOwnershipError("SYNC_IN_PROGRESS");
  activeOwners.set(owner.lock,owner);
  return owners.run(owner,async()=>{
    try{
      const result=await work();
      while(owner.pending.size)await Promise.allSettled([...owner.pending]);
      if(owner.uncertain)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
      if(owner.admissionFailed)throw new AbuseStorageUnavailableError();
      if(owner.authorizationChanged)throw new OperationControlVersionChangedError();
      await assertOperationOwner(owner.db,owner.lock);
      return result;
    }catch(error){
      while(owner.pending.size)await Promise.allSettled([...owner.pending]);
      if(owner.uncertain)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
      if(owner.admissionFailed)throw new AbuseStorageUnavailableError();
      if(owner.authorizationChanged)throw new OperationControlVersionChangedError();
      throw error;
    }finally{
      try{
        while(owner.pending.size)await Promise.allSettled([...owner.pending]);
        if(activeOwners.get(owner.lock)!==owner)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
        if(owner.cooldown){const persisted=await owner.db.prepare(`UPDATE operation_locks SET not_before_ms=MAX(not_before_ms,${clock}+?) WHERE user_id=? AND operation_key=? AND owner_nonce=?`)
          .bind(owner.cooldown*1000,owner.lock.userId,owner.lock.operationKey,owner.lock.ownerNonce).run();
          if(!persisted.success||persisted.meta.changes!==1)throw new AbuseStorageUnavailableError();}
        if(owner.uncertain)await markOperationUncertain(owner.lock);
        else if(!owner.held&&(!bridgeCompletion||owner.claimed))await releaseOwnedRow(owner.db,owner.lock);
      }finally{owner.executing=false;}

    }
  });
}
// Internal service boundary. B3 supplies admission separately; this boundary also
// protects automatic/private calls. Neither identity nor ownership comes from HTTP.
export async function withOwnedOperation<T>(db:D1DatabaseLike,scope:UserScope,key:OperationKey,work:()=>Promise<T>,options:OperationOptions={}):Promise<T>{
  if(ownsOperation(db,scope,key)){
    if(options.expectedControlVersion!==undefined&&operationControlVersion(currentOperation(db)!)!==options.expectedControlVersion)throw new OperationControlVersionChangedError();
    return work();
  }
  const lock=await acquireFromDatabase(db,scope,key,options);
  return runOwner({db,lock,held:false,uncertain:false,stopped:false,cooldown:0,claimed:false,executing:true,pending:new Set(),calendarWriteStarted:false,admissionFailed:false,authorizationChanged:false},async()=>{if(options.expectedControlVersion!==undefined)await assertOperationOwner(db,lock);return work();});
}

async function assertOperationOwner(db:D1DatabaseLike,lock:OperationLock):Promise<void>{
  try{
  const row=await db.prepare("SELECT (SELECT enabled FROM abuse_controls WHERE control_key=?) AS enabled,(SELECT version FROM abuse_controls WHERE control_key='provider:'||substr(operation_locks.operation_key,instr(operation_locks.operation_key,':')+1)) AS version FROM operation_locks WHERE user_id=? AND operation_key=? AND owner_nonce=? AND state='running'")
    .bind(`provider:${lock.operationKey.split(":")[1]}`,lock.userId,lock.operationKey,lock.ownerNonce).first<{enabled:number;version:number}>();
  if(!row)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  if(row.enabled!==1)throw new AbuseStorageUnavailableError();
  const expected=operationControlVersion(lock);
  if(expected!==undefined&&row.version!==expected)throw new OperationControlVersionChangedError();
  }catch(error){if(error instanceof OperationOwnershipError||error instanceof AbuseStorageUnavailableError||error instanceof OperationControlVersionChangedError)throw error;throw new AbuseStorageUnavailableError();}
}

/** B3 can bind an acquired server-issued capability around service calls. */
export async function runWithOperationOwnership<T>(lock:OperationLock,work:()=>Promise<T>):Promise<T>{
  const db=databases.get(lock);if(!db)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  const previous=activeOwners.get(lock);
  if(previous?.held)throw new OperationOwnershipError("SYNC_IN_PROGRESS");
  if(previous?.uncertain)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  if(previous?.executing){
    if(owners.getStore()===previous)return work();
    throw new OperationOwnershipError("SYNC_IN_PROGRESS");
  }
  const owner:Owner={db,lock,held:false,uncertain:false,stopped:false,cooldown:0,claimed:false,executing:true,pending:new Set(),calendarWriteStarted:false,admissionFailed:false,authorizationChanged:false};
  // Reserve synchronously, before validation can yield to a competing entry.
  activeOwners.set(lock,owner);
  return runOwner(owner,async()=>{await assertOperationOwner(db,lock);return work();});
}

export async function withBridgeCompletion<T>(db:D1DatabaseLike,scope:UserScope,requestId:string,kind:string,now:Date,work:()=>Promise<T>):Promise<T>{
  const row=await db.prepare(`SELECT operation_key,owner_nonce,expires_at,consumed_at FROM sync_requests WHERE user_id=? AND request_id=? AND kind=?`)
    .bind(scope.userId,requestId,kind).first<{operation_key:OperationKey|null;owner_nonce:string|null;expires_at:string;consumed_at:string|null}>();
  if(!row?.operation_key||!row.owner_nonce||row.consumed_at)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  const lock=bindLock(db,{userId:scope.userId,operationKey:row.operation_key,ownerNonce:row.owner_nonce});
  if(row.expires_at<now.toISOString()){await markOperationUncertain(lock);throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");}
  if(!(await new D1AbuseControlRepository(db).get(`provider:${row.operation_key.split(":")[1] as IntegrationProvider}`)).enabled)throw new AbuseStorageUnavailableError();
  const active=await db.prepare("SELECT 1 AS active FROM operation_locks WHERE user_id=? AND operation_key=? AND owner_nonce=? AND state='running'")
    .bind(lock.userId,lock.operationKey,lock.ownerNonce).first();
  if(!active)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  return runOwner({db,lock,held:false,uncertain:false,stopped:false,cooldown:0,claimed:false,executing:true,pending:new Set(),calendarWriteStarted:false,admissionFailed:false,authorizationChanged:false},work,true);
}

// Tracks transport settlement and ambiguous calendar writes without recording
// request data. Reconciliation adapters also track ambiguity in parsed responses.
export function ownedFetch(fetchImpl:typeof fetch):typeof fetch{
  return (input,init)=>{
    const owner=owners.getStore();
    const perform=async()=>{
      if(owner?.stopped)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
      if(owner){
        try{await assertOperationOwner(owner.db,owner.lock);}catch(error){
          if(error instanceof AbuseStorageUnavailableError)owner.admissionFailed=true;
          if(error instanceof OperationControlVersionChangedError)owner.authorizationChanged=true;
          throw error;
        }
        if(owner.stopped)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
      }
      const method=(init?.method??(input instanceof Request?input.method:"GET")).toUpperCase();
      const write=owner?.lock.operationKey.startsWith("calendar:")&&!['GET','HEAD','PROPFIND','REPORT','OPTIONS'].includes(method);
      try{
        if(write&&owner)owner.calendarWriteStarted=true;
        const response=await fetchImpl(input,init);
        if(response.status===429){const value=response.headers.get("retry-after");const seconds=value===null?60:/^\d+$/.test(value)?Number(value):(Date.parse(value)-Date.now())/1000;throttleOwnedWork(seconds);}
        else if(write&&response.status>=500)uncertainOwnedWork();
        return response;
      }catch(error){if(write)uncertainOwnedWork();throw error;}
    };
    const pending=perform();
    if(owner){owner.pending.add(pending);void pending.then(()=>owner.pending.delete(pending),()=>owner.pending.delete(pending));}
    return pending;
  };
}
