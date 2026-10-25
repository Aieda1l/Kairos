import {z} from "zod";
import {GuestDataError} from "./errors";
import {guestCountSchema,guestUuidSchema,parseGuestSnapshot} from "./schema";
import type {GuestRunLease,GuestSnapshot} from "./types";

export const publicStores=["metadata","connections","courses","assignments","statuses","syncStates","preferences"] as const;
export const allStores=[...publicStores,"credentials","requests"] as const;
export type Metadata={datasetId:string;revision:number;generation:number;lease:GuestRunLease|null};
const time=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadataSchema=z.object({datasetId:guestUuidSchema,revision:guestCountSchema,generation:guestCountSchema,lease:z.object({
  datasetId:guestUuidSchema,runId:guestUuidSchema,pageEpoch:guestUuidSchema,generation:guestCountSchema,
  startedAtMs:time,deadlineAtMs:time,leaseExpiresAtMs:time,
}).strict().nullable()}).strict();

export function emptySnapshot(datasetId:string):GuestSnapshot {
  return {schemaVersion:1,datasetId,revision:0,connections:[],courses:[],assignments:[],statuses:[],syncStates:[],
    preferences:{timeZone:"UTC",filters:{course:"",source:"",search:""},sort:"due",automaticCanvas:false,automaticGradescope:false}};
}
export function storageError(error:unknown):GuestDataError {
  return error instanceof GuestDataError?error:new GuestDataError(error instanceof DOMException && error.name==="QuotaExceededError"?"GUEST_STORAGE_LIMIT":"GUEST_STORAGE_UNAVAILABLE");
}
export function idbRequest<T>(request:IDBRequest<T>):Promise<T> {
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
/** Only IndexedDB request promises may be awaited by work; no timers/network/crypto. */
export async function transaction<T>(db:IDBDatabase,stores:readonly string[],mode:IDBTransactionMode,work:(tx:IDBTransaction)=>Promise<T>):Promise<T> {
  try {
    const tx=db.transaction([...stores],mode);
    const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
    // Attach immediately, including when a synchronous put throws before awaiting completion.
    void done.catch(()=>{});
    try {const result=await work(tx);await done;return result;}
    catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
  }catch(error){throw storageError(error);}
}
export async function readMetadata(tx:IDBTransaction):Promise<Metadata> {
  const parsed=metadataSchema.safeParse(await idbRequest(tx.objectStore("metadata").get("identity")));
  if(!parsed.success || parsed.data.lease && (parsed.data.lease.datasetId!==parsed.data.datasetId || parsed.data.lease.generation!==parsed.data.generation))throw new GuestDataError("GUEST_STORAGE_UNAVAILABLE");
  return parsed.data;
}
export async function readSnapshot(tx:IDBTransaction,metadata:Metadata):Promise<GuestSnapshot> {
  const [connections,courses,assignments,statuses,syncStates,preferences]=await Promise.all([
    ...["connections","courses","assignments","statuses","syncStates"].map(name=>idbRequest(tx.objectStore(name).getAll())),
    idbRequest(tx.objectStore("preferences").get("settings")),
  ]);
  try{return parseGuestSnapshot({schemaVersion:1,datasetId:metadata.datasetId,revision:metadata.revision,connections,courses,assignments,statuses,syncStates,preferences});}
  catch{throw new GuestDataError("GUEST_STORAGE_UNAVAILABLE");}
}
export function prepareSnapshot(snapshot:GuestSnapshot,metadata:Metadata):GuestSnapshot {
  let valid:GuestSnapshot;
  try{valid=parseGuestSnapshot({...snapshot,revision:metadata.revision+1});}catch{throw new GuestDataError("GUEST_STORAGE_LIMIT");}
  return valid;
}
/** Persist an already validated snapshot; callers authorize immediately before this function. */
export function persistSnapshot(tx:IDBTransaction,valid:GuestSnapshot,metadata:Metadata):GuestSnapshot {
  for(const name of ["connections","courses","assignments","statuses","syncStates"] as const){const store=tx.objectStore(name);store.clear();for(const row of valid[name])store.put(row);}
  tx.objectStore("preferences").put(valid.preferences,"settings");
  metadata.revision=valid.revision;metadata.datasetId=valid.datasetId;
  tx.objectStore("metadata").put(metadata,"identity");
  return valid;
}
export function writeSnapshot(tx:IDBTransaction,snapshot:GuestSnapshot,metadata:Metadata):GuestSnapshot {
  return persistSnapshot(tx,prepareSnapshot(snapshot,metadata),metadata);
}
export function openDatabase(name:string,uuid:()=>string):Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    let request:IDBOpenDBRequest;
    try{request=indexedDB.open(name,1);}catch(error){reject(storageError(error));return;}
    request.onupgradeneeded=()=>{
      const db=request.result;
      const metadata=db.createObjectStore("metadata");
      const connections=db.createObjectStore("connections",{keyPath:"id"});connections.createIndex("kind","kind",{unique:true});
      const courses=db.createObjectStore("courses",{keyPath:"id"});courses.createIndex("connectionExternal",["sourceConnectionId","externalCourseId"],{unique:true});
      const assignments=db.createObjectStore("assignments",{keyPath:"id"});assignments.createIndex("connectionExternal",["sourceConnectionId","externalId"],{unique:true});
      db.createObjectStore("statuses",{keyPath:"assignmentId"});db.createObjectStore("syncStates",{keyPath:["sourceConnectionId","stage"]});
      const preferences=db.createObjectStore("preferences");db.createObjectStore("credentials",{keyPath:"connectionId"});db.createObjectStore("requests",{keyPath:"fence.requestId"});
      try{const snapshot=parseGuestSnapshot(emptySnapshot(uuid()));metadata.put({datasetId:snapshot.datasetId,revision:0,generation:0,lease:null} satisfies Metadata,"identity");preferences.put(snapshot.preferences,"settings");}
      catch{request.transaction!.abort();}
    };
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>reject(storageError(request.error));
    request.onblocked=()=>reject(new GuestDataError("GUEST_STORAGE_UNAVAILABLE"));
  });
}
