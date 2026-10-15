import { D1Adapter } from "@auth/d1-adapter";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import {authDiagnostics} from "./diagnostics";
import {customFetch} from '@auth/core';
import {localAuthFixtureFetch} from '@/lib/testing/auth-transport';

export type AuthDatabase=Parameters<typeof D1Adapter>[0];

export type AuthEnvironment={
  AUTH_SECRET:string;
  AUTH_GOOGLE_ID:string;
  AUTH_GOOGLE_SECRET:string;
  AUTH_MICROSOFT_ENTRA_ID_ID:string;
  AUTH_MICROSOFT_ENTRA_ID_SECRET:string;
  AUTH_MICROSOFT_ENTRA_ID_ISSUER?:string;
};

const GOOGLE_IDENTITY_SCOPE="openid email profile";
const MICROSOFT_IDENTITY_SCOPE="openid profile email User.Read";

export function createAuthConfig(
  db:AuthDatabase,
  env:AuthEnvironment,
):NextAuthConfig{
  const adapter=D1Adapter(db);
  const fixtureFetch=localAuthFixtureFetch(env as unknown as Record<string,unknown>);
  const transport=fixtureFetch?{[customFetch]:fixtureFetch}:{};
  const linkAccount=adapter.linkAccount!;
  const getSessionAndUser=adapter.getSessionAndUser!;
  return {
    secret:env.AUTH_SECRET,
    pages:{signIn:"/sign-in",error:"/sign-in"},
    logger:authDiagnostics,
    adapter:{
      ...adapter,
      // OAuth linking reads the adapter directly, bypassing Auth.js's normal
      // session-read expiry check. An expired bearer must grant no authority.
      async getSessionAndUser(token){
        const result=await getSessionAndUser(token);
        if(!result)return null;
        const expiresAt=result.session.expires.getTime();
        if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){
          await adapter.deleteSession!(token);
          return null;
        }
        return result;
      },
      // Identity tokens are used during sign-in only. Calendar offline grants
      // live separately in the encrypted, user-scoped credential repository.
      linkAccount:account=>linkAccount({
        userId:account.userId,
        type:account.type,
        provider:account.provider,
        providerAccountId:account.providerAccountId,
      }),
    },
    session:{strategy:"database"},
    providers:[
      Google({
        ...transport,
        clientId:env.AUTH_GOOGLE_ID,
        clientSecret:env.AUTH_GOOGLE_SECRET,
        checks:["pkce","state"],
        authorization:{params:{scope:GOOGLE_IDENTITY_SCOPE}},
      }),
      MicrosoftEntraID({
        ...transport,
        clientId:env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret:env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        checks:["pkce","state"],
        issuer:env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
          ?? "https://login.microsoftonline.com/common/v2.0",
        authorization:{params:{scope:MICROSOFT_IDENTITY_SCOPE}},
      }),
    ].map(provider=>fixtureFetch?{...provider,[customFetch]:fixtureFetch}:provider),
    callbacks:{
      session({session,user}){
        return {
          expires:session.expires,
          user:{
            id:user.id,
            name:user.name??null,
            email:user.email??null,
            image:user.image??null,
          },
        };
      },
    },
  };
}
