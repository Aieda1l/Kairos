import Link from "next/link";
import type {Metadata} from "next";
import {PUBLIC_CONTACTS} from "@/lib/public-contacts";
import {FIREFOX_ADDON_LISTING_URL} from "@/lib/extension-distribution";

export const metadata:Metadata={
  title:"Support — Kairos",
  description:"Contact Kairos about sign-in, coursework sync, calendar connections, privacy, or project ownership.",
  alternates:{canonical:"https://mykairos.me/support"},
};

export default function SupportPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Support</h1>
      <div className="mt-6 space-y-6 leading-7 text-[var(--muted)]">
        <section className="space-y-3" aria-labelledby="support-guest">
          <h2 id="support-guest" className="text-xl font-semibold text-[var(--foreground)]">Guest storage and recovery</h2>
          <p>When guest entry is available, no Kairos account is needed. Guest Settings offers export, import and confirmed local reset. Backups contain private coursework and grades, although credentials are excluded; do not attach them to public issues or support emails. Support has no server copy to restore after browser storage or device loss. Keep backups privately. Guest data does not automatically sync across devices or transfer to an account, and opening Kairos from scratch offline is not supported.</p>
          <p>If storage cannot be read, check browser storage permissions and reload. Guest Settings can reset corrupt coursework when its storage identity is still readable. If the identity itself cannot be read, use browser site data settings as a last resort; this removes local coursework and may also sign you out of an account. The in-app Clear guest data action leaves account data and sign-in intact, even when ending the guest capability fails offline. Neither action revokes provider access or promises immediate physical erasure.</p>
          <p>In Guest Sources, re-enter a credential for the same source account to keep coursework and course selections. Disconnect first to switch provider accounts. Forget removes a memory or remembered credential while keeping coursework; disconnect deletes that source&apos;s local records. Remembered guest credentials are plaintext in the browser profile; Canvas feed and Ed reads temporarily send credentials and responses through the server. Hosted account credentials use the separate encrypted persistence described in Privacy.</p>
        </section>
        <p>For sign-in, coursework sync, calendar connections, privacy requests or project ownership questions, email <a href={PUBLIC_CONTACTS.support.href} className="underline underline-offset-4">{PUBLIC_CONTACTS.support.address}</a>. Kairos is an independent student project, not a University of Washington help desk.</p>
        <p>Domain alias routing is active to a verified private destination; delivery to both public aliases has been confirmed. No fixed response time is promised. This contact is for inbound correspondence, not an automated password-reset or transactional email system.</p>
        <section className="space-y-3" aria-labelledby="support-details">
          <h2 id="support-details" className="text-xl font-semibold text-[var(--foreground)]">What to include</h2>
          <p>Describe what you tried, what you expected, and what happened. Include the affected source or calendar provider, browser version, approximate time and timezone, and the visible error category. For Firefox, read the installed extension version from its local popup. The published 0.4.0 bridge uses a not-shared webpage version field; earlier development builds can report their installed version for compatibility.</p>
          <p>Redact screenshots. Do not send passwords, private Canvas feed URLs, Ed tokens, cookies, authorization codes, refresh tokens or Apple app-specific passwords. Avoid including other students&apos; data. Send security concerns through <Link href="/security" className="underline underline-offset-4">Security</Link>; keep credentials and private account data out of public issues.</p>
        </section>
        <section className="space-y-3" aria-labelledby="support-access">
          <h2 id="support-access" className="text-xl font-semibold text-[var(--foreground)]">Sign-in and connections</h2>
          <p>Use Google or Microsoft for your Kairos identity. Calendar consent is a separate optional step in Sources. Kairos is UW-first; the Firefox Canvas connector supports canvas.uw.edu. Account or administrator restrictions can prevent provider access. Install <a href={FIREFOX_ADDON_LISTING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">Kairos Bridge from Mozilla Add-ons</a> in Firefox desktop 140+.</p>
          <p>For stale coursework, check the official source and try its manual sync. A failed or partial sync preserves previously known data. For iCloud, create a writable calendar named Kairos before connecting with an Apple app-specific password.</p>
        </section>
        <section className="space-y-3" aria-labelledby="support-data">
          <h2 id="support-data" className="text-xl font-semibold text-[var(--foreground)]">Data requests and leaving Kairos</h2>
          <p>Use Settings → Delete account for live Kairos account deletion. To remove calendar copies, use Remove generated events while still connected and verify the result, then disconnect. Deletion and disconnect do not automatically remove remote events or revoke provider consent. Revoke access separately at each provider. See <Link href="/privacy" className="underline underline-offset-4">Privacy</Link> for recovery-history limits and revocation steps.</p>
          <p>If you cannot sign in or need access, correction, or deletion help, describe the request by email. Account ownership may need to be verified without asking for passwords or tokens. Account deletion does not automatically erase support correspondence.</p>
        </section>
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
