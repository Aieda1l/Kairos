import { D1Adapter } from "@auth/d1-adapter";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import {authDiagnostics} from "./diagnostics";

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
  const linkAccount=adapter.linkAccount!;
  return {
    secret:env.AUTH_SECRET,
    pages:{signIn:"/sign-in"},
    logger:authDiagnostics,
    adapter:{
      ...adapter,
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
        clientId:env.AUTH_GOOGLE_ID,
        clientSecret:env.AUTH_GOOGLE_SECRET,
        authorization:{params:{scope:GOOGLE_IDENTITY_SCOPE}},
      }),
      MicrosoftEntraID({
        clientId:env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret:env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer:env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
          ?? "https://login.microsoftonline.com/common/v2.0",
        authorization:{params:{scope:MICROSOFT_IDENTITY_SCOPE}},
      }),
    ],
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
