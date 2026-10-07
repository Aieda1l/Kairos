import "server-only";
import NextAuth from "next-auth";
import {NextRequest} from "next/server";
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

export const {handlers,auth,signIn,signOut}=NextAuth(
  createAuthConfig(runtimeEnv.DB,runtimeEnv),
);

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
  const response=await handlers.GET(new NextRequest(
    `${requestOrigin(headers)}/api/auth/session`,
    {headers},
  ));
  if(!response.ok)return null;
  return response.json();
}
