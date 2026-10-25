import {parseGuestBackup} from "./backup";
import {GuestDataError} from "./errors";
import {allStores,emptySnapshot,idbRequest,openDatabase,persistSnapshot,prepareSnapshot,publicStores,readMetadata,readSnapshot,transaction,writeSnapshot,type Metadata} from "./indexeddb";
import {GUEST_LEASE_MS,GUEST_RUN_DEADLINE_MS,GUEST_MAX_SECRET_CHARACTERS} from "./limits";
import {guestPreferencesSchema,guestStageSchema,guestUtcDateSchema,guestUuidSchema} from "./schema";
import {applyChanges,initialStage,updateStage} from "./store-data";
import {activeLease,authorizationTime,commitFence,invalid,register,sameRun,validateMembers,type StoredRequest} from "./store-runs";
import type {GuestRunIdentity,GuestSnapshot,GuestStore} from "./types";

export async function openGuestStore(options:{name?:string;uuid?:()=>string;now?:()=>number}={}):Promise<GuestStore> {
  const name=options.name??"kairos-guest-v1",uuid=options.uuid??(()=>crypto.randomUUID()),now=options.now??Date.now;
  const db=await openDatabase(name,uuid);
  // An existing database with missing/corrupt metadata is never silently reinitialized.
  try{await transaction(db,["metadata"],"readonly",readMetadata);}catch(error){db.close();throw error;}
  const listeners=new Set<()=>void>();
  let channel:BroadcastChannel|null=null;
  try{channel=new BroadcastChannel(`${name}:changes`);}catch{}
  const emit=()=>{for(const listener of listeners){try{listener();}catch{}}};
  if(channel)channel.onmessage=emit;
  const notify=()=>{emit();try{channel?.postMessage(null);}catch{}};
  const write=async<T>(work:(tx:IDBTransaction,metadata:Metadata)=>Promise<T>)=>{
    const value=await transaction(db,allStores,"readwrite",async tx=>work(tx,await readMetadata(tx)));notify();return value;
  };
  const connected=(snapshot:GuestSnapshot,id:string,generation:number)=>{
    const c=snapshot.connections.find(c=>c.id===id);if(!c||c.generation!==generation)throw new GuestDataError("GUEST_SUPERSEDED");return c;
  };
  const ownDataset=(metadata:Metadata,id:string)=>{if(metadata.datasetId!==id)throw new GuestDataError("GUEST_SUPERSEDED");};
  const endRun=(run:GuestRunIdentity)=>write(async(tx,metadata)=>{
    if(!sameRun(metadata.lease,run))return;
    metadata.lease=null;tx.objectStore("metadata").put(metadata,"identity");
    const requests:StoredRequest[]=await idbRequest(tx.objectStore("requests").getAll());
    for(const request of requests)if(sameRun(request.fence,run))tx.objectStore("requests").delete(request.fence.requestId);
  });
  const store:GuestStore={
    getIdentity:()=>transaction(db,["metadata"],"readonly",async tx=>{const m=await readMetadata(tx);return {datasetId:m.datasetId,revision:m.revision};}),
    read:()=>transaction(db,publicStores,"readonly",async tx=>readSnapshot(tx,await readMetadata(tx))),
    subscribe(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    savePreferences(patch,datasetId){
      patch=structuredClone(patch);
      return write(async(tx,m)=>{ownDataset(m,datasetId);const snapshot=await readSnapshot(tx,m);const preferences=guestPreferencesSchema.safeParse({...snapshot.preferences,...patch});if(!preferences.success)invalid();return writeSnapshot(tx,{...snapshot,preferences:preferences.data},m);});
    },
    setEnabledCourses(connectionId,ids,generation){
      ids=[...ids];
      return write(async(tx,m)=>{
        const snapshot=await readSnapshot(tx,m);connected(snapshot,connectionId,generation);
        const courses=snapshot.courses.filter(c=>c.sourceConnectionId===connectionId);
        if(new Set(ids).size!==ids.length||ids.some(id=>!courses.some(c=>c.externalCourseId===id)))invalid();
        if(courses.every(c=>c.enabled===ids.includes(c.externalCourseId)))return snapshot;
        const at=new Date(now()).toISOString();
        return writeSnapshot(tx,{...snapshot,connections:snapshot.connections.map(c=>c.id===connectionId?{...c,generation:c.generation+1,updatedAt:at}:c),courses:snapshot.courses.map(c=>c.sourceConnectionId===connectionId?{...c,enabled:ids.includes(c.externalCourseId)}:c)},m);
      });
    },
    beginRun(input){
      input={...input};
      return write(async(tx,m)=>{
        if(!guestUuidSchema.safeParse(input.pageEpoch).success||!Number.isSafeInteger(input.deadlineAtMs))invalid();
        const at=authorizationTime(input.nowMs,now);if(activeLease(m.lease,at))return null;
        const deadlineAtMs=Math.min(input.deadlineAtMs,at+GUEST_RUN_DEADLINE_MS);if(deadlineAtMs<=at)return null;
        if(!Number.isSafeInteger(m.generation+1))throw new GuestDataError("GUEST_STORAGE_LIMIT");
        const lease={datasetId:m.datasetId,runId:guestUuidSchema.parse(uuid()),pageEpoch:input.pageEpoch,generation:m.generation+1,startedAtMs:at,deadlineAtMs,leaseExpiresAtMs:Math.min(at+GUEST_LEASE_MS,deadlineAtMs)};
        m.generation=lease.generation;m.lease=lease;tx.objectStore("requests").clear();tx.objectStore("metadata").put(m,"identity");return lease;
      });
    },
    renewRun(run,nowMs){
      run={...run};return write(async(tx,m)=>{const at=authorizationTime(nowMs,now);if(!sameRun(m.lease,run)||!activeLease(m.lease,at))return null;m.lease={...m.lease,leaseExpiresAtMs:Math.min(at+GUEST_LEASE_MS,m.lease.deadlineAtMs)};tx.objectStore("metadata").put(m,"identity");return m.lease;});
    },
    releaseRun:run=>endRun({...run}),invalidateRun:run=>endRun({...run}),
    registerRequest(request,nowMs){request=structuredClone(request);return write(async(tx,m)=>register(tx,m,await readSnapshot(tx,m),request,()=>authorizationTime(nowMs,now)));},
    markStageAttempt(run,connectionId,generation,stage,at){
      run={...run};return write(async(tx,m)=>{
        const snapshot=await readSnapshot(tx,m);if(!sameRun(m.lease,run)||!activeLease(m.lease,now()))return false;
        const c=snapshot.connections.find(c=>c.id===connectionId&&c.generation===generation);
        if(!c)return false;
        if(!guestStageSchema.safeParse(stage).success||!guestUtcDateSchema.safeParse(at).success||c.kind!==(stage.startsWith("canvas-")?"canvas":stage))invalid();
        const previous=snapshot.syncStates.find(s=>s.sourceConnectionId===connectionId&&s.stage===stage)??initialStage(connectionId,stage);
        const prepared=prepareSnapshot(updateStage(snapshot,{...previous,lastAttemptedAt:at,hasSuccessfulCheck:false,updatedCount:0,failedCount:0,lastErrorCode:null}),m);
        if(!activeLease(m.lease,now()))return false;
        persistSnapshot(tx,prepared,m);return true;
      });
    },
    commit(request,changes,nowMs){
      request=structuredClone(request);changes=structuredClone(changes);
      return write(async(tx,m)=>{
        const snapshot=await readSnapshot(tx,m);
        const registered:StoredRequest|undefined=await idbRequest(tx.objectStore("requests").get(request.requestId));
        const rejected=commitFence(m,snapshot,request,registered,authorizationTime(nowMs,now));if(rejected)return rejected;
        validateMembers(registered!,snapshot);
        const applied=applyChanges(snapshot,request,registered!,changes,new Date(authorizationTime(nowMs,now)).toISOString(),uuid);
        const prepared=prepareSnapshot(applied.snapshot,m);
        // Recheck after validation/merge, before the first mutation. Renewal timestamps are not request identity.
        const expired=commitFence(m,snapshot,request,registered,authorizationTime(nowMs,now));if(expired)return expired;
        const saved=persistSnapshot(tx,prepared,m);
        if(applied.credential){const credential=applied.credential;if(credential.value===null)tx.objectStore("credentials").delete(credential.connectionId);else tx.objectStore("credentials").put(credential);}
        tx.objectStore("requests").put({...registered!,consumed:true});
        return {status:"accepted" as const,snapshot:saved,updatedCount:applied.updatedCount,ignoredCount:applied.ignoredCount};
      });
    },
    readRememberedSecret(connectionId){return transaction(db,["connections","credentials"],"readonly",async tx=>{
      const [c,secret]=await Promise.all([idbRequest(tx.objectStore("connections").get(connectionId)),idbRequest(tx.objectStore("credentials").get(connectionId))]);
      if(!c||!secret)return null;
      if(secret.connectionId!==connectionId||typeof secret.value!=="string"||!secret.value.length||secret.value.length>GUEST_MAX_SECRET_CHARACTERS)throw new GuestDataError("GUEST_STORAGE_UNAVAILABLE");
      return secret.value;
    });},
    forgetCredential(connectionId,generation){return write(async(tx,m)=>{
      const snapshot=await readSnapshot(tx,m);connected(snapshot,connectionId,generation);
      const saved=writeSnapshot(tx,{...snapshot,connections:snapshot.connections.map(c=>c.id===connectionId?{...c,generation:c.generation+1,updatedAt:new Date(now()).toISOString()}:c)},m);
      tx.objectStore("credentials").delete(connectionId);return saved;
    });},
    disconnect(connectionId,generation){return write(async(tx,m)=>{
      const snapshot=await readSnapshot(tx,m);connected(snapshot,connectionId,generation);
      const assignments=snapshot.assignments.filter(a=>a.sourceConnectionId!==connectionId),ids=new Set(assignments.map(a=>a.id));
      const saved=writeSnapshot(tx,{...snapshot,connections:snapshot.connections.filter(c=>c.id!==connectionId),courses:snapshot.courses.filter(c=>c.sourceConnectionId!==connectionId),assignments,statuses:snapshot.statuses.filter(s=>ids.has(s.assignmentId)),syncStates:snapshot.syncStates.filter(s=>s.sourceConnectionId!==connectionId)},m);
      tx.objectStore("credentials").delete(connectionId);return saved;
    });},
    replaceDataset(backup,datasetId){
      backup=parseGuestBackup(JSON.stringify(backup));
      return write(async(tx,m)=>{
        ownDataset(m,datasetId);
        const mapping=new Map(backup.data.connections.map(c=>[c.id,uuid()]));const remap=(id:string)=>mapping.get(id)!;
        const snapshot:GuestSnapshot={schemaVersion:1,datasetId:uuid(),revision:0,...backup.data,
          connections:backup.data.connections.map(c=>({...c,id:remap(c.id),generation:1})),courses:backup.data.courses.map(c=>({...c,sourceConnectionId:remap(c.sourceConnectionId)})),
          assignments:backup.data.assignments.map(a=>({...a,sourceConnectionId:remap(a.sourceConnectionId)})),syncStates:backup.data.syncStates.map(s=>({...s,sourceConnectionId:remap(s.sourceConnectionId)}))};
        if(snapshot.datasetId===datasetId)invalid();m.lease=null;m.generation=0;
        const saved=writeSnapshot(tx,snapshot,m);tx.objectStore("credentials").clear();tx.objectStore("requests").clear();return saved;
      });
    },
    clear(datasetId){return write(async(tx,m)=>{
      ownDataset(m,datasetId);const snapshot=emptySnapshot(uuid());if(snapshot.datasetId===datasetId)invalid();m.lease=null;m.generation=0;
      const saved=writeSnapshot(tx,snapshot,m);tx.objectStore("credentials").clear();tx.objectStore("requests").clear();return saved;
    });},
    close(){listeners.clear();channel?.close();db.close();},
  };
  return store;
}
