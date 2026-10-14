import "server-only";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {abuseKeyFromEnvironment} from "@/lib/abuse/keys";
import {policyFromEnvironment} from "@/lib/abuse/policy";
import type {AbusePolicy,TrustedIngress} from "@/lib/abuse/types";
import {credentialKeyringFromBindings} from '@/lib/security/keyring-environment';

const CANONICAL_URL="https://mykairos.me";

const REQUIRED_STRINGS=[
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "MICROSOFT_CALENDAR_CLIENT_ID",
  "MICROSOFT_CALENDAR_CLIENT_SECRET",
  "MICROSOFT_CALENDAR_TENANT",
  "KAIROS_CREDENTIAL_KEY_V1",
  "KAIROS_TURNSTILE_SITE_KEY",
  "KAIROS_TURNSTILE_SECRET_KEY",
  "KAIROS_ABUSE_KEY_V1",
] as const;

export class ProductionConfigError extends Error{
  readonly code="PRODUCTION_CONFIG_INVALID";

  constructor(readonly fields:string[]){
    super(`Production configuration is invalid: ${fields.join(", ")}.`);
    this.name="ProductionConfigError";
  }
}

export type ProductionConfig={
  appUrl:typeof CANONICAL_URL;
  authUrl:typeof CANONICAL_URL;
  database:D1DatabaseLike;
  values:Record<(typeof REQUIRED_STRINGS)[number],string>;
  abusePolicy:AbusePolicy;
  trustedIngress:TrustedIngress;
};

function hasD1Shape(value:unknown):value is D1DatabaseLike{
  return typeof value==="object"
    && value!==null
    && "prepare" in value
    && typeof (value as {prepare?:unknown}).prepare==="function";
}

export function validateProductionConfig(
  env:Record<string,unknown>,
):ProductionConfig{
  const invalid=new Set<string>();
  if(env.KAIROS_APP_URL!==CANONICAL_URL)invalid.add("KAIROS_APP_URL");
  if(env.AUTH_URL!==CANONICAL_URL)invalid.add("AUTH_URL");
  if(!hasD1Shape(env.DB))invalid.add("DB");

  const values={} as ProductionConfig["values"];
  for(const name of REQUIRED_STRINGS){
    const value=env[name];
    if(typeof value!=="string"||value.trim().length===0){
      invalid.add(name);
      continue;
    }
    values[name]=value.trim();
  }

  try{
    abuseKeyFromEnvironment(env.KAIROS_ABUSE_KEY_V1,env.KAIROS_CREDENTIAL_KEY_V1);
    if(env.KAIROS_CREDENTIAL_KEY_V2!==undefined&&env.KAIROS_CREDENTIAL_KEY_V2!==''){
      abuseKeyFromEnvironment(env.KAIROS_ABUSE_KEY_V1,env.KAIROS_CREDENTIAL_KEY_V2);
    }
  }catch{invalid.add("KAIROS_ABUSE_KEY_V1");}
  try{credentialKeyringFromBindings(env);}catch{invalid.add('KAIROS_CREDENTIAL_KEYRING');}
  for(const name of ["KAIROS_TURNSTILE_SITE_KEY","KAIROS_TURNSTILE_SECRET_KEY"]){
    if(typeof env[name]==="string"&&(env[name] as string).length>4096)invalid.add(name);
  }
  let abusePolicy:AbusePolicy|undefined;
  try{abusePolicy=policyFromEnvironment(env);}catch{invalid.add("KAIROS_ABUSE_BUDGETS");}
  const trustedIngress=env.KAIROS_ABUSE_TRUSTED_INGRESS??"none";
  if(trustedIngress!=="none"&&trustedIngress!=="cloudflare")invalid.add("KAIROS_ABUSE_TRUSTED_INGRESS");

  if(invalid.size>0){
    throw new ProductionConfigError([...invalid].sort());
  }

  return {
    appUrl:CANONICAL_URL,
    authUrl:CANONICAL_URL,
    database:env.DB as D1DatabaseLike,
    values,
    abusePolicy:abusePolicy!,
    trustedIngress:trustedIngress as TrustedIngress,
  };
}
