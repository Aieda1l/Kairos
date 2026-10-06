import "server-only";
import NextAuth from "next-auth";
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
