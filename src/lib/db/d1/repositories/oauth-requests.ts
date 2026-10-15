import {currentProviderWork,providerAdmission,withProviderService} from "@/lib/abuse/provider-operation";
import {AbuseStorageUnavailableError} from "@/lib/abuse/types";
import {OperationControlVersionChangedError} from "@/lib/abuse/operation-lock";
import {D1CalendarConnectionRepository} from "./calendar-connections";
import {CalendarSyncError} from "@/lib/calendar/errors";
import "server-only";
import {isSafeReturnTo,safeReturnTo} from "@/lib/auth/return-to";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarProvider} from "@/lib/calendar/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1AbuseControlRepository} from "./abuse-controls";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
} from "@/lib/security/credential-cipher";

export type OAuthProvider=Extract<CalendarProvider,"google"|"microsoft">;

export type RegisteredHostedOAuthRequest={
  controlVersion:number;
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
  control_version:number;
  provider:OAuthProvider;
  code_verifier_envelope:string;
  redirect_uri:string;
  return_to:string;
  connection_id:string|null;
  created_at:string;
  expires_at:string;
};

const TTL_MS=10*60*1000;
export class OAuthControlPausedError extends Error{
  readonly code="AUTH_INITIATION_PAUSED";
  constructor(){super("Calendar authorization is temporarily unavailable.");}
}

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

const admittedRequests=new WeakMap<object,{db:D1DatabaseLike;userId:string}>();
export function claimAdmittedOAuthRequest(db:D1DatabaseLike,scope:UserScope,request:object):boolean{
  const issuer=admittedRequests.get(request);
  if(issuer?.db!==db||issuer.userId!==scope.userId)return false;
  admittedRequests.delete(request);return true;
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
    if(input.connectionId){
      const existing=await new D1CalendarConnectionRepository(this.db,this.scope).getById(input.connectionId);
      if(!existing||existing.provider!==input.provider)throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Calendar connection was not found.");
    }
    if(!(await new D1AbuseControlRepository(this.db).get(`provider:${input.provider}`)).enabled)throw new OAuthControlPausedError();
    if(!currentProviderWork(this.db,this.scope,input.provider,"credential"))return withProviderService(this.db,this.scope,
      {provider:input.provider,operation:"credential",...(input.connectionId?{resourceId:input.connectionId}:{})},()=>this.register(input,now));
    const admission=providerAdmission(this.db,this.scope,input.provider);
    const control=await new D1AbuseControlRepository(this.db).get(`provider:${input.provider}`);
    if(control.version!==admission.controlVersion)throw new OperationControlVersionChangedError();
    if(!control.enabled)throw new OAuthControlPausedError();
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

    const inserted=await this.db.prepare(`
      INSERT INTO oauth_requests(
        user_id,state_hash,provider,code_verifier_envelope,connection_id,
        return_to,redirect_uri,created_at,expires_at,consumed_at,control_version,admitted_at_ms
      ) SELECT ?,?,?,?,?,?,?,?,?,NULL,?,?
        WHERE EXISTS(SELECT 1 FROM abuse_controls WHERE control_key=? AND enabled=1 AND version=?)
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
      admission.controlVersion,
      admission.admittedAtMs,
      `provider:${input.provider}`,
      control.version,
    ).run();
    if(!inserted.success||![0,1].includes(inserted.meta.changes as number))throw new AbuseStorageUnavailableError();
    if(inserted.meta.changes!==1)throw new OAuthControlPausedError();

    return {state,codeChallenge};
  }

  async consume(
    state:string,
    provider:OAuthProvider,
    now:Date=new Date(),
  ):Promise<RegisteredHostedOAuthRequest|null>{
    if(typeof state!=="string"||state.length>2048||!state)return null;
    try{
      const control=await new D1AbuseControlRepository(this.db).get(`provider:${provider}`);
      if(!control.enabled)return null;
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
          AND control_version=? AND admitted_at_ms IS NOT NULL
          AND EXISTS(SELECT 1 FROM abuse_controls WHERE control_key=? AND enabled=1 AND version=?)
      `).bind(
        consumedAt,
        this.scope.userId,
        stateHash,
        provider,
        consumedAt,
        control.version,
        `provider:${provider}`,
        control.version,
      ).run();

      if(!claimed.success||![0,1].includes(claimed.meta.changes as number))throw new AbuseStorageUnavailableError();
      if(claimed.meta.changes!==1)return null;

      const row=await this.db.prepare(`
        SELECT provider,code_verifier_envelope,redirect_uri,return_to,
          connection_id,created_at,expires_at,control_version
        FROM oauth_requests
        WHERE user_id=? AND state_hash=? AND provider=? AND consumed_at=?
      `).bind(
        this.scope.userId,
        stateHash,
        provider,
        consumedAt,
      ).first<Row>();

      if(!row)throw new AbuseStorageUnavailableError();

      const codeVerifier=await decryptCredential({
        envelope:row.code_verifier_envelope,
        userId:this.scope.userId,
        purpose:"oauth_pkce_verifier",
        contextId:stateHash,
      },this.keyring);

      const registered=Object.freeze({
        controlVersion:row.control_version,
        provider:row.provider,
        codeVerifier,
        redirectUri:row.redirect_uri,
        returnTo:row.return_to,
        connectionId:row.connection_id,
        createdAt:row.created_at,
        expiresAt:row.expires_at,
      });
      admittedRequests.set(registered,{db:this.db,userId:this.scope.userId});
      return registered;
    }catch{throw new AbuseStorageUnavailableError();}
  }
}
