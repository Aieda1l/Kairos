import "server-only";
import {
  requireUserScope,
  type UserScope,
} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";

type SessionGetter=Parameters<typeof requireUserScope>[0];

export type SourceRuntimeContext={
  db:D1DatabaseLike;
  scope:UserScope;
  keyring:CredentialKeyring;
};

export type ResolveSourceRuntimeInput={
  db:D1DatabaseLike;
  keyring:CredentialKeyring;
  getSession?:SessionGetter;
};

type SourceWorkerEnvironment={
  DB:D1DatabaseLike;
  KAIROS_CREDENTIAL_KEY_V1:string;
};

function decodeBase64Url(value:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(value)){
    throw new Error("KAIROS_CREDENTIAL_KEY_V1 must be base64url encoded.");
  }
  const padded=value.replace(/-/g,"+").replace(/_/g,"/")
    +"=".repeat((4-value.length%4)%4);
  const binary=atob(padded);
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}

export function credentialKeyringFromEnvironment(
  value:string,
):CredentialKeyring{
  const key=decodeBase64Url(value);
  if(key.byteLength!==32){
    throw new Error("KAIROS_CREDENTIAL_KEY_V1 must decode to exactly 32 bytes.");
  }
  return {
    activeKeyId:"v1",
    keys:{v1:key},
  };
}

export async function resolveSourceRuntimeContext(
  input:ResolveSourceRuntimeInput,
):Promise<SourceRuntimeContext>{
  const scope=await requireUserScope(input.getSession);
  return {db:input.db,scope,keyring:input.keyring};
}

export async function getSourceRuntimeContext():Promise<SourceRuntimeContext>{
  const {env}=await import("cloudflare:workers");
  const runtime=env as unknown as SourceWorkerEnvironment;
  return resolveSourceRuntimeContext({
    db:runtime.DB,
    keyring:credentialKeyringFromEnvironment(runtime.KAIROS_CREDENTIAL_KEY_V1),
  });
}
