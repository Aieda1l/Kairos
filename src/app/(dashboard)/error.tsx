"use client";
import {Button} from "@/components/ui/button";
export default function ErrorBoundary({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
    <h1 className="text-xl font-semibold">This page could not be loaded</h1>
    <p className="my-2 text-sm text-[var(--muted)]">Kairos is temporarily unable to load this page. Try again shortly, or contact support if it continues.</p>
    <Button onClick={reset}>Retry</Button>
    <a className="ml-4 inline-flex min-h-11 items-center underline underline-offset-4" href="/support">Contact support</a>
  </div>;
}
