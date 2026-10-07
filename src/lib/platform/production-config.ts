import "server-only";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

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

  if(invalid.size>0){
    throw new ProductionConfigError([...invalid].sort());
  }

  return {
    appUrl:CANONICAL_URL,
    authUrl:CANONICAL_URL,
    database:env.DB as D1DatabaseLike,
    values,
  };
}
