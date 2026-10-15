import Link from "next/link";
import type {Metadata} from "next";
import {PUBLIC_CONTACTS} from "@/lib/public-contacts";
import {FIREFOX_ADDON_LISTING_URL} from "@/lib/extension-distribution";

export const metadata:Metadata={
  title:"Privacy — Kairos",
  description:"How Kairos handles account identity, coursework, source credentials, Firefox bridge data, and optional calendar connections.",
  alternates:{canonical:"https://mykairos.me/privacy"},
};

export default function PrivacyPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">Updated October 15, 2026</p>
      <div className="mt-6 space-y-8 leading-7 text-[var(--muted)]">
        <section className="space-y-3" aria-labelledby="privacy-purpose">
          <h2 id="privacy-purpose" className="text-xl font-semibold text-[var(--foreground)]">Purpose and operator</h2>
          <p>Kairos is an independent student project operating at mykairos.me, not a University of Washington service. It combines coursework and deadlines from sources you connect into your own dashboard. Optional calendar connections publish copies of deadlines. The operator can be contacted at <a className="underline underline-offset-4" href={PUBLIC_CONTACTS.support.href}>{PUBLIC_CONTACTS.support.address}</a> for privacy, data-access, correction, deletion, or ownership questions.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-account">
          <h2 id="privacy-account" className="text-xl font-semibold text-[var(--foreground)]">Account identity and saved coursework</h2>
          <p>Google or Microsoft sign-in supplies your name, email address, profile image if available, provider name and account identifier. Kairos stores these with an internal user ID, account links, and server-side session records, including session tokens and expiry. Session cookies let your browser stay signed in; authentication also uses cookies for sign-in checks. Kairos does not persist sign-in identity OAuth access, refresh, or ID tokens in its account records.</p>
          <p>Google identity requests <code>openid email profile</code>. Microsoft identity requests <code>openid profile email User.Read</code>, including basic profile access. These identify your Kairos account; signing in does not connect a calendar or authorize calendar writes.</p>
          <p>Connected sources supply course IDs, names and terms; assignment or lesson IDs, titles, release dates, due dates and late due dates; source links; submission or completion status, late/missing flags and published grades where available. Kairos saves source selections, settings, connection labels, sync timestamps, counts, error categories, and extractor versions to display and refresh your dashboard. Setup can save your progress. If you explicitly choose Save privately, setup credentials are encrypted and saved for later use; unsaved input stays in page memory. Sources remain independent when they disagree.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-credentials">
          <h2 id="privacy-credentials" className="text-xl font-semibold text-[var(--foreground)]">Credentials and hosted storage</h2>
          <p>The hosted service runs on Cloudflare Workers with account data in Cloudflare D1. Canvas private feed URLs, Ed API tokens, optional calendar refresh tokens and Apple app-specific passwords are encrypted by Kairos before storage using AES-GCM and a server-held key. Persisted calendar OAuth proof-key (PKCE) verifiers are also encrypted. Kairos decrypts these credentials on the server when it needs to contact the relevant source or calendar provider. Saved credentials are not returned by normal connection-status APIs or displayed again.</p>
          <p>This credential encryption does not apply to ordinary identity, coursework, account labels, Apple Account email addresses, session records, or sync metadata at the application layer. HTTPS protects transport to the hosted site. Encryption is not a guarantee against every compromise. Kairos does not ask for your UW NetID, Canvas or Gradescope password, or your primary Apple Account password.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-firefox">
          <h2 id="privacy-firefox" className="text-xl font-semibold text-[var(--foreground)]">Firefox bridge: website content and browsing activity</h2>
          <p>The published Firefox extension 0.4.0 declares required <code>websiteContent</code> and <code>browsingActivity</code> data permissions. It reads normalized course, assignment, status and published grade information from already signed-in Canvas and Gradescope tabs. Browsing activity here includes detecting whether supported tabs are open and reporting their presence to the Kairos page. The bridge does not request browser history or cookie API access.</p>
          <p>The 0.4.0 PONG presence response tells Kairos whether the bridge and supported tabs are available, but its version field is <code>not-shared</code>. Earlier development builds can send their installed extension version to the Kairos page as compatibility information in PONG. The local extension popup shows the actual installed version. Source-derived diagnostics include HTTP status categories and DOM structure/count results used to explain discovery or extraction failures; these and version compatibility information are source/connection results, not optional telemetry.</p>
          <p>Authenticated reads happen within Firefox. Canvas and Gradescope passwords, session cookies, authorization headers and raw authenticated HTML are not sent through the page bridge. Normalized results reach the Kairos page and are saved to your hosted account when you sync. Website bridge origins are restricted to mykairos.me and the two supported local development origins. The extension has no separate advertising or analytics transmission path. Kairos Bridge is <a href={FIREFOX_ADDON_LISTING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">published on Mozilla Add-ons</a> for Firefox desktop 140+.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-calendars">
          <h2 id="privacy-calendars" className="text-xl font-semibold text-[var(--foreground)]">Optional calendar access and Google data use</h2>
          <p>Calendar consent is separate from identity sign-in. Google Calendar requests only <code className="break-all">https://www.googleapis.com/auth/calendar.app.created</code>, with offline access so encrypted Google refresh tokens can obtain short-lived access tokens for later sync. Kairos creates a secondary Kairos calendar, reads its identity and generated events to reconcile deadlines, and creates, updates or deletes those events. It does not request broad access to all your Google calendars.</p>
          <p>Microsoft Calendar requests delegated <code>Calendars.ReadWrite</code> and <code>offline_access</code>. This permission is broader than Google&apos;s app-created-calendar scope. Kairos lists calendars to find or create its dedicated Kairos calendar and reads and writes generated events there. Apple iCloud uses your Apple Account email and an app-specific password to discover and select an existing writable calendar named Kairos, which you create before connecting.</p>
          <p>Generated events share course and assignment titles, deadline times, source name, submission status and a cleaned source link with the destination you select. Event IDs, calendar IDs/names, synchronization identifiers, content hashes, ETags, timestamps and error categories are stored in Kairos to reconcile changes. Calendar edits do not write back to coursework sources, and sync is not continuous while Kairos is closed.</p>
          <p>Google API data is used only for the sign-in and optional calendar features described here, subject to the <a className="underline underline-offset-4" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements. Kairos does not sell Google user data, use it for advertising, or send it to AI model training services. The current application has no AI generation or training feature. Transfers are limited to delivering these features with your consent, security needs, or applicable legal requirements. Human access to Google data is limited to your affirmative agreement, security needs, or applicable legal requirements.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-processors">
          <h2 id="privacy-processors" className="text-xl font-semibold text-[var(--foreground)]">Third-party processing</h2>
          <p>Cloudflare processes requests and stores hosted data; it can receive network information such as IP address, user agent and requested URL. Google and Microsoft process sign-in and, when connected, calendar requests. Canvas processes feed requests, Ed processes API requests, and Apple processes iCloud CalDAV requests. Firefox and the connected websites handle browser-local source reads. Each provider also applies its own policies, permissions and retention practices.</p>
          <p>Email sent to the public contact aliases passes through Cloudflare Email Routing to the operator&apos;s privately selected inbox and its email provider. Your message and sender address become correspondence outside the Kairos account database. Alias routing is active; delivery to both public aliases has been confirmed. Avoid sending credentials or unnecessary coursework or account data.</p>
          <p>Sign-in may require a Cloudflare Turnstile check. When shown, Cloudflare processes browser and network signals such as IP address, user agent, TLS fingerprint and site origin for abuse prevention under its <a className="underline underline-offset-4" href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile privacy policy</a>. Reading saved coursework and signing out do not require this challenge.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-retention">
          <h2 id="privacy-retention" className="text-xl font-semibold text-[var(--foreground)]">Retention, diagnostics and recovery history</h2>
          <p>Account and coursework data, settings, credentials and connection/sync metadata remain in the live database until removed by the relevant controls or account deletion. Failed or partial syncs retain previously known coursework. Session and request expiry prevents later use but does not promise immediate physical deletion. Bounded maintenance can remove expired admission records and eligible OAuth, sync and settled browser-request metadata when enabled by the operator. Active or uncertain operations and unsettled browser requests are retained rather than erased based on age.</p>
          <p>Persistent application request and console logs are disabled in the current hosted configuration. Operational diagnostics use selected error categories; live operator debugging may observe those categories. Any later change to log persistence requires a review of collected fields and retention before activation. Cloudflare may separately process service/security data under its own policies. Support email has no verified fixed deletion schedule and is not erased by account deletion.</p>
          <p>Cloudflare D1 Time Travel keeps database recovery history for 7 days on Free or 30 days on Paid. The operator currently reports Workers Free; recovery retention depends on the account plan, including any later change. Deleting live records does not immediately erase recovery history. A database restore can recover older records and requires the operator to consider previous deletion requests. See <a className="underline underline-offset-4" href="https://developers.cloudflare.com/d1/reference/time-travel/">Cloudflare D1 recovery documentation</a>.</p>
          <p>Rate controls store pseudonymous HMAC request keys, admission times and, for signed-in operations, user IDs. These records are not anonymous. Expired rate events become eligible for cleanup after one hour, but physical retention may be longer while maintenance is disabled, during outages, or in recovery history.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-delete">
          <h2 id="privacy-delete" className="text-xl font-semibold text-[var(--foreground)]">Delete, disconnect and revoke access</h2>
          <p>In Settings, use Delete account and type DELETE to remove your Kairos identity links, sessions and live user data, including coursework, settings, connections, encrypted credentials and event mappings. Deletion does not automatically remove remote calendar events or revoke provider consent. It also does not delete your original coursework or support correspondence, and recovery history expires separately as described above.</p>
          <p>If you want generated events removed, use Remove generated events in Sources → Calendar destinations while still connected, check the result at the provider, then disconnect or delete the account. Removal can fail; an ordinary later sync can recreate eligible events while the connection remains active. Disconnect removes the Kairos connection, credentials and event mappings but leaves remote events and calendars intact. You may delete the remote Kairos calendar yourself.</p>
          <p>Separately revoke Kairos in <a className="underline underline-offset-4" href="https://myaccount.google.com/connections">Google account connections</a> or Microsoft&apos;s account application-permission controls (work/school administrators may control consent). Revoke Apple app-specific passwords at <a className="underline underline-offset-4" href="https://account.apple.com/">Apple Account settings</a>, revoke Ed tokens in Ed, and reset the Canvas private feed URL in Canvas if it is exposed. Provider revocation stops future authorized requests but does not itself delete Kairos&apos;s saved coursework or existing remote events. Remove the Firefox extension to stop browser-local reads.</p>
        </section>
        <section className="space-y-3" aria-labelledby="privacy-changes">
          <h2 id="privacy-changes" className="text-xl font-semibold text-[var(--foreground)]">Questions and changes</h2>
          <p>Contact the operator through <Link className="underline underline-offset-4" href="/support">Support</Link> for data requests or <Link className="underline underline-offset-4" href="/security">Security</Link> for sensitive reports. This notice will be updated when practices change; a new Google data use requires disclosure and renewed consent before that use. No fixed support response time or provider approval is promised.</p>
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
