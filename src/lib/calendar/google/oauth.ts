import "server-only";
import {z} from "zod";
import {CalendarSyncError} from "@/lib/calendar/errors";

const GOOGLE_AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL="https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE="https://www.googleapis.com/auth/calendar.app.created";

export type GoogleCalendarConfig={
  clientId:string;
  clientSecret:string|null;
};

export type GoogleTokenResult={
  accessToken:string;
  expiresIn:number;
  refreshToken:string|null;
};

const tokenResponseSchema=z.object({
  access_token:z.string().min(1),
  expires_in:z.number().int().positive(),
  refresh_token:z.string().min(1).optional(),
}).passthrough();

export function getGoogleCalendarConfig(
  env:Record<string,string|undefined>=process.env,
):GoogleCalendarConfig{
  const clientId=env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  if(!clientId){
    throw new CalendarSyncError(
      "CALENDAR_CONFIG_MISSING",
      "Google Calendar client configuration is missing.",
    );
  }
  return {
    clientId,
    clientSecret:env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()||null,
  };
}

export function buildGoogleAuthorizationUrl(input:{
  clientId:string;
  state:string;
  codeChallenge:string;
  redirectUri:string;
}):URL{
  const url=new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id",input.clientId);
  url.searchParams.set("redirect_uri",input.redirectUri);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type","offline");
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
  if(status===401||providerCode==="invalid_grant"){
    return new CalendarSyncError(
      "CALENDAR_AUTH_EXPIRED",
      "Google Calendar authorization is no longer valid.",
    );
  }
  if(status===429){
    return new CalendarSyncError(
      "CALENDAR_RATE_LIMITED",
      "Google Calendar is rate limiting requests.",
    );
  }
  return new CalendarSyncError(
    "CALENDAR_UPSTREAM_ERROR",
    "Google Calendar authorization could not be completed.",
  );
}

async function requestToken(
  params:URLSearchParams,
  fetchImpl:typeof fetch,
):Promise<GoogleTokenResult>{
  let response:Response;
  try{
    response=await fetchImpl(GOOGLE_TOKEN_URL,{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:params,
    });
  }catch{
    throw new CalendarSyncError(
      "CALENDAR_NETWORK_ERROR",
      "Google Calendar authorization could not reach Google.",
    );
  }

  const body=await readJson(response);
  if(!response.ok)throw tokenError(response.status,body);

  const parsed=tokenResponseSchema.safeParse(body);
  if(!parsed.success){
    throw new CalendarSyncError(
      "CALENDAR_UPSTREAM_ERROR",
      "Google Calendar returned an unexpected authorization response.",
    );
  }
  return {
    accessToken:parsed.data.access_token,
    expiresIn:parsed.data.expires_in,
    refreshToken:parsed.data.refresh_token??null,
  };
}

export async function exchangeGoogleAuthorizationCode(
  input:{
    clientId:string;
    clientSecret:string|null;
    code:string;
    codeVerifier:string;
    redirectUri:string;
  },
  fetchImpl:typeof fetch=fetch,
):Promise<GoogleTokenResult>{
  const params=new URLSearchParams({
    client_id:input.clientId,
    code:input.code,
    code_verifier:input.codeVerifier,
    redirect_uri:input.redirectUri,
    grant_type:"authorization_code",
  });
  if(input.clientSecret)params.set("client_secret",input.clientSecret);
  return requestToken(params,fetchImpl);
}

export async function refreshGoogleAccessToken(
  input:{
    clientId:string;
    clientSecret:string|null;
    refreshToken:string;
  },
  fetchImpl:typeof fetch=fetch,
):Promise<GoogleTokenResult>{
  const params=new URLSearchParams({
    client_id:input.clientId,
    refresh_token:input.refreshToken,
    grant_type:"refresh_token",
  });
  if(input.clientSecret)params.set("client_secret",input.clientSecret);
  return requestToken(params,fetchImpl);
}
