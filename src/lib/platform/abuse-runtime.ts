import "server-only";
import {abuseKeyFromEnvironment} from "@/lib/abuse/keys";
import {policyFromEnvironment} from "@/lib/abuse/policy";
import {AbuseConfigurationError,type AbuseRuntime,type TrustedIngress} from "@/lib/abuse/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {canonicalAppOrigin} from "@/lib/security/request-origin";

export function resolveAbuseRuntime(env:Record<string,unknown>,fetchImpl:typeof fetch=fetch):AbuseRuntime{
  try{
    const db=env.DB as D1DatabaseLike|undefined;
    if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function"||typeof db.exec!=="function")throw new AbuseConfigurationError();
    for(const name of ["KAIROS_TURNSTILE_SITE_KEY","KAIROS_TURNSTILE_SECRET_KEY"]){
      if(typeof env[name]!=="string"||!(env[name] as string).trim()||(env[name] as string).length>4096)throw new AbuseConfigurationError();
    }
    const hmacKey=abuseKeyFromEnvironment(env.KAIROS_ABUSE_KEY_V1,env.KAIROS_CREDENTIAL_KEY_V1);
    const origin=canonicalAppOrigin(env);
    const ingress=env.KAIROS_ABUSE_TRUSTED_INGRESS??"none";
    if(ingress!=="none"&&ingress!=="cloudflare"&&!(ingress==="loopback"&&env.KAIROS_LOCAL_AUTH==="loopback"))throw new AbuseConfigurationError();
    return {db,hmacKey,turnstileSecret:(env.KAIROS_TURNSTILE_SECRET_KEY as string).trim(),appOrigin:origin.origin,
      hostname:origin.hostname,fetchImpl,policy:policyFromEnvironment(env),trustedIngress:ingress as TrustedIngress};
  }catch{throw new AbuseConfigurationError();}
}

// Importing ordinary auth/session/read modules does not load or validate abuse
// bindings. Only callers about to perform guarded work request this runtime.
export async function getAbuseRuntime():Promise<AbuseRuntime>{
  try{
    const {env}=await import("cloudflare:workers");
    return resolveAbuseRuntime(env as unknown as Record<string,unknown>);
  }catch{throw new AbuseConfigurationError();}
}
