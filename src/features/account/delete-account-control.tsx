"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

export function DeleteAccountControl(){
  const router=useRouter();
  const [confirmation,setConfirmation]=useState("");
  const [deleting,setDeleting]=useState(false);
  const [message,setMessage]=useState("");

  async function removeAccount(){
    if(confirmation!=="DELETE" || deleting)return;
    setDeleting(true);
    setMessage("");
    try{
      const response=await fetch("/api/account",{
        method:"DELETE",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({confirmation:"DELETE"}),
      });
      if(!response.ok){
        const body=await response.json().catch(()=>null) as {message?:string}|null;
        setMessage(body?.message??"Your account could not be deleted.");
        return;
      }
      router.push("/");
    }catch{
      setMessage("Your account could not be deleted.");
    }finally{
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--surface)] p-5">
      <h2 className="font-medium">Delete account</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
        This permanently deletes your Kairos account and stored Kairos data. Remote calendar events are not removed automatically. If you want them removed, use <strong>Remove generated events</strong> in Calendar destinations first.
      </p>
      <div className="mt-4 max-w-sm">
        <Label htmlFor="delete-account-confirmation">Type DELETE to confirm</Label>
        <Input
          id="delete-account-confirmation"
          value={confirmation}
          onChange={event=>setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="mt-4">
        <Button
          variant="danger"
          disabled={confirmation!=="DELETE"||deleting}
          onClick={removeAccount}
        >
          {deleting?"Deleting…":"Delete my account"}
        </Button>
      </div>
      {message&&<div className="mt-4"><Alert>{message}</Alert></div>}
    </section>
  );
}
