# Kairos

Kairos is an assignment dashboard for students. It combines Canvas deadlines, Canvas submission status, a direct read-only Gradescope connector, a direct read-only Ed connector, and outbound calendar synchronization to Google Calendar, Outlook / Microsoft 365, and Apple iCloud Calendar.

This is a personal tool, not an official University of Washington product. It does not use UW logos and never asks for your UW NetID, Canvas, or Gradescope password.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Firefox for Canvas submission-status and Gradescope browser-local sync
- An Ed personal API token if you want to connect Ed
- A Google OAuth web-application client ID if you want Google Calendar sync
- A Microsoft Entra public-client application ID if you want Outlook / Microsoft 365 Calendar sync
- An Apple Account app-specific password if you want iCloud Calendar sync

## Install and run

```bash
npm install
npm run build:extension
npm run dev
```

Open `http://localhost:3000`. The root route is the public Kairos homepage; authenticated dashboard routes live under **Upcoming**, **Calendar**, **Assignments**, **Sources**, and **Settings**.

Local development uses the D1-backed vinext runtime and applies local D1 migrations before startup.

## Milestone 6 hosted status

The automated implementation for the multi-user hosted foundation is complete. Production deployment and real-account hosted acceptance at `https://mykairos.me` are still pending, so Milestone 6 is not yet marked complete.

The hosted acceptance gate uses two independent users and verifies production Google/Microsoft sign-in, strict cross-user isolation, Google/Microsoft/iCloud calendar flows, the Firefox bridge on the exact production origin, account deletion isolation, credential non-exposure, and rollback. The checklist is in `docs/deployment/acceptance-milestone-6.md`.

## Load the Firefox extension

Build the extension first:

```bash
npm run build:extension
```

Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select `extension/firefox/manifest.json`.
4. Open the Kairos extension popup to see Canvas and Gradescope tab detection.

Temporary Firefox add-ons are removed when Firefox restarts, so reload the extension after a restart.

The extension requests only `tabs` plus explicit Kairos, Canvas, and Gradescope host access. Its page bridge accepts exactly `http://localhost:3000`, `http://127.0.0.1:3000`, and `https://mykairos.me`; it does **not** request cookie, history, downloads, `<all_urls>`, or webRequest interception permissions.

Milestone 6 keeps Firefox installation development/manual: load the extension as a temporary add-on for local or hosted acceptance testing. Mozilla-signed public distribution is planned separately for public-beta readiness.

## Connect Canvas deadlines

1. In Canvas, open **Calendar** and find the calendar-feed/iCal export option.
2. Copy your private calendar feed URL. Treat it like a password: anyone with the full URL may be able to read the feed.
3. In Kairos, open **Sources → Canvas**.
4. Paste the URL, choose **Test connection**, then **Connect Canvas**.
5. The initial sync imports assignment deadlines and sends you to **Upcoming**.

The feed URL is stored only in the local SQLite credential table. It is not returned in source-status API responses, rendered into pages, or committed to Git.

## Enable Canvas submission status

1. Load the Firefox extension.
2. Sign in to `https://canvas.uw.edu` normally and leave at least one Canvas tab open.
3. Open Kairos.
4. Confirm the extension popup reports a Canvas tab.
5. Use **Sync submission status**, or let stale-on-open refresh run.

Kairos never asks for a Canvas access token, UW password, exported cookie, or authorization header. The authenticated Canvas page stays inside the extension; Kairos receives only normalized status data.

Automatic status refresh is enabled when the last successful check is at least **15 minutes** old and runs at most once when the dashboard mounts. Manual refresh remains available. There is no periodic background alarm.

## Connect Gradescope

Gradescope uses the same browser-local trust boundary; Kairos does not create or own a Gradescope login session.

1. Load the Firefox extension.
2. Sign in normally at `https://www.gradescope.com/` and leave a Gradescope tab open.
3. In Kairos, open **Sources → Gradescope**.
4. Choose **Discover courses**.
5. Select the student courses Kairos should sync and choose **Save selection**.
6. Choose **Sync Gradescope**, or let stale-on-open refresh run once the saved data is at least 15 minutes old.

The connector imports, when visible to the student:

- course identity and name;
- assignment identity and title;
- release date;
- normal due date;
- late due date;
- exact Gradescope status text;
- normalized submission state;
- published numeric score and maximum score;
- a canonical Gradescope assignment link.

The normal due date remains the deadline used by **Upcoming** and **Calendar**. A late due date is preserved as additional source metadata rather than silently replacing the original deadline.

Gradescope course discovery and assignment reads happen inside the signed-in `www.gradescope.com` content script. Kairos never receives the Gradescope password, session cookie, CSRF token, response headers, or raw authenticated HTML. Website-to-extension requests contain only fixed protocol message types and validated numeric course identifiers; the connector is read-only.

### Gradescope maintenance caveat

Gradescope does not provide a supported public student API for this workflow. This connector therefore depends on the authenticated student web page structure. The parser is isolated, fixture-tested, versioned, and fails closed with a parse error rather than guessing identities, but a future Gradescope HTML change may require an extractor update.

## Connect Ed

Ed uses a direct read-only API connection and does **not** require the Firefox extension.

1. In Ed, open the API-token settings page and create/copy a personal API token.
2. In Kairos, open **Sources → Ed**.
3. Paste the token and choose **Test connection**.
4. Choose **Connect Ed**.
5. Select the Ed courses Kairos should sync and choose **Save selection**.
6. Choose **Sync Ed**.

Kairos imports all visible Ed Lessons from enabled courses, including lessons without due dates. Hidden and unlisted lessons are excluded. Effective release/due timestamps are preferred when Ed supplies them; Kairos never invents a deadline for an undated lesson. Completed Ed lessons are treated as resolved work for Upcoming, while attempted/unattempted lessons remain unresolved.

The Ed token is stored in Kairos's local SQLite `source_credentials` table and is never returned or displayed after it is saved. **The local SQLite database is not encrypted at rest in this milestone**, so anyone with access to that database may be able to recover the token. Use Ed's token settings to rotate/revoke it if necessary.

The Ed API used by this connector is beta/unofficial and may change independently of Kairos. The client/parser are isolated and fail closed so a changed response does not erase previously known lesson data. Kairos performs no Ed writes.

## Publish deadlines to external calendars

Calendar destinations are outbound only: Canvas, Gradescope, and Ed bring assignments into Kairos, while Google Calendar, Outlook / Microsoft 365, and Apple iCloud Calendar receive copies of Kairos deadlines. Calendar edits never change source assignments.

Kairos creates or uses a dedicated **Kairos** calendar for each destination. Every eligible assignment with a due date becomes a 15-minute transparent/free deadline marker beginning at the exact due timestamp. Repeated sync is idempotent, due-date changes update the existing event, and a manually deleted generated event is recreated on the next reconciliation. Assignments without a due date are not published; if a previously dated assignment becomes explicitly undated, its generated event is removed.

**Hide submitted assignments** is enabled by default under **Sources → Calendar destinations**. When enabled, Submitted, Graded, and Excused work is removed from generated calendar events; if an assignment becomes active/not-submitted again, its event is recreated. Turn the option off to keep completed deadlines visible in destination calendars. Changing the option immediately resynchronizes connected calendar destinations.

Open **Sources → Calendar destinations** to connect a provider. **Sync All** refreshes assignment sources first, then performs one calendar reconciliation pass using the resulting local database state. While Kairos is open, a stale destination is reconciled when the app becomes visible if the last calendar sync is at least 15 minutes old. Kairos has no hosted background worker, so new upstream changes are not published continuously while the app is closed.

### Google Calendar

1. In Google Cloud, create an OAuth 2.0 client for a **Web application**.
2. Enable the Google Calendar API for that project.
3. Add the exact local callback URI for the address you use, for example `http://localhost:3000/api/calendars/google/callback`. If you use the numeric loopback address, also add `http://127.0.0.1:3000/api/calendars/google/callback`.
4. Put the client ID in `GOOGLE_CALENDAR_CLIENT_ID` and the client secret in `GOOGLE_CALENDAR_CLIENT_SECRET`.
5. Run Kairos on the same local origin whose callback URI you registered, then choose **Connect Google Calendar** under **Sources → Calendar destinations** and complete Google consent.

Kairos uses OAuth authorization-code flow with PKCE and a local loopback callback. It requests only `https://www.googleapis.com/auth/calendar.app.created`, which is scoped to secondary calendars created by the app and events on those calendars. Kairos does not request broad access to all calendars. Connect/reconnect explicitly requests consent so Google can issue a refresh token even when the account had previously authorized Kairos.

### Outlook / Microsoft 365

1. Register an application in Microsoft Entra.
2. Configure it as a **Mobile and desktop application / public client**, enable public-client flows, and register the localhost callback path `http://localhost/api/calendars/microsoft/callback`. Microsoft ignores the port when matching localhost loopback redirects but still matches the path, so keep `/api/calendars/microsoft/callback` exact.
3. Put the Application (client) ID in `MICROSOFT_CALENDAR_CLIENT_ID`.
4. Leave `MICROSOFT_CALENDAR_TENANT=common` to support personal Microsoft accounts plus work/school accounts, or replace it with the tenant you intentionally target.
5. In **Sources → Calendar destinations**, choose **Connect Microsoft Calendar** and complete Microsoft consent.

Kairos uses authorization code + PKCE without a client secret. Microsoft exposes event writing through the broader delegated `Calendars.ReadWrite` permission, plus `offline_access` for refresh-token use. Kairos still writes only its dedicated Kairos calendar.

### Apple iCloud Calendar

1. Make sure your Apple Account uses two-factor authentication.
2. At `account.apple.com`, open **Sign-In and Security → App-Specific Passwords** and generate a password for Kairos.
3. In **Sources → Calendar destinations**, enter your Apple Account email and that app-specific password.
4. Choose **Test iCloud**, then **Connect iCloud**.

Kairos connects only to Apple's fixed iCloud CalDAV service and validates discovered/redirected Apple CalDAV partition hosts before sending credentials. There is no arbitrary custom CalDAV server URL in this milestone.

### Calendar credentials and disconnect behavior

Google/Microsoft refresh tokens and the iCloud app-specific password are stored only in the local server-side SQLite credential table. Short-lived OAuth access tokens and PKCE verifiers are not durable calendar credentials. Calendar secrets are not returned by normal Kairos APIs or rendered back after capture.

**The local SQLite database is not encrypted at rest.** Anyone with access to that database may be able to recover stored calendar credentials. Revoke Google/Microsoft app access at the provider, or revoke the Apple app-specific password, if the local database or device is compromised.

**Disconnect** removes the local Kairos connection, credentials, and event mappings but does not silently delete the remote calendar. **Remove generated events** is a separate explicit action that removes Kairos-managed events while keeping the connection. With Google's narrow app-created-calendar permission, an empty secondary Kairos calendar may need to be deleted manually in Google Calendar settings.

## Submission-status states

Kairos displays these normalized states across sources:

- **Not submitted**
- **Submitted**
- **Graded**
- **Excused**
- **Status unavailable** for unknown or unavailable data

**Late** and **Missing** are independent flags. Kairos does not infer **Not submitted** merely because a grade is absent.

Published Gradescope scores are stored as decimal strings rather than floating-point calculations. Kairos preserves the displayed score and does not invent percentages or letter grades.

## Cross-source behavior

Canvas, Gradescope, and Ed records remain independent. Kairos does not silently deduplicate assignments or choose one source as the canonical deadline when sources disagree.

Resolved work—Submitted, Graded, or Excused—is hidden from **Upcoming** while remaining visible in **Calendar** and **All Assignments** with its completion styling.

## Tests

Install Playwright browser binaries once after `npm install`:

```bash
npx playwright install chromium firefox
```

Then run the verification suite:

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

The Chromium E2E project covers Canvas iCal onboarding, deterministic Ed API onboarding/sync fixtures, deterministic iCloud/CalDAV calendar create-repeat-update-delete/recreate behavior, and two independent authenticated users with tenant-isolation checks. Firefox E2E tests use deterministic page-level extension bridge shims for Canvas submission status and Gradescope discovery/sync. CI never depends on live Canvas, Gradescope, Ed, Google, Microsoft, or iCloud sessions or real credentials.

### Real-browser acceptance smoke

Canvas:

1. Keep a signed-in `canvas.uw.edu` tab open.
2. Run **Sync submission status** and confirm a known assignment matches Canvas.
3. Close all Canvas tabs and verify Kairos reports the no-tab condition without deleting the saved status.

Gradescope:

1. Keep a signed-in `www.gradescope.com` student tab open.
2. Run **Discover courses** and confirm the expected student courses appear.
3. Enable at least one course and sync.
4. Compare at least one real assignment's title, release date, due date, late due date, source status, published score/max score, and link with Gradescope.
5. Confirm Submitted/Graded work is absent from Upcoming but remains in Calendar and All Assignments.
6. Close Gradescope tabs, then sign out in a separate check, and verify errors are actionable while previously saved data remains.

Ed:

1. Create/use a personal Ed API token without pasting it into chat, shell history, fixtures, or committed files.
2. In Kairos, test and connect the token.
3. Confirm the expected Ed courses appear and enable at least one.
4. Sync and compare real lesson titles, visibility, progress, release dates, and due dates with Ed.
5. If the course has an undated lesson, confirm it remains in All Assignments but not Upcoming.
6. Confirm completed lessons are absent from Upcoming.
7. Replace the saved token only after a new token validates; an invalid replacement must not destroy the last working credential.
8. Confirm the saved token is never rendered back by Kairos or returned in Kairos API responses.

### Calendar real-account acceptance smoke

Google Calendar, Outlook / Microsoft 365, and Apple iCloud Calendar have passed real-account smoke on this branch.

Google Calendar:

1. Authorize with your local Google web OAuth application.
2. Confirm Kairos creates a dedicated **Kairos** calendar and one event for a known due assignment.
3. Sync again and confirm no duplicate is created.
4. Change a due date in a source, refresh Kairos, and confirm the same generated event moves.
5. Delete one generated event in Google Calendar and confirm Kairos recreates it on the next reconciliation.
6. Delete the whole remote Kairos calendar and confirm ordinary sync reports the missing calendar instead of silently recreating it.
7. Use **Reconnect Google Calendar** and confirm the explicit reconnect restores a usable destination.

Outlook / Microsoft 365:

1. Complete the same create, repeat, due-date update, event-delete/recreate, whole-calendar-missing, and reconnect checks.
2. After a local disconnect/reconnect, confirm the surviving remote **Kairos** calendar still has only one event per assignment; Kairos stores a hidden assignment identity on Microsoft events so reconnect can adopt them without duplication.
3. Confirm the Microsoft consent screen grants calendar write/offline access only and does not request unrelated mail, files, or contacts permissions.

Apple iCloud Calendar:

1. Connect using your Apple Account email plus an app-specific password without pasting the credential into chat, shell history, fixtures, or committed files.
2. Confirm a dedicated writable **Kairos** calendar is created.
3. Complete the same create, repeat, due-date update, and event-delete/recreate checks.
4. Confirm the app-specific password is cleared from the form and never appears in Kairos API responses.

## Reset local data

Stop the development server and remove the local database:

```bash
rm -f .data/assignments.sqlite .data/assignments.sqlite-wal .data/assignments.sqlite-shm
```

Then restart with `npm run dev` and reconnect the sources you use.

## Privacy notes

- Do not paste your UW, Canvas, or Gradescope password into Kairos. Ed uses a personal API token; iCloud Calendar uses an Apple app-specific password rather than your primary Apple Account password.
- Do not commit `.data/`, `.env` files, a real Canvas feed URL, or a real Ed API token.
- Do not export Canvas or Gradescope cookies for Kairos.
- The extension has no cookie API permission and never sends authenticated Canvas/Gradescope HTML through the page bridge.
- A failed or partial sync retains previously known assignment, status, and grade data.
- Canvas, Gradescope, and Ed may disagree; Kairos preserves those differences rather than destructively merging them.
