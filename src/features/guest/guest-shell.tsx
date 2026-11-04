"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";

const links=["Upcoming","Calendar","Assignments","Sources","Settings"];
export function GuestShell({children}:{children:ReactNode}) {
  const pathname=usePathname();
  return <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
    <a href="#guest-main" className="sr-only focus:not-sr-only">Skip to content</a>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><Link href="/guest/upcoming" className="text-2xl font-semibold">Kairos</Link><p className="mt-1 text-sm text-[var(--muted)]">Saved in this browser</p></div>
      <Link prefetch={false} href="/sign-in?returnTo=/upcoming" className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4">Use an account</Link>
    </header>
    <nav aria-label="Guest navigation" className="mb-6 flex flex-wrap gap-2">{links.map(label=>{
      const href=`/guest/${label.toLowerCase()}`;
      return <Link key={href} href={href} aria-current={pathname===href?"page":undefined} className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 aria-[current=page]:font-semibold">{label}</Link>;
    })}</nav>
    <main id="guest-main" tabIndex={-1}>{children}</main>
  </div>;
}
