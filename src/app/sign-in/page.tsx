import Link from "next/link";
import {safeReturnTo} from "@/lib/auth/return-to";
import {AuthInitiationForm} from "@/features/auth/auth-initiation-form";
import {startPublicSignIn} from "../../../auth";

type SignInPageProps={
  searchParams:Promise<{returnTo?:string|string[];error?:string|string[]}>;
};

function first(value:string|string[]|undefined):string|null{
  if(Array.isArray(value))return value[0]??null;
  return value??null;
}

export default async function SignInPage({searchParams}:SignInPageProps){
  const params=await searchParams;
  const returnTo=safeReturnTo(first(params.returnTo));
  const errorCode=first(params.error);
  const errorMessage=errorCode?"Sign-in could not be completed. Please try again.":null;
  // Public site key only. Server verification never accepts widget success as proof.
  const siteKey=process.env.KAIROS_TURNSTILE_SITE_KEY??"";

  async function signInWithGoogle(formData:FormData){
    "use server";
    return startPublicSignIn("google",formData);
  }

  async function signInWithMicrosoft(formData:FormData){
    "use server";
    return startPublicSignIn("microsoft-entra-id",formData);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Sign in to Kairos</h1>
      <p className="mt-3 text-[var(--muted)]">Choose the account you want to use for your Kairos identity.</p>
      {errorMessage&&(
        <p role="alert" className="mt-5 rounded-lg border border-red-400/60 p-4 text-sm">
          {errorMessage}
        </p>
      )}
      <div className="mt-8 space-y-3">
        <AuthInitiationForm provider="google" siteKey={siteKey} returnTo={returnTo} action={signInWithGoogle}/>
        <AuthInitiationForm provider="microsoft-entra-id" siteKey={siteKey} returnTo={returnTo} action={signInWithMicrosoft}/>
      </div>
      <p className="mt-6 text-sm leading-6 text-[var(--muted)]">Calendar permissions are connected separately after sign-in.</p>
    </main>
  );
}
