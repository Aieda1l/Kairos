import "server-only";
import {z} from "zod";
import {CalendarSyncError} from "@/lib/calendar/errors";

const MICROSOFT_SCOPE="offline_access Calendars.ReadWrite";

export type MicrosoftCalendarConfig={
  clientId:string;
  tenant:string;
};

export type MicrosoftTokenResult={
  accessToken:string;
  expiresIn:number;
  refreshToken:string|null;
};

const tokenResponseSchema=z.object({
  access_token:z.string().min(1),
  expires_in:z.number().int().positive(),
  refresh_token:z.string().min(1).optional(),
}).passthrough();

function tenantSegment(tenant:string):string{
  const trimmed=tenant.trim();
  if(!trimmed||!/^[A-Za-z0-9._-]+$/.test(trimmed)){
    throw new CalendarSyncError("CALENDAR_CONFIG_MISSING","Microsoft Calendar tenant configuration is invalid.");
  }
  return trimmed;
}

function tokenUrl(tenant:string):string{
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantSegment(tenant))}/oauth2/v2.0/token`;
}

export function getMicrosoftCalendarConfig(
  env:Record<string,string|undefined>=process.env,
):MicrosoftCalendarConfig{
  const clientId=env.MICROSOFT_CALENDAR_CLIENT_ID?.trim();
  if(!clientId){
    throw new CalendarSyncError(
      "CALENDAR_CONFIG_MISSING",
      "Microsoft Calendar client configuration is missing.",
    );
  }
  return {
    clientId,
    tenant:tenantSegment(env.MICROSOFT_CALENDAR_TENANT?.trim()||"common"),
  };
}

export function buildMicrosoftAuthorizationUrl(input:{
  clientId:string;
  tenant:string;
  state:string;
  codeChallenge:string;
  redirectUri:string;
}):URL{
  const url=new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantSegment(input.tenant))}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id",input.clientId);
  url.searchParams.set("redirect_uri",input.redirectUri);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",MICROSOFT_SCOPE);
  url.searchParams.set("state",input.state);
  url.searchParams.set("code_challenge",input.codeChallenge);
  url.searchParams.set("code_challenge_method","S256");
  return url;
}

async function readJson(response:Response):Promise<unknown>{
  try{return await response.json();}catch{return null;}
}

function tokenError(status:number,body:unknown):CalendarSyncError{
  const providerCode=
    body&&typeof body==="object"&&"error" in body&&typeof body.error==="string"
      ?body.error
      :null;
  if(status===401||providerCode==="invalid_grant"||providerCode==="invalid_client"){
    return new CalendarSyncError(
      "CALENDAR_AUTH_EXPIRED",
      "Microsoft Calendar authorization is no longer valid.",
    );
  }
  if(status===429){
    return new CalendarSyncError(
      "CALENDAR_RATE_LIMITED",
      "Microsoft Calendar is rate limiting requests.",
    );
  }
  return new CalendarSyncError(
    "CALENDAR_UPSTREAM_ERROR",
    "Microsoft Calendar authorization could not be completed.",
  );
}

async function requestToken(
  tenant:string,
  params:URLSearchParams,
  fetchImpl:typeof fetch,
):Promise<MicrosoftTokenResult>{
  let response:Response;
  try{
    response=await fetchImpl(tokenUrl(tenant),{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:params,
    });
  }catch{
    throw new CalendarSyncError(
      "CALENDAR_NETWORK_ERROR",
      "Microsoft Calendar authorization could not reach Microsoft.",
    );
  }
  const body=await readJson(response);
  if(!response.ok)throw tokenError(response.status,body);
  const parsed=tokenResponseSchema.safeParse(body);
  if(!parsed.success){
    throw new CalendarSyncError(
      "CALENDAR_UPSTREAM_ERROR",
      "Microsoft Calendar returned an unexpected authorization response.",
    );
  }
  return {
    accessToken:parsed.data.access_token,
    expiresIn:parsed.data.expires_in,
    refreshToken:parsed.data.refresh_token??null,
  };
}

export function exchangeMicrosoftAuthorizationCode(
  input:{
    clientId:string;
    tenant:string;
    code:string;
    codeVerifier:string;
    redirectUri:string;
  },
  fetchImpl:typeof fetch=fetch,
):Promise<MicrosoftTokenResult>{
  return requestToken(input.tenant,new URLSearchParams({
    client_id:input.clientId,
    grant_type:"authorization_code",
    scope:MICROSOFT_SCOPE,
    code:input.code,
    code_verifier:input.codeVerifier,
    redirect_uri:input.redirectUri,
  }),fetchImpl);
}

export function refreshMicrosoftAccessToken(
  input:{
    clientId:string;
    tenant:string;
    refreshToken:string;
  },
  fetchImpl:typeof fetch=fetch,
):Promise<MicrosoftTokenResult>{
  return requestToken(input.tenant,new URLSearchParams({
    client_id:input.clientId,
    grant_type:"refresh_token",
    scope:MICROSOFT_SCOPE,
    refresh_token:input.refreshToken,
  }),fetchImpl);
}
