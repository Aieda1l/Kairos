import "server-only";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

export const DEFAULT_E2E_USER_ID="kairos-e2e-user";

export type E2EFixtureRuntime={
  db:D1DatabaseLike;
  userId:string;
};

export async function getE2EFixtureRuntime():Promise<E2EFixtureRuntime|null>{
  let workerEnv:Record<string,unknown>={};
  try{
    const {env}=await import("cloudflare:workers");
    workerEnv=env;
  }catch{
    return null;
  }

  const enabled=process.env.E2E_FIXTURES==="1"
    ||workerEnv.E2E_FIXTURES==="1";
  if(!enabled)return null;

  const db=workerEnv.DB as D1DatabaseLike|undefined;
  if(!db)throw new Error("E2E fixture D1 binding is unavailable.");

  const configured=
    process.env.KAIROS_E2E_USER_ID
    ??(typeof workerEnv.KAIROS_E2E_USER_ID==="string"
      ?workerEnv.KAIROS_E2E_USER_ID
      :undefined);

  return {
    db,
    userId:configured?.trim()||DEFAULT_E2E_USER_ID,
  };
}
