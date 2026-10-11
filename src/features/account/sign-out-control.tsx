"use client";

import {useState} from "react";
import {signOut} from "next-auth/react";
import {LogOut} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/ui";

export function SignOutControl({compact=false}:{compact?:boolean}){
  const [signingOut,setSigningOut]=useState(false);
  const [error,setError]=useState("");

  async function endSession(){
    if(signingOut)return;
    setSigningOut(true);
    setError("");
    try{
      // Auth.js supplies CSRF protection, deletes the database session, and
      // clears its cookie. Its document redirect also discards dashboard state.
      await signOut({redirectTo:"/sign-in"});
    }catch{
      setError("Could not sign out. Try again.");
      setSigningOut(false);
    }
  }

  const label=signingOut?"Signing out…":"Sign out";
  return <div>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("w-full",compact?"justify-center px-0":"justify-start")}
      aria-label={label}
      aria-busy={signingOut}
      title={compact?label:undefined}
      disabled={signingOut}
      onClick={()=>void endSession()}
    >
      <LogOut size={18} aria-hidden="true"/>
      {!compact&&<span>{label}</span>}
    </Button>
    {error&&<p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
  </div>;
}
