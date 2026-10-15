import Link from "next/link";
import type {Metadata} from "next";
import {PUBLIC_CONTACTS} from "@/lib/public-contacts";

export const metadata:Metadata={
  title:"Security — Kairos",
  description:"Report Kairos security concerns privately without posting credentials or account data in public issues.",
  alternates:{canonical:"https://mykairos.me/security"},
};

export default function SecurityPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Security</h1>
      <div className="mt-6 space-y-6 leading-7 text-[var(--muted)]">
        <p>Report suspected credential exposure, unauthorized access or a Kairos vulnerability privately to <a href={PUBLIC_CONTACTS.security.href} className="underline underline-offset-4">{PUBLIC_CONTACTS.security.address}</a>. Domain alias routing is active to a verified private destination; delivery to both public aliases has been confirmed. No fixed response time, bounty or legal safe-harbor promise is offered.</p>
        <section className="space-y-3" aria-labelledby="security-report">
          <h2 id="security-report" className="text-xl font-semibold text-[var(--foreground)]">Report safely</h2>
          <p>Do not post credentials or private account data in public issues. This includes private feed URLs, Ed tokens, cookies, authorization codes, OAuth access or refresh tokens, and Apple app-specific passwords. Email an initial description without secrets; do not attach raw authenticated responses or someone else&apos;s coursework.</p>
          <p>Include the affected page or feature, approximate time and timezone, impact, and minimal reproduction steps using accounts and data you control. Stop if a test exposes another user&apos;s data. Redact screenshots and request URLs. Describe a suspected secret exposure without sending the secret itself.</p>
        </section>
        <section className="space-y-3" aria-labelledby="security-revoke">
          <h2 id="security-revoke" className="text-xl font-semibold text-[var(--foreground)]">If a credential is exposed</h2>
          <p>Revoke or rotate it at the source: reset the Canvas feed URL, revoke the Ed token, remove Google or Microsoft app access, or revoke the Apple app-specific password. Disconnect the affected Kairos connection. Account deletion removes live Kairos records but does not revoke provider grants or remove remote calendar events; <Link href="/privacy" className="underline underline-offset-4">Privacy</Link> explains the separate steps and database recovery history.</p>
        </section>
        <section className="space-y-3" aria-labelledby="security-status">
          <h2 id="security-status" className="text-xl font-semibold text-[var(--foreground)]">Current protection and limits</h2>
          <p>The hosted implementation scopes data to the signed-in account and encrypts stored source and calendar credentials. Ordinary identity, coursework and metadata are not encrypted by Kairos at the application layer. The Firefox bridge passes normalized source results rather than passwords, cookies or raw authenticated HTML.</p>
          <p>Persistent application logs are disabled. Sign-in may require Turnstile, and protected operations use rate and duplicate-work controls. These controls do not guarantee availability or prevent every attack. This page is not a security certification or a public-beta readiness decision.</p>
        </section>
        <p>For ordinary connection problems, privacy requests or project ownership questions, use <Link href="/support" className="underline underline-offset-4">Support</Link>.</p>
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
