import "server-only";
import {enforceBudget,abuseErrorResponse} from "@/lib/abuse/guard";
import {deriveAbuseSubkey,hashRateKey,trustedClientNetwork} from "@/lib/abuse/keys";
import {AbuseClientAddressError,type AbuseRuntime,type IdentityProvider} from "@/lib/abuse/types";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";
import {D1RateLimitRepository} from "@/lib/db/d1/repositories/rate-limits";
import {getAbuseRuntime} from "@/lib/platform/abuse-runtime";
import {enforceRequestOrigin,isLoopbackOrigin,RequestOriginError} from "@/lib/security/request-origin";
import {createOperationContext,getOperationContext,operationDataField,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent,type OperationOutcome} from "@/lib/operations/events";
import {AuthChallengeError,verifyTurnstile} from "./turnstile";
import {hasAuthDiagnosticFailure,runWithAuthOutcomeOwner} from "./diagnostics";

export type {IdentityProvider};
export type AuthAttempt={provider:IdentityProvider;version:number;expiresAt:number;nonce:string};
export type AuthActionState={code:string;message:string;retryAfterSeconds?:number};
export class AuthAdmissionError extends Error{
  constructor(readonly code:"AUTH_PROVIDER_INVALID"|"AUTH_INITIATION_PAUSED"|"AUTH_ATTEMPT_INVALID"){
    super(code==="AUTH_INITIATION_PAUSED"?"Sign-in is temporarily unavailable. Try again later.":"Sign-in could not be completed. Please try again.");
  }
}
export function identityProvider(value:unknown):IdentityProvider{
  if(value!=="google"&&value!=="microsoft-entra-id")throw new AuthAdmissionError("AUTH_PROVIDER_INVALID");
  return value;
}
export function attemptCookieName(provider:IdentityProvider):string{return `kairos.auth-attempt.${provider}`;}
export function attemptCookieOptions(runtime:AbuseRuntime){
  return {httpOnly:true,secure:new URL(runtime.appOrigin).protocol==="https:",sameSite:"lax" as const,path:"/api/auth/callback",maxAge:600};
}
function requestOriginMatches(url:URL,runtime:AbuseRuntime):boolean{
  if(url.origin===runtime.appOrigin)return true;
  const canonical=new URL(runtime.appOrigin);
  // NextRequest normalizes numeric loopback hosts to localhost. Only the paired
  // server-selected loopback mode accepts this alias; Origin remains exact.
  return runtime.trustedIngress==="loopback"&&isLoopbackOrigin(url)&&isLoopbackOrigin(canonical)
    &&url.protocol===canonical.protocol&&url.port===canonical.port;
}
export async function enforcePublicAuthInitiation(runtime:AbuseRuntime,provider:IdentityProvider,headers:Headers,formData:FormData):Promise<AuthAttempt>{
  enforceRequestOrigin(headers,runtime.appOrigin);
  identityProvider(provider);
  if(headers.has("cf-worker"))throw new AbuseClientAddressError();
  const repo=new D1AbuseControlRepository(runtime.db);
  if(!(await repo.get("auth:initiation")).enabled)throw new AuthAdmissionError("AUTH_INITIATION_PAUSED");
  const control=await repo.get(`auth:${provider}`);
  if(!control.enabled)throw new AuthAdmissionError("AUTH_INITIATION_PAUSED");
  const network=runtime.trustedIngress==="loopback"&&isLoopbackOrigin(new URL(runtime.appOrigin))
    ?"ipv4:127.0.0.1":trustedClientNetwork(headers,runtime.trustedIngress??"none");
  await enforceBudget(runtime,{class:"auth-initiation",provider,network});
  const values=formData.getAll("cf-turnstile-response");
  if(values.length!==1||typeof values[0]!=="string")throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");
  await verifyTurnstile({token:values[0],expectedHostname:runtime.hostname,expectedAction:provider==="google"?"auth_google":"auth_microsoft"},
    {secret:runtime.turnstileSecret,fetchImpl:runtime.fetchImpl});
  return {provider,version:control.version,expiresAt:Date.now()+600_000,nonce:crypto.randomUUID()};
}
function encode(bytes:Uint8Array):string{return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function decode(value:string):Uint8Array{return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4)),char=>char.charCodeAt(0));}
async function stampKey(runtime:AbuseRuntime):Promise<CryptoKey>{
  return crypto.subtle.importKey("raw",new Uint8Array(await deriveAbuseSubkey(runtime.hmacKey,"auth-attempt")).buffer,{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function stateDigest(state:string):Promise<string>{return encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(state))));}
export async function signAuthAttempt(runtime:AbuseRuntime,attempt:AuthAttempt,state:string):Promise<string>{
  if(!state||state.length>4096)throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
  const payload=encode(new TextEncoder().encode(JSON.stringify({...attempt,stateHash:await stateDigest(state)})));
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC",await stampKey(runtime),new TextEncoder().encode(payload))))}`;
}
export async function consumeAuthAttempt(runtime:AbuseRuntime,provider:IdentityProvider,headers:Headers,state:string):Promise<void>{
  const name=attemptCookieName(provider);
  const values=(headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(name+"="));
  try{
    if(values.length!==1||!state||state.length>4096)throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
    const value=values[0].slice(name.length+1);
    if(value.length>1024||!/^[-\w]+\.[-\w]{43}$/.test(value))throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
    const [payload,signature]=value.split(".");
    if(encode(decode(signature))!==signature||encode(decode(payload))!==payload
      ||!await crypto.subtle.verify("HMAC",await stampKey(runtime),new Uint8Array(decode(signature)).buffer,new TextEncoder().encode(payload)))throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
    const attempt=JSON.parse(new TextDecoder().decode(decode(payload)));
    if(attempt.provider!==provider||!Number.isSafeInteger(attempt.version)||attempt.version<0
      ||!Number.isSafeInteger(attempt.expiresAt)||attempt.expiresAt<=Date.now()||attempt.expiresAt>Date.now()+600_000
      ||typeof attempt.nonce!=="string"||!/^[0-9a-f-]{36}$/.test(attempt.nonce)
      ||attempt.stateHash!==await stateDigest(state))throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
    const control=await new D1AbuseControlRepository(runtime.db).get(`auth:${provider}`);
    if(!control.enabled||control.version!==attempt.version)throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
    // Durable one-use claim reuses B1 storage. Only a domain-separated nonce hash is retained.
    const keyHash=await hashRateKey(runtime.hmacKey,["auth-attempt-spent",provider,attempt.nonce]);
    const decision=await new D1RateLimitRepository(runtime.db).consume({keyHash,userId:null,limit:1,windowSeconds:600});
    if(!decision.allowed)throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
  }catch(error){
    if(abuseErrorResponse(error)?.status===503)throw error;
    throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
  }
}
export function authFailureResponse(error:unknown):Response{
  const abuse=abuseErrorResponse(error);if(abuse)return abuse;
  const known=error instanceof AuthAdmissionError||error instanceof AuthChallengeError||error instanceof RequestOriginError;
  const code=known?error.code:"AUTH_FAILED";
  const status=code==="UNTRUSTED_ORIGIN"?403:code==="AUTH_INITIATION_PAUSED"||code==="AUTH_CHALLENGE_UNAVAILABLE"?503:400;
  return Response.json({code,message:known?error.message:"Sign-in could not be completed. Please try again."},{status,headers:{"cache-control":"no-store"}});
}
export function emitAuthOutcome(response:Response,provider?:IdentityProvider,success:OperationOutcome["code"]="AUTH_SIGNED_IN"):void{
  const code=response.status===429?"RATE_LIMITED":response.status>=500?"SERVICE_UNAVAILABLE":response.status>=400?"AUTH_REJECTED":success;
  emitOperationEvent(getOperationContext()!,{code,result:code===success&&success!=="AUTH_FAILED"?"ok":response.status>=500||success==="AUTH_FAILED"?"error":"rejected",
    ...(provider?{provider:provider==="google"?"google":"microsoft"}:{}),status:response.status});
}
export function normalizeAuthDestination(value:string,origin:string):{url:string;failed:boolean}{
  const url=new URL(value,origin);
  if(url.origin===origin&&(url.searchParams.has("error")||url.pathname==="/api/auth/error"))return {url:`${origin}/sign-in?error=AUTH_FAILED`,failed:true};
  return {url:value,failed:false};
}
/** Inspect Auth.js's result without serializing it or requiring abuse bindings. */
export async function classifySignOutResult(input:unknown,confirmation=false):Promise<{
  status:number;code:"AUTH_REQUIRED"|"AUTH_FAILED"|"AUTH_SIGNED_OUT";redirect?:string;
}>{
  let status=200,destination:unknown;
  if(input instanceof Response){
    status=input.status;destination=input.headers.get("location");
    if(!destination&&input.headers.get("content-type")?.includes("application/json")){
      destination=operationDataField(await input.clone().json().catch(()=>null),"url");
    }
  }else{
    const candidate=operationDataField(input,"status");
    if(typeof candidate==="number"&&Number.isInteger(candidate)&&candidate>=100&&candidate<=599)status=candidate;
    destination=operationDataField(input,"redirect");
  }
  let failed=status>=400||hasAuthDiagnosticFailure();
  if(typeof destination==="string"&&destination){
    try{
      // The base is only for parsing relative destinations; it selects no redirect origin.
      const url=new URL(destination,"https://kairos.invalid");
      // Application return queries do not describe the completed logout's outcome.
      // Configured error pages are covered by the retained Auth.js diagnostic bit.
      failed||=url.pathname==="/api/auth/error";
    }catch{failed=true;}
  }else if(!confirmation){failed=true;}
  return {status,code:failed?"AUTH_FAILED":confirmation?"AUTH_REQUIRED":"AUTH_SIGNED_OUT",
    ...(typeof destination==="string"?{redirect:destination}:{})};
}
async function normalizeResponse(response:Response,origin:string):Promise<{response:Response;failed:boolean;destination:string|null}>{
  const location=response.headers.get("location");
  if(location){
    const normalized=normalizeAuthDestination(location,origin);
    const headers=new Headers(response.headers);headers.set("location",normalized.url);
    return {response:new Response(response.body,{status:response.status,headers}),failed:normalized.failed,destination:normalized.url};
  }
  if(response.headers.get("content-type")?.includes("application/json")){
    const data=await response.clone().json().catch(()=>null);
    if(data&&typeof data.url==="string"){
      const normalized=normalizeAuthDestination(data.url,origin);
      return {response:Response.json({url:normalized.url},{status:response.status,headers:response.headers}),failed:normalized.failed,destination:normalized.url};
    }
  }
  return {response,failed:response.status>=400,destination:null};
}
export async function guardAuthRequest(request:Request,handler:(request:Request)=>Promise<Response>):Promise<Response>{
  const url=new URL(request.url),parts=url.pathname.split("/").slice(3);
  if(!/^\/api\/auth\/(?:signin|callback|signout|session|csrf|providers|error)(?:\/(?:google|microsoft-entra-id))?$/.test(url.pathname)){
    return runWithOperationContext(createOperationContext("auth.sign_in"),async()=>{
      const response=authFailureResponse(new AuthAdmissionError("AUTH_PROVIDER_INVALID"));
      emitAuthOutcome(response);return response;
    });
  }
  const action=parts[0],slug=parts[1];
  if(action==="signin"&&request.method==="GET"){
    return runWithOperationContext(createOperationContext("auth.sign_in"),async()=>{
      const response=!slug?new Response(null,{status:303,headers:{location:"/sign-in","cache-control":"no-store"}})
        :Response.json({code:"AUTH_INITIATION_REQUIRES_POST",message:"Sign-in requires a verified form submission."},{status:405,headers:{allow:"POST","cache-control":"no-store"}});
      emitAuthOutcome(response,slug?identityProvider(slug):undefined,"AUTH_REQUIRED");return response;
    });
  }
  if(action!=="signin"&&action!=="callback"&&action!=="signout"&&action!=="error")return handler(request);
  const context=createOperationContext(action==="callback"?"auth.callback":action==="signout"?"auth.sign_out":"auth.sign_in");
  return runWithOperationContext(context,()=>runWithAuthOutcomeOwner(async()=>{
    let provider:IdentityProvider|undefined,runtime:AbuseRuntime|undefined;
    let callback=false;
    try{
      if(action==="signout"){
        const response=await handler(request);
        const outcome=await classifySignOutResult(response,request.method!=="POST");
        emitAuthOutcome(response,undefined,outcome.code);return response;
      }
      runtime=await getAbuseRuntime();
      if(action==="error"){
        const response=new Response(null,{status:303,headers:{location:`${runtime.appOrigin}/sign-in?error=AUTH_FAILED`,"cache-control":"no-store"}});
        emitAuthOutcome(response,undefined,"AUTH_FAILED");return response;
      }
      provider=identityProvider(slug);if(parts.length!==2)throw new AuthAdmissionError("AUTH_PROVIDER_INVALID");
      let attempt:AuthAttempt|undefined;
      if(action==="signin"){
        if(request.method!=="POST")throw new AuthAdmissionError("AUTH_PROVIDER_INVALID");
        // Explicit origin before parsing the untrusted body; Auth.js sees the original request.
        enforceRequestOrigin(request.headers,runtime.appOrigin);
        if(!requestOriginMatches(url,runtime))throw new RequestOriginError();
        const reader=request.clone().body?.getReader();
        if(!reader)throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");
        const chunks:Uint8Array[]=[];let size=0;
        try{
          while(true){
            const chunk=await reader.read();if(chunk.done)break;
            size+=chunk.value.byteLength;if(size>16_384)throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");
            chunks.push(chunk.value);
          }
        }finally{void reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(size);let offset=0;
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const data=await new Response(bytes,{headers:{"content-type":request.headers.get("content-type")??""}}).formData()
          .catch(()=>{throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");});
        attempt=await enforcePublicAuthInitiation(runtime,provider,request.headers,data);
      }else{
        callback=true;
        // Both configured identity providers use query callbacks. No broad callback exemption.
        if(request.method!=="GET"||!requestOriginMatches(url,runtime)||url.searchParams.getAll("state").length!==1)throw new AuthAdmissionError("AUTH_ATTEMPT_INVALID");
        await consumeAuthAttempt(runtime,provider,request.headers,url.searchParams.get("state")??"");
      }
      const normalized=await normalizeResponse(await handler(request),runtime.appOrigin);
      const responseHeaders=new Headers(normalized.response.headers);
      if(attempt&&!normalized.failed&&normalized.destination){
        const state=new URL(normalized.destination,runtime.appOrigin).searchParams.get("state");
        if(state){
          const stamp=await signAuthAttempt(runtime,attempt,state);
          responseHeaders.append("set-cookie",`${attemptCookieName(provider)}=${stamp}; Path=/api/auth/callback; HttpOnly; ${attemptCookieOptions(runtime).secure?"Secure; ":""}SameSite=Lax; Max-Age=600`);
        }
      }
      if(callback)responseHeaders.append("set-cookie",`${attemptCookieName(provider)}=; Path=/api/auth/callback; HttpOnly; ${attemptCookieOptions(runtime).secure?"Secure; ":""}SameSite=Lax; Max-Age=0`);
      responseHeaders.set("cache-control","no-store");
      const response=new Response(normalized.response.body,{status:normalized.response.status,headers:responseHeaders});
      emitAuthOutcome(response,provider,normalized.failed?"AUTH_FAILED":action==="callback"?"AUTH_SIGNED_IN":"AUTH_REQUIRED");
      return response;
    }catch(error){
      const response=authFailureResponse(error);
      if(callback&&provider)response.headers.append("set-cookie",`${attemptCookieName(provider)}=; Path=/api/auth/callback; HttpOnly; ${!runtime||attemptCookieOptions(runtime).secure?"Secure; ":""}SameSite=Lax; Max-Age=0`);
      emitAuthOutcome(response,provider);return response;
    }
  }));
}
