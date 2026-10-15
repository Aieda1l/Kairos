import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {getAbuseRuntime} from "@/lib/platform/abuse-runtime";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {enforceBudget} from "./guard";
import type {RegisteredOAuthRequest} from "@/lib/calendar/oauth-registry";
import {currentOperation,ownsOperation,withOwnedOperation,ownedFetch,checkOwnedOperation,operationControlVersion,
  OperationOwnershipError,type OperationLock,type OperationKey} from "./operation-lock";
import {AbuseStorageUnavailableError,AbuseSubjectError,RateLimitedError,type AbuseRuntime,type IntegrationProvider,type SourceProvider} from "./types";

export type ProviderWorkInput={provider:IntegrationProvider;operation:"credential"|"manual-sync"|"source-write";resourceId?:string;runId?:string};
declare const issued:unique symbol;
export type ProviderWorkContext=Readonly<{
  [issued]:true;
  ownership:OperationLock;
  controlVersion:number;
  fetch:typeof fetch;
  check:()=>Promise<void>;
}>;
type ActiveWork={db:D1DatabaseLike;userId:string;provider:IntegrationProvider;input:ProviderWorkInput;context:ProviderWorkContext;active:boolean};
const storage=new AsyncLocalStorage<ActiveWork>();
const sources=new Set<IntegrationProvider>(["canvas","ed","gradescope"]);
export function providerOperationKey(provider:IntegrationProvider):OperationKey{
  if(!["canvas","ed","gradescope","google","microsoft","caldav"].includes(provider))throw new AbuseSubjectError();
  return `${sources.has(provider)?"source":"calendar"}:${provider}` as OperationKey;
}
export function currentProviderWork(db:D1DatabaseLike,scope:UserScope,provider:IntegrationProvider,operation?:ProviderWorkInput["operation"],resourceId?:string):ProviderWorkContext|null{
  const entry=storage.getStore();
  return entry?.active&&entry.db===db&&entry.userId===scope.userId&&entry.provider===provider
    &&(!operation||(entry.input.operation==="credential")===(operation==="credential"))
    &&(resourceId===undefined||entry.input.resourceId===resourceId)
    &&entry.context.ownership===currentOperation(db)&&ownsOperation(db,scope,providerOperationKey(provider))?entry.context:null;
}

// DB and scope are server dependencies, never selected by a request. Resolve the
// real bindings/policy even for private service callers; retain their DB wrapper.
export async function providerRuntime(db:D1DatabaseLike):Promise<AbuseRuntime>{return {...await getAbuseRuntime(),db};}

async function authorizeResource(runtime:AbuseRuntime,scope:UserScope,input:ProviderWorkInput):Promise<void>{
  if(!scope.userId?.trim())throw new AbuseSubjectError();
  if(input.resourceId){
    const resource=sources.has(input.provider)
      ?await new D1SourceConnectionRepository(runtime.db,scope).getById(input.resourceId)
      :await new D1CalendarConnectionRepository(runtime.db,scope).getById(input.resourceId);
    if(!resource||("kind" in resource?resource.kind:resource.provider)!==input.provider)throw new AbuseSubjectError();
  }else if(input.operation!=="credential")throw new AbuseSubjectError();
}

/** Bind only an actual owner. Continuation callers have already claimed durable
 * server metadata; this function cannot be used to accept an HTTP receipt. */
async function runContext<T>(db:D1DatabaseLike,scope:UserScope,input:ProviderWorkInput,work:(context:ProviderWorkContext)=>Promise<T>,fetchImpl:typeof fetch=fetch):Promise<T>{
  const lock=currentOperation(db),version=lock&&operationControlVersion(lock);
  if(!lock||version===undefined||!ownsOperation(db,scope,providerOperationKey(input.provider)))throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  const assertContext=()=>{
    if(currentProviderWork(db,scope,input.provider)!==context)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  };
  const transport=ownedFetch(fetchImpl);
  const context=Object.freeze({ownership:lock,controlVersion:version,
    fetch:((request,init)=>{assertContext();return transport(request,init);}) as typeof fetch,
    check:async()=>{assertContext();await checkOwnedOperation();},
  }) as ProviderWorkContext;
  const entry:ActiveWork={db,userId:scope.userId,provider:input.provider,input,context,active:true};
  return storage.run(entry,async()=>{try{return await work(context);}finally{entry.active=false;}});
}

export async function withProviderWork<T>(runtime:AbuseRuntime,scope:UserScope,input:ProviderWorkInput,work:(context:ProviderWorkContext)=>Promise<T>):Promise<T>{
  const key=providerOperationKey(input.provider);
  // B5 has not issued a fanout capability. A run ID is never an exemption.
  if(input.runId!==undefined)throw new AbuseSubjectError();
  await authorizeResource(runtime,scope,input);
  const parent=currentProviderWork(runtime.db,scope,input.provider),entry=storage.getStore();
  if(parent&&entry&&(entry.input.operation==="credential")===(input.operation==="credential")
    &&(input.operation==="credential"||entry.input.resourceId===input.resourceId)){await parent.check();return work(parent);}
  const correlation=getOperationContext()??createOperationContext(input.operation==="credential"?"credential.connect":sources.has(input.provider)?"source.sync":"calendar.sync");
  return runWithOperationContext(correlation,async()=>{
    try{
      const control=await new D1AbuseControlRepository(runtime.db).get(`provider:${input.provider}`);
      if(!control.enabled)throw new AbuseStorageUnavailableError();
      return await withOwnedOperation(runtime.db,scope,key,async()=>{
        await enforceBudget(runtime,input.operation==="credential"
          ?{class:"credential",userId:scope.userId,provider:input.provider}
          :sources.has(input.provider)?{class:"source-sync",userId:scope.userId,provider:input.provider as SourceProvider,resourceId:input.resourceId!}
            :{class:"calendar-sync",userId:scope.userId,provider:input.provider as "google"|"microsoft"|"caldav",resourceId:input.resourceId!});
        return runContext(runtime.db,scope,input,work,runtime.fetchImpl);
      },{expectedControlVersion:control.version});
    }catch(error){
      // An existing C3 terminal owner emits the eventual outcome. Nested services
      // never emit success/progress or inspect arbitrary error/actor fields.
      if(error instanceof RateLimitedError)emitOperationEvent(correlation,{code:"RATE_LIMITED",result:"rejected",provider:input.provider,status:429});
      else if(error instanceof AbuseStorageUnavailableError)emitOperationEvent(correlation,{code:"SERVICE_UNAVAILABLE",result:"error",provider:input.provider,status:503});
      throw error;
    }
  });
}

export async function withProviderService<T>(db:D1DatabaseLike,scope:UserScope,input:ProviderWorkInput,work:()=>Promise<T>):Promise<T>{
  return withProviderWork(await providerRuntime(db),scope,input,work);
}

// Registration calls this while the original admission and exact ALS owner are
// live. Metadata is stored in the same request row as its one-use state/nonce.
export function providerAdmission(db:D1DatabaseLike,scope:UserScope,provider:IntegrationProvider):{admittedAtMs:number;controlVersion:number}{
  const context=currentProviderWork(db,scope,provider);
  if(!context)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  return {admittedAtMs:Date.now(),controlVersion:context.controlVersion};
}

/** Called only inside a repository-validated, one-use durable continuation. */
export async function withProviderContinuation<T>(db:D1DatabaseLike,scope:UserScope,request:RegisteredOAuthRequest,work:()=>Promise<T>):Promise<T>{
  const {claimAdmittedOAuthRequest}=await import("@/lib/db/d1/repositories/oauth-requests");
  if(!claimAdmittedOAuthRequest(db,scope,request))throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  return runContext(db,scope,{provider:request.provider,operation:"credential",...(request.connectionId?{resourceId:request.connectionId}:{})},work);
}
