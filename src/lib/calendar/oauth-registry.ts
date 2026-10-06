import "server-only";
import {createHash,randomBytes} from "node:crypto";
import type {CalendarProvider} from "@/lib/calendar/types";

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
  now:Date=new Date(),
):{state:string;codeChallenge:string}{
  const state=randomBase64Url(32);
  const codeVerifier=randomBase64Url(48);
  const expiresAt=new Date(now.getTime()+TTL_MS);
  registry.set(state,{
    provider:input.provider,
    codeVerifier,
    redirectUri:input.redirectUri,
    returnTo:input.returnTo??"/sources",
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
  now:Date=new Date(),
):RegisteredOAuthRequest|null{
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
