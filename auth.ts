import "server-only";
import { env } from "cloudflare:workers";
import NextAuth from "next-auth";
import {
  createAuthConfig,
  type AuthDatabase,
  type AuthEnvironment,
} from "./src/lib/auth/config";

type KairosWorkerEnvironment=AuthEnvironment & {
  DB:AuthDatabase;
};

const runtimeEnv=env as unknown as KairosWorkerEnvironment;

export const {handlers,auth,signIn,signOut}=NextAuth(
  createAuthConfig(runtimeEnv.DB,runtimeEnv),
);
