import Link from "next/link";
import {Button} from "@/components/ui/button";
import {safeReturnTo} from "@/lib/auth/return-to";
import {signIn} from "../../../auth";

type SignInPageProps={
  searchParams:Promise<{returnTo?:string|string[];error?:string|string[]}>;
};

const SIGN_IN_ERRORS:Record<string,string>={
  OAuthCallbackError:"The identity provider could not finish signing you in. Try again. If this persists, the provider's app credentials or callback configuration may need attention.",
  OAuthAccountNotLinked:"This account may already be associated with a different sign-in provider. Use your original sign-in method.",
  AccessDenied:"Sign-in was denied. Try again or choose another account.",
  Configuration:"Sign-in is temporarily unavailable. Please try again later.",
};

function first(value:string|string[]|undefined):string|null{
  if(Array.isArray(value))return value[0]??null;
  return value??null;
}

export default async function SignInPage({searchParams}:SignInPageProps){
  const params=await searchParams;
  const returnTo=safeReturnTo(first(params.returnTo));
  const errorCode=first(params.error);
  const errorMessage=errorCode
    ?Object.hasOwn(SIGN_IN_ERRORS,errorCode)
      ?SIGN_IN_ERRORS[errorCode]
      :"Sign-in could not be completed. Please try again."
    :null;

  async function signInWithGoogle(){
    "use server";
    await signIn("google",{redirectTo:returnTo});
  }

  async function signInWithMicrosoft(){
    "use server";
    await signIn("microsoft-entra-id",{redirectTo:returnTo});
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
        <form action={signInWithGoogle}><Button className="w-full" type="submit">Continue with Google</Button></form>
        <form action={signInWithMicrosoft}><Button className="w-full" variant="secondary" type="submit">Continue with Microsoft</Button></form>
      </div>
      <p className="mt-6 text-sm leading-6 text-[var(--muted)]">Calendar permissions are connected separately after sign-in.</p>
    </main>
  );
}
