import "server-only";
import {isSafeReturnTo,safeReturnTo} from "@/lib/auth/return-to";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarProvider} from "@/lib/calendar/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
} from "@/lib/security/credential-cipher";

export type OAuthProvider=Extract<CalendarProvider,"google"|"microsoft">;

export type RegisteredHostedOAuthRequest={
  provider:OAuthProvider;
  codeVerifier:string;
  redirectUri:string;
  returnTo:string;
  connectionId:string|null;
  createdAt:string;
  expiresAt:string;
};

export type HostedOAuthRequestInput={
  provider:OAuthProvider;
  redirectUri:string;
  returnTo?:string;
  connectionId?:string|null;
};

type Row={
  provider:OAuthProvider;
  code_verifier_envelope:string;
  redirect_uri:string;
  return_to:string;
  connection_id:string|null;
  created_at:string;
  expires_at:string;
};

const TTL_MS=10*60*1000;

function base64Url(bytes:Uint8Array):string{
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/,"");
}

function randomBase64Url(bytes:number):string{
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(value:string):Promise<string>{
  const digest=await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function validateReturnTo(value:string|undefined):string{
  const requested=value??"/sources";
  if(!isSafeReturnTo(requested)){
    throw new Error("OAuth return target must be a safe internal path.");
  }
  return safeReturnTo(requested,"/sources");
}

export class D1OAuthRequestRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
    private readonly keyring:CredentialKeyring,
  ){}

  async register(
    input:HostedOAuthRequestInput,
    now:Date=new Date(),
  ):Promise<{state:string;codeChallenge:string}>{
    const state=randomBase64Url(32);
    const codeVerifier=randomBase64Url(48);
    const stateHash=await sha256Base64Url(state);
    const codeChallenge=await sha256Base64Url(codeVerifier);
    const createdAt=now.toISOString();
    const expiresAt=new Date(now.getTime()+TTL_MS).toISOString();
    const returnTo=validateReturnTo(input.returnTo);
    const envelope=await encryptCredential({
      plaintext:codeVerifier,
      userId:this.scope.userId,
      purpose:"oauth_pkce_verifier",
      contextId:stateHash,
    },this.keyring);

    await this.db.prepare(`
      INSERT INTO oauth_requests(
        user_id,state_hash,provider,code_verifier_envelope,connection_id,
        return_to,redirect_uri,created_at,expires_at,consumed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,NULL)
    `).bind(
      this.scope.userId,
      stateHash,
      input.provider,
      envelope,
      input.connectionId??null,
      returnTo,
      input.redirectUri,
      createdAt,
      expiresAt,
    ).run();

    return {state,codeChallenge};
  }

  async consume(
    state:string,
    provider:OAuthProvider,
    now:Date=new Date(),
  ):Promise<RegisteredHostedOAuthRequest|null>{
    const stateHash=await sha256Base64Url(state);
    const consumedAt=now.toISOString();

    const claimed=await this.db.prepare(`
      UPDATE oauth_requests
      SET consumed_at=?
      WHERE user_id=?
        AND state_hash=?
        AND provider=?
        AND consumed_at IS NULL
        AND expires_at>=?
    `).bind(
      consumedAt,
      this.scope.userId,
      stateHash,
      provider,
      consumedAt,
    ).run();

    if((claimed.meta.changes??0)!==1)return null;

    const row=await this.db.prepare(`
      SELECT provider,code_verifier_envelope,redirect_uri,return_to,
        connection_id,created_at,expires_at
      FROM oauth_requests
      WHERE user_id=? AND state_hash=? AND provider=? AND consumed_at=?
    `).bind(
      this.scope.userId,
      stateHash,
      provider,
      consumedAt,
    ).first<Row>();

    if(!row)return null;

    const codeVerifier=await decryptCredential({
      envelope:row.code_verifier_envelope,
      userId:this.scope.userId,
      purpose:"oauth_pkce_verifier",
      contextId:stateHash,
    },this.keyring);

    return {
      provider:row.provider,
      codeVerifier,
      redirectUri:row.redirect_uri,
      returnTo:row.return_to,
      connectionId:row.connection_id,
      createdAt:row.created_at,
      expiresAt:row.expires_at,
    };
  }
}
