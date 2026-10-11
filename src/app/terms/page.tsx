import Link from "next/link";
import type {Metadata} from "next";
import {PUBLIC_CONTACTS} from "@/lib/public-contacts";

export const metadata:Metadata={
  title:"Terms — Kairos",
  description:"Use of the independent Kairos coursework dashboard, its development limits, and optional connections.",
  alternates:{canonical:"https://mykairos.me/terms"},
};

export default function TermsPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Terms</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">Updated October 10, 2026</p>
      <div className="mt-6 space-y-4 leading-7 text-[var(--muted)]">
        <p>Use Kairos only with accounts, coursework, and calendar data you are authorized to access.</p>
        <p>Kairos combines coursework in a personal dashboard. Follow your institution&apos;s and providers&apos; rules when connecting accounts. Do not use it to access another person&apos;s data, bypass access controls, or disrupt the service.</p>
        <p>Kairos is provided during active development and may change, become unavailable, or require reconnection as the service evolves.</p>
        <p>Public beta launch, provider verification and Mozilla-signed extension distribution remain pending. A published OAuth application or a working integration does not establish provider approval or availability to every account. Managed Google or Microsoft accounts may be restricted by their administrators.</p>
        <p>Check official course pages for deadlines, grades and submission requirements. Imports can be delayed or incomplete, and sources may disagree. Kairos cannot guarantee that a sync, displayed deadline, status or calendar copy is correct or current; you remain responsible for your coursework and submissions.</p>
        <p>Calendar connections are optional and separate from sign-in. They create or update deadline copies, and may delete generated events as assignments or settings change. Disconnecting or deleting your Kairos account leaves remote events and provider consent in place; follow the removal and revocation steps in <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>.</p>
        <p>Kairos is an independent student project and is not affiliated with or endorsed by the University of Washington.</p>
        <p>Connecting a source does not grant rights to third-party coursework, names or materials. Provider terms and account permissions still apply.</p>
        <p>For questions about these terms or project ownership, contact <a href={PUBLIC_CONTACTS.support.href} className="underline underline-offset-4">{PUBLIC_CONTACTS.support.address}</a>. Alias routing is active; actual inbox delivery confirmation is pending. No fixed response time is promised.</p>
      </div>
      <nav aria-label="Legal and contact" className="mt-10 flex flex-wrap gap-4 text-sm">
        <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
        <Link href="/terms" className="underline underline-offset-4">Terms</Link>
        <Link href="/support" className="underline underline-offset-4">Support</Link>
        <Link href="/security" className="underline underline-offset-4">Security</Link>
      </nav>
    </main>
  );
}
