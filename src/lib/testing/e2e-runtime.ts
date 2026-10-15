import "server-only";
import {
  AuthenticationRequiredError,
  requireUserScope,
} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {isLocalFixtureEnvironment} from './auth-transport';

export type E2EFixtureRuntime={
  db:D1DatabaseLike;
};

export async function getE2EFixtureRuntime(request:Request):Promise<E2EFixtureRuntime|null>{
  let workerEnv:Record<string,unknown>={};
  try{
    const {env}=await import("cloudflare:workers");
    workerEnv=env;
  }catch{
    return null;
  }

  const enabled=process.env.E2E_FIXTURES==="1"
    ||workerEnv.E2E_FIXTURES==="1";
  if(!enabled||!isLocalFixtureEnvironment({...workerEnv,E2E_FIXTURES:'1'}))return null;
  const incoming=new URL(request.url),canonical=new URL(String(workerEnv.KAIROS_APP_URL));
  if(incoming.protocol!=='http:'||!['localhost','127.0.0.1'].includes(incoming.hostname)||incoming.port!==canonical.port)return null;

  const db=workerEnv.DB as D1DatabaseLike|undefined;
  if(!db)throw new Error("E2E fixture D1 binding is unavailable.");

  return {db};
}

export async function getAuthenticatedE2EFixtureRuntime(request:Request):Promise<
  (E2EFixtureRuntime&{userId:string})|null
>{
  const runtime=await getE2EFixtureRuntime(request);
  if(!runtime)return null;
  try{
    const scope=await requireUserScope();
    return {...runtime,userId:scope.userId};
  }catch(error){
    if(error instanceof AuthenticationRequiredError)return null;
    throw error;
  }
}
