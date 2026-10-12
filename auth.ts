import "server-only";
import NextAuth from "next-auth";
import {NextRequest} from "next/server";
import {headers as nextHeaders,cookies} from "next/headers";
import {redirect} from "next/navigation";
import {safeReturnTo} from "./src/lib/auth/return-to";
import {getAbuseRuntime} from "./src/lib/platform/abuse-runtime";
import {attemptCookieName,attemptCookieOptions,authFailureResponse,classifySignOutResult,emitAuthOutcome,enforcePublicAuthInitiation,guardAuthRequest,
  normalizeAuthDestination,signAuthAttempt,type AuthActionState,type IdentityProvider} from "./src/lib/auth/initiation";
import {createOperationContext,runWithOperationContext} from "./src/lib/operations/context";
import {runWithAuthOutcomeOwner} from "./src/lib/auth/diagnostics";
import {
  createAuthConfig,
  type AuthDatabase,
  type AuthEnvironment,
} from "./src/lib/auth/config";

type KairosWorkerEnvironment=AuthEnvironment & {
  DB:AuthDatabase;
};

async function loadRuntimeEnvironment():Promise<KairosWorkerEnvironment>{
  if(process.env.KAIROS_NEXT_COMPAT_BUILD==="1"){
    return {
      DB:{} as AuthDatabase,
      AUTH_SECRET:"compat-build-only",
      AUTH_GOOGLE_ID:"compat-google-id",
      AUTH_GOOGLE_SECRET:"compat-google-secret",
      AUTH_MICROSOFT_ENTRA_ID_ID:"compat-microsoft-id",
      AUTH_MICROSOFT_ENTRA_ID_SECRET:"compat-microsoft-secret",
    };
  }

  const {env}=await import("cloudflare:workers");
  return env as unknown as KairosWorkerEnvironment;
}

const runtimeEnv=await loadRuntimeEnvironment();

const {handlers:rawHandlers,auth:rawAuth,signIn:rawSignIn,signOut:rawSignOut}=NextAuth(
  createAuthConfig(runtimeEnv.DB,runtimeEnv),
);
export const auth=rawAuth;
export const guardedHandlers={
  GET:(request:NextRequest)=>guardAuthRequest(request,req=>rawHandlers.GET(req as NextRequest)),
  POST:(request:NextRequest)=>guardAuthRequest(request,req=>rawHandlers.POST(req as NextRequest)),
};
export async function signOut(options?:Parameters<typeof rawSignOut>[0]){
  return runWithOperationContext(createOperationContext("auth.sign_out"),()=>runWithAuthOutcomeOwner(async()=>{
    try{
      const result=await rawSignOut({...options,redirect:false});
      const outcome=await classifySignOutResult(result);
      emitAuthOutcome(new Response(null,{status:outcome.status}),undefined,outcome.code);
      if(options?.redirect!==false&&outcome.redirect)redirect(outcome.redirect);
      return result;
    }catch(error){
      if(typeof error==="object"&&error!==null&&"digest" in error&&String(error.digest).startsWith("NEXT_REDIRECT"))throw error;
      emitAuthOutcome(new Response(null,{status:500}));throw error;
    }
  }));
}
export async function startPublicSignIn(provider:IdentityProvider,formData:FormData):Promise<AuthActionState>{
  "use server";
  return runWithOperationContext(createOperationContext("auth.sign_in"),()=>runWithAuthOutcomeOwner(async()=>{
    let destination:string;
    try{
      const runtime=await getAbuseRuntime();
      const attempt=await enforcePublicAuthInitiation(runtime,provider,new Headers(await nextHeaders()),formData);
      const values=formData.getAll("returnTo");
      const returnTo=values.length===1&&typeof values[0]==="string"?safeReturnTo(values[0]):"/";
      const normalized=normalizeAuthDestination(await rawSignIn(provider,{redirect:false,redirectTo:returnTo}),runtime.appOrigin);
      destination=normalized.url;
      if(!normalized.failed){
        const state=new URL(destination,runtime.appOrigin).searchParams.get("state")??"";
        const stamp=await signAuthAttempt(runtime,attempt,state);
        (await cookies()).set(attemptCookieName(provider),stamp,attemptCookieOptions(runtime));
      }
      emitAuthOutcome(new Response(null,{status:303}),provider,normalized.failed?"AUTH_FAILED":"AUTH_REQUIRED");
    }catch(error){
      const response=authFailureResponse(error);emitAuthOutcome(response,provider);
      return response.json() as Promise<AuthActionState>;
    }
    redirect(destination);
  }));
}

function requestOrigin(headers:Headers):string{
  const forwardedHost=headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host=forwardedHost||headers.get("host")?.trim()||"localhost";
  const forwardedProto=headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol=forwardedProto==="http"||forwardedProto==="https"
    ?forwardedProto
    :/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
      ?"http"
      :"https";
  return `${protocol}://${host}`;
}

export async function getAuthSessionFromHeaders(
  input:Headers,
):Promise<unknown|null>{
  const headers=new Headers(input);
  const response=await rawHandlers.GET(new NextRequest(
    `${requestOrigin(headers)}/api/auth/session`,
    {headers},
  ));
  if(!response.ok)return null;
  return response.json();
}
