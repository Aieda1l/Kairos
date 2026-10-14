import "server-only";
import {
  requireUserScope,
  type UserScope,
} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import {credentialKeyringFromBindings} from '@/lib/security/keyring-environment';

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
  KAIROS_CREDENTIAL_KEY_V2?:string;
  KAIROS_CREDENTIAL_ACTIVE_KEY_ID?:string;
};

export function credentialKeyringFromEnvironment(
  value:string,
):CredentialKeyring{
  return credentialKeyringFromBindings({KAIROS_CREDENTIAL_KEY_V1:value});
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
  const encodedKey=runtime.KAIROS_CREDENTIAL_KEY_V1
    ??process.env.KAIROS_CREDENTIAL_KEY_V1;
  return resolveSourceRuntimeContext({
    db:runtime.DB,
    keyring:credentialKeyringFromBindings({
      KAIROS_CREDENTIAL_KEY_V1:encodedKey,
      KAIROS_CREDENTIAL_KEY_V2:runtime.KAIROS_CREDENTIAL_KEY_V2??process.env.KAIROS_CREDENTIAL_KEY_V2,
      KAIROS_CREDENTIAL_ACTIVE_KEY_ID:runtime.KAIROS_CREDENTIAL_ACTIVE_KEY_ID??process.env.KAIROS_CREDENTIAL_ACTIVE_KEY_ID,
    }),
  });
}
