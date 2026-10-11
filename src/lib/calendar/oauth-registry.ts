import "server-only";
import {createHash,randomBytes} from "node:crypto";
import {isSafeReturnTo,safeReturnTo} from "@/lib/auth/return-to";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarProvider} from "@/lib/calendar/types";
import {
  D1OAuthRequestRepository,
} from "@/lib/db/d1/repositories/oauth-requests";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";

type OAuthProvider=Extract<CalendarProvider,"google"|"microsoft">;

export type RegisteredOAuthRequest={
  provider:OAuthProvider;
  codeVerifier:string;
  redirectUri:string;
  returnTo:string;
  connectionId:string|null;
  createdAt:string;
  expiresAt:string;
};

type OAuthRequestInput={
  provider:OAuthProvider;
  redirectUri:string;
  returnTo?:string;
  connectionId?:string|null;
};

const TTL_MS=10*60*1000;

type OAuthRegistryGlobal=typeof globalThis&{
  __kairosCalendarOAuthRegistry?:Map<string,RegisteredOAuthRequest>;
};

const registryGlobal=globalThis as OAuthRegistryGlobal;
const registry=registryGlobal.__kairosCalendarOAuthRegistry
  ??(registryGlobal.__kairosCalendarOAuthRegistry=new Map<string,RegisteredOAuthRequest>());

function randomBase64Url(bytes:number):string{
  return randomBytes(bytes).toString("base64url");
}

export function registerOAuthRequest(
  input:OAuthRequestInput,
  now?:Date,
):{state:string;codeChallenge:string};
export function registerOAuthRequest(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  input:OAuthRequestInput,
  now?:Date,
):Promise<{state:string;codeChallenge:string}>;
export function registerOAuthRequest(
  arg1:OAuthRequestInput|D1DatabaseLike,
  arg2?:Date|UserScope,
  arg3?:CredentialKeyring,
  arg4?:OAuthRequestInput,
  arg5?:Date,
):{state:string;codeChallenge:string}|Promise<{state:string;codeChallenge:string}>{
  if("prepare" in arg1){
    return new D1OAuthRequestRepository(
      arg1,
      arg2 as UserScope,
      arg3!,
    ).register(arg4!,arg5);
  }

  const input=arg1;
  const now=arg2 instanceof Date?arg2:new Date();
  const state=randomBase64Url(32);
  const codeVerifier=randomBase64Url(48);
  const expiresAt=new Date(now.getTime()+TTL_MS);
  const requestedReturnTo=input.returnTo??"/sources";
  if(!isSafeReturnTo(requestedReturnTo)){
    throw new Error("OAuth return target must be a safe internal path.");
  }
  registry.set(state,{
    provider:input.provider,
    codeVerifier,
    redirectUri:input.redirectUri,
    returnTo:safeReturnTo(requestedReturnTo,"/sources"),
    connectionId:input.connectionId??null,
    createdAt:now.toISOString(),
    expiresAt:expiresAt.toISOString(),
  });
  return {
    state,
    codeChallenge:createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function consumeOAuthRequest(
  state:string,
  provider:OAuthProvider,
  now?:Date,
):RegisteredOAuthRequest|null;
export function consumeOAuthRequest(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  state:string,
  provider:OAuthProvider,
  now?:Date,
):Promise<RegisteredOAuthRequest|null>;
export function consumeOAuthRequest(
  arg1:string|D1DatabaseLike,
  arg2:OAuthProvider|UserScope,
  arg3?:Date|CredentialKeyring,
  arg4?:string,
  arg5?:OAuthProvider,
  arg6?:Date,
):RegisteredOAuthRequest|null|Promise<RegisteredOAuthRequest|null>{
  if(typeof arg1!=="string"){
    return new D1OAuthRequestRepository(
      arg1,
      arg2 as UserScope,
      arg3 as CredentialKeyring,
    ).consume(arg4!,arg5!,arg6);
  }

  const state=arg1;
  const provider=arg2 as OAuthProvider;
  const now=arg3 instanceof Date?arg3:new Date();
  const request=registry.get(state);
  if(!request)return null;
  if(Date.parse(request.expiresAt)<now.getTime()){
    registry.delete(state);
    return null;
  }
  if(request.provider!==provider)return null;
  registry.delete(state);
  return request;
}

export function resetOAuthRequestRegistryForTests():void{
  registry.clear();
}
