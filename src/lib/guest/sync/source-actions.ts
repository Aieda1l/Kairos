import type {SourceKind} from "@/lib/sources/types";
import {GuestDataError,type GuestSafeCode} from "../errors";
import {GUEST_MAX_SECRET_CHARACTERS} from "../limits";
import type {GuestCredentials} from "../credentials";
import type {GuestCommitChanges,GuestCommitResult,GuestConnection,GuestSecretChoice,GuestStore} from "../types";
import type {GuestValidatedRead} from "./request-registry";

export type GuestSourceActionOutcome={status:"success"|"failed";code:GuestSafeCode|null;connectionId:string|null};
export type GuestSetupRead=(source:SourceKind,connection:GuestConnection|null,secret:string|undefined,changes:(read:GuestValidatedRead)=>GuestCommitChanges)=>Promise<Extract<GuestCommitResult,{status:"accepted"}>>;
type Options={store:GuestStore;credentials:GuestCredentials;uuid:()=>string;now:()=>number;read:GuestSetupRead};

/** All secrets are kept in closure locals and the private vault, never action results. */
export function createGuestSourceActions({store,credentials,uuid,now,read}:Options){
  const failure=(error:unknown):GuestSourceActionOutcome=>({status:"failed",code:error instanceof GuestDataError?error.code:"INVALID_RESULT",connectionId:null});
  function choice(value:GuestSecretChoice):GuestSecretChoice{
    if(!value||typeof value.value!=="string"||value.value.length<1||value.value.length>GUEST_MAX_SECRET_CHARACTERS||typeof value.remember!=="boolean")throw new GuestDataError("BAD_REQUEST");
    return {value:value.value,remember:value.remember};
  }
  async function connection(id:string){const c=(await store.read()).connections.find(c=>c.id===id);if(!c)throw new GuestDataError("GUEST_NOT_CONNECTED");return c;}
  function courses(result:GuestValidatedRead){
    if(result.operation==="ed-courses")return result.result.courses;
    if(result.operation==="gradescope-discovery"){
      if(result.result.errorCode)throw new GuestDataError(result.result.errorCode);
      return result.result.courses.map(({courseId,...c})=>({...c,externalCourseId:courseId}));
    }
    throw new GuestDataError("INVALID_RESULT");
  }
  async function connect(source:SourceKind,input?:GuestSecretChoice):Promise<GuestSourceActionOutcome>{
    try{
      const secret=input?choice(input):null;
      if((await store.read()).connections.some(c=>c.kind===source))throw new GuestDataError("GUEST_SUPERSEDED");
      const id=uuid();
      const saved=await read(source,null,secret?.value,result=>{
        const at=new Date(now()).toISOString();
        return {kind:"connect",connection:{id,kind:source,enabled:true,generation:1,createdAt:at,updatedAt:at},courses:source==="canvas"?[]:courses(result),assignments:result.operation==="canvas-feed"?result.result.assignments:[],secret};
      });
      if(secret)credentials.put(id,saved.snapshot.connections.find(c=>c.id===id)!.generation,secret.value);
      return {status:"success",code:null,connectionId:id};
    }catch(error){return failure(error);}
  }
  return {
    connectCanvas:(input:GuestSecretChoice)=>connect("canvas",input),
    connectEd:(input:GuestSecretChoice)=>connect("ed",input),
    connectGradescope:()=>connect("gradescope"),
    async restoreSecret(id:string,input:GuestSecretChoice):Promise<GuestSourceActionOutcome>{
      try{
        const secret=choice(input),c=await connection(id);if(c.kind==="gradescope")throw new GuestDataError("BAD_REQUEST");
        const saved=await read(c.kind,c,secret.value,()=>({kind:"credential",secret}));
        credentials.put(id,saved.snapshot.connections.find(c=>c.id===id)!.generation,secret.value);
        return {status:"success",code:null,connectionId:id};
      }catch(error){return failure(error);}
    },
    async refreshCourses(id:string):Promise<GuestSourceActionOutcome>{
      try{
        const c=await connection(id);if(c.kind==="canvas")throw new GuestDataError("BAD_REQUEST");
        const secret=c.kind==="ed"?await credentials.get(id,c.generation):undefined;
        if(secret===null)throw new GuestDataError("GUEST_CREDENTIAL_REQUIRED");
        const saved=await read(c.kind,c,secret,result=>({kind:"courses",courses:courses(result)}));
        if(secret)credentials.put(id,saved.snapshot.connections.find(c=>c.id===id)!.generation,secret);
        return {status:"success",code:null,connectionId:id};
      }catch(error){return failure(error);}
    },
    async setEnabledCourses(id:string,ids:string[]):Promise<GuestSourceActionOutcome>{
      try{
        const c=await connection(id),secret=await credentials.get(id,c.generation);
        const saved=await store.setEnabledCourses(id,ids,c.generation);
        if(secret)credentials.put(id,saved.connections.find(c=>c.id===id)!.generation,secret);
        return {status:"success",code:null,connectionId:id};
      }catch(error){return failure(error);}
    },
    async forgetCredential(id:string):Promise<GuestSourceActionOutcome>{
      credentials.forget(id);
      try{const c=await connection(id);await store.forgetCredential(id,c.generation);return {status:"success",code:null,connectionId:id};}
      catch(error){return failure(error);}
    },
    async disconnect(id:string):Promise<GuestSourceActionOutcome>{
      credentials.forget(id);
      try{const c=await connection(id);await store.disconnect(id,c.generation);return {status:"success",code:null,connectionId:id};}
      catch(error){return failure(error);}
    },
  };
}
