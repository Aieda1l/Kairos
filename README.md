# Kairos

Kairos is a UW-first assignment dashboard, open to students signing in with Google or Microsoft identities. It combines Canvas deadlines and submission status, read-only Gradescope coursework from Firefox, and a direct read-only Ed connector. Optional calendar connections publish deadline copies to Google Calendar, Outlook / Microsoft 365, and Apple iCloud Calendar. Identity sign-in and calendar consent are separate.

Kairos is an independent student project, not an official University of Washington product. It does not ask for your UW NetID, Canvas or Gradescope password. The Firefox Canvas connector currently supports `canvas.uw.edu`; source access depends on your own courses and accounts.

## Hosted status

Milestone 7 is deployed at [mykairos.me](https://mykairos.me). The current October 24 UTC release is source `316e2c9` ([PR #48](https://github.com/Aieda1l/Kairos/pull/48), [PR #49](https://github.com/Aieda1l/Kairos/pull/49)); [exact-main CI](https://github.com/Aieda1l/Kairos/actions/runs/40061552619) passed 1,776 tests and 65 browser cases. Sync All now shows Ed's current-attempt outcome, permits explicitly admitted guarded manual rechecks, and explains resource-specific Canvas access failures. Deployment and preserved-state checks passed; a fresh normal authenticated Sync All has been requested and remains pending. The last observed Canvas result was 8 of 9 statuses, with HTTP 401 on one item. Workers Free CPU headroom, calendar update/removal/recreation and remaining account/provider acceptance stay open. See the [Sync All release record](docs/deployment/sync-all-reliability-2026-10-24.md), [engineering closeout](docs/deployment/closeout-milestone-7.md) and [current readiness](docs/deployment/readiness-milestone-7.md).

Recorded operator evidence establishes published Google OAuth, approved Google branding, verified domain ownership and a general two-account smoke test. Google reconnect and sync work, confirmed by the operator and recorded production state on `6db7487`; both Google and Microsoft had successful syncs, 17 mappings each and idle owners. At 06:40 UTC, successful Google/Microsoft destinations held 16 and 16 mappings respectively; eligible counts change with ordinary source updates. Ed completed through Sync All, confirmed by both production metadata and the operator’s browser. The remaining iCloud update/removal/recreation and two-account/provider acceptance assertions stay open. The [stored-log privacy assessment](docs/deployment/log-privacy-2026-10-21.md) found raw exception text and request paths in isolated synthetic records; production log persistence stays disabled. See [the acceptance checklist](docs/deployment/acceptance-milestone-7.md) for the remaining checks.

Public pages: [Home](https://mykairos.me/), [Privacy](https://mykairos.me/privacy), [Terms](https://mykairos.me/terms), [Support](https://mykairos.me/support), [Security](https://mykairos.me/security). The release's anonymous public-page smoke passed; final policy/listing consistency remains an acceptance check. See [provider configuration and approval runbook](docs/deployment/public-beta-providers.md) and [contact routing and support runbook](docs/deployment/public-beta-support.md).

Kairos and the Firefox extension use the [MIT License](LICENSE), with Copyright (c) 2026 Kairos contributors. The standalone extension includes the same [license](extension/firefox/LICENSE) and [third-party notices](extension/firefox/THIRD_PARTY_NOTICES) for bundled code. Mozilla has published signed 0.4.0; ordinary installation, native consent and source reads are operator-confirmed. The retained submission ZIPs are unsigned build inputs. An actual version upgrade remains unverified.

## Requirements and local development

- Node.js 22.13+ and npm 10+
- Firefox 140+ on desktop for Canvas submission status and Gradescope browser-local sync
- A Canvas private calendar feed URL and/or Ed personal API token for the sources you select
- Google and Microsoft confidential Web OAuth identity clients with server-held secrets for sign-in
- Separate calendar OAuth configuration for optional Google/Microsoft calendar access
- An Apple Account app-specific password and an existing writable calendar named **Kairos** for optional iCloud access

```bash
npm install
npm run build:extension
npm run dev
```

Open `http://localhost:3000`. The root is the public homepage; authenticated dashboard routes include **Upcoming**, **Calendar**, **Assignments**, **Sources**, and **Settings**. Local development uses the D1-backed vinext runtime and applies local D1 migrations before startup. Keep private environment files out of Git. Production uses Cloudflare Workers and user-scoped Cloudflare D1, not the historical plaintext local SQLite adapter.

## Firefox bridge

Build with `npm run build:extension`, then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension/firefox/manifest.json`. Temporary add-ons are removed when Firefox restarts. This remains a developer/acceptance workflow, not public signed installation.

Install [Kairos Bridge 0.4.0 from Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/kairos-bridge/). The public record and signed artifact match the reviewed release; normal Firefox installation, native consent and Canvas/Gradescope reads are operator-confirmed. The listing now includes the data disclosure and full privacy-policy link. Onboarding uses the verified listing; missing/invalid distribution configuration still produces no install link. See [publication evidence and the future upgrade check](docs/deployment/firefox-0.4.0-publication.md).

The published 0.4.0 manifest requests `tabs` and explicit Kairos, Canvas and Gradescope host access. Its required Firefox data categories are `websiteContent` and `browsingActivity`: normalized source reads and supported-tab detection. Extension publication is separate from website deployment. The page bridge accepts exactly `http://localhost:3000`, `http://127.0.0.1:3000`, and `https://mykairos.me`. It does not request cookie, history, downloads, `<all_urls>`, or webRequest interception permissions.

Version 0.4.0 PONG reports bridge and supported-tab presence with webpage version field `not-shared`. Earlier development builds can send their installed extension version to the Kairos page as compatibility information in PONG. The local popup shows the actual installed version. Source-derived HTTP/DOM diagnostics and version compatibility information are content/control results, not optional telemetry. Passwords, cookies, CSRF tokens, authorization headers and raw authenticated HTML do not cross the page bridge. Normalized results are saved to the hosted account when synced.

## Connect coursework sources

### Canvas deadlines

1. In Canvas **Calendar**, copy your private calendar-feed/iCal export URL. Treat it like a password.
2. In Kairos **Sources → Canvas**, paste it and choose **Test connection**, then **Connect Canvas**.
3. Initial sync imports deadlines and opens **Upcoming**.

Hosted Kairos encrypts the feed URL before storing it in user-scoped D1 credentials. The URL is not returned by source-status APIs or rendered back into pages. Never commit a real feed URL.

### Canvas submission status

1. Load the Firefox extension and sign in normally at `https://canvas.uw.edu`.
2. Leave a Canvas tab open and check tab detection in the local extension popup.
3. In Kairos, use **Sync submission status** or stale-on-open refresh.

Automatic refresh runs at most once when the dashboard mounts if the previous successful check is at least 15 minutes old. Manual refresh remains available; there is no periodic background alarm. Kairos never asks for exported cookies or a Canvas access token.

### Gradescope

1. Load the extension, sign in normally at `https://www.gradescope.com/`, and leave a tab open.
2. In **Sources → Gradescope**, choose **Discover courses**.
3. Select student courses and **Save selection**, then **Sync Gradescope**.

Reads import visible course/assignment IDs and names, release/normal/late due dates, source status text, normalized submission state, published numeric score/max score and canonical assignment links. Normal due dates drive Upcoming and Calendar; late dates remain extra metadata. Stale-on-open refresh runs once when saved data is at least 15 minutes old.

Gradescope has no supported public student API for this workflow. The connector depends on authenticated student page structure, uses isolated fixture-tested parsers, and fails closed rather than guessing identities when extraction fails. Kairos does not create or own a Gradescope login session.

### Ed

1. Create/copy a personal Ed API token in Ed's token settings.
2. In **Sources → Ed**, test the token, then **Connect Ed**.
3. Select courses, **Save selection**, and **Sync Ed**.

Ed does not need Firefox. Visible Ed Lessons from enabled courses are imported, including undated lessons; hidden/unlisted lessons are excluded. Effective timestamps are preferred, and an undated lesson is not assigned an invented deadline. Completed lessons are resolved for Upcoming. Kairos performs no Ed writes. The beta/unofficial API can change; failed parsing retains previously known data.

Hosted Kairos encrypts the Ed token before D1 storage, decrypts it on the server for reads, and never returns/displays it after saving. Ordinary coursework and metadata are not encrypted by Kairos at the application layer. Rotate/revoke an exposed token in Ed.

## Optional calendar destinations

Calendar copies are outbound only and do not change source coursework. Google creates a secondary **Kairos** calendar. Microsoft creates or reuses a dedicated **Kairos** calendar. For iCloud, create a writable calendar named **Kairos** yourself before connecting; the connector discovers it rather than creating it.

An eligible due assignment becomes a 15-minute transparent/free marker at its exact due time. The event includes course/assignment title, source name, status and a cleaned source link. Repeated sync is idempotent; deadline changes update events, deleted generated events are recreated on reconciliation, and explicitly undated assignments lose their generated events. **Hide submitted assignments** defaults on under **Sources → Calendar destinations** and removes Submitted/Graded/Excused work from generated events. Changing it resynchronizes connected destinations.

**Sync All** refreshes sources, then synchronizes each calendar destination in a separate browser request. Hosted source requests do not perform calendar writes inline. An open app reconciles after a source refresh and on becoming visible when the last calendar sync is at least 15 minutes old. Failed automatic attempts remain paced; changes are not continuously published while the app is closed.

### Google

Use a Google OAuth **Web application** and enable the Calendar API. Register the exact production calendar callback `https://mykairos.me/api/calendars/google/callback`; local development registers the exact origin you use, such as `http://localhost:3000/api/calendars/google/callback` or `http://127.0.0.1:3000/api/calendars/google/callback`.

Configure `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` privately. Authorization code + PKCE requests only `https://www.googleapis.com/auth/calendar.app.created`, with offline access and explicit consent for refresh-token issuance. It does not request broad access to all Google calendars.

Identity separately requests `openid email profile`, callback `https://mykairos.me/api/auth/callback/google`, using `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. Published status is separate from brand/data-access verification and independent non-test-user acceptance.

### Microsoft

Use a confidential **Web** Entra registration, with supported accounts **Accounts in any organizational directory and personal Microsoft accounts** (`AzureADandPersonalMicrosoftAccount`) for `common`. Hosted registration is not a Mobile/desktop public-client flow.

Register `https://mykairos.me/api/calendars/microsoft/callback`. Configure `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET` (the secret **value**, not secret ID), and `MICROSOFT_CALENDAR_TENANT=common` privately. Hosted authorization code + PKCE uses a server-held secret. Delegated calendar scopes are `offline_access Calendars.ReadWrite`; Kairos lists calendars to find its dedicated destination and reads/writes generated events there. For local Web callbacks, register the actual local URI you use separately.

Identity separately uses `openid profile email User.Read`, callback `https://mykairos.me/api/auth/callback/microsoft-entra-id`, and `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_MICROSOFT_ENTRA_ID_SECRET`. The issuer defaults to `https://login.microsoftonline.com/common/v2.0`. Managed accounts may require administrator consent.

### Apple iCloud

Enable Apple Account two-factor authentication and generate an app-specific password at `account.apple.com`. Create a writable calendar named **Kairos** in iCloud Calendar first. In **Sources → Calendar destinations**, enter your Apple Account email and app-specific password, then **Test iCloud** and **Connect iCloud**. The client uses Apple's fixed CalDAV service and validates discovered/redirected Apple partition hosts; there is no arbitrary custom CalDAV URL.

### Storage, deletion and revocation

Hosted source/calendar credentials and persisted pending PKCE verifiers use AES-GCM encryption with a server-held key. Calendar refresh tokens are encrypted; short-lived calendar access tokens are used in memory. Pending calendar authorization expires after ten minutes, but expiry is not immediate row deletion. Identity OAuth access/refresh/ID tokens are not persisted in account records; session records and cookies remain necessary for login.

**Disconnect** removes the Kairos connection, credentials and mappings, leaving remote events/calendars and provider grants. **Remove generated events** attempts deletion while connected; verify its result, then disconnect to stop later reconciliation from recreating eligible events. **Settings → Delete account** removes live user records, not remote events or provider consent. Revoke access separately in Google/Microsoft account controls, Ed token settings, Apple app-specific password controls, or reset an exposed Canvas feed URL.

D1 recovery history can retain deleted records for 7 days (Free) or 30 days (Paid); the operator reports Workers Free, with actual recovery settings and capacity still requiring final acceptance. Persistent application logs are currently disabled. The full [privacy notice](https://mykairos.me/privacy) explains third-party processing, email correspondence, recovery history and prepared controls.

Legacy local SQLite adapters remain in historical tests; their plaintext model is not the current hosted implementation. The development server uses local D1. Deleting `.data/assignments.sqlite` does not reset current D1 or the hosted account. Use account deletion in the relevant environment; tests use isolated temporary D1 instances. Do not issue remote database deletion/reset commands as a local reset.

## Coursework behavior

Sources remain independent; Kairos does not silently merge conflicting deadlines. Submitted, Graded and Excused work is hidden from **Upcoming** while remaining in **Calendar** and **All Assignments**. Unknown status remains **Status unavailable** rather than being guessed from a missing grade. Late and Missing are independent flags. Published Gradescope numeric scores are decimal strings; Kairos does not invent percentages or letter grades.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run db:verify
npm run build:extension
npm run test:e2e
npm run build
npm run build:vinext
node scripts/verify-dynamic-dashboard-build.mjs
node scripts/verify-production-safety.mjs
```

Install Playwright browsers with `npx playwright install chromium firefox` when required. Chromium E2E covers source onboarding, Ed fixtures, iCloud event reconciliation on an existing discovered calendar, and authenticated tenant isolation. Firefox tests use deterministic bridge shims. CI does not rely on live provider credentials. The public-page component checks render real pages without a session and verify purpose, separate consent, privacy limits and domain-only contacts.

For real-account acceptance, use authorized accounts, compare imported fields with official source pages, check sync errors retain prior records, and verify calendar create/repeat/update/event-recreate and explicit removal outcomes. iCloud acceptance requires a pre-existing writable Kairos calendar. A Google/Microsoft whole-calendar deletion should report the missing destination until explicit reconnect. Record account labels and outcomes only; never publish credentials, feed URLs, private inbox addresses or raw authenticated responses. Historical Milestone 6 acceptance does not replace current independent-account, revocation/deletion, provider approval or delivery checks.
