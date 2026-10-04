# Kairos

Kairos is a local-first deadline dashboard for a UW Seattle student. Canvas iCal remains the authoritative source for deadlines, while Milestone 2 adds student submission status through a small Firefox extension that uses an already signed-in Canvas tab.

This is a personal tool, not an official University of Washington product. It does not use UW logos, does not ask for your UW NetID password, and does not export or store Canvas cookies.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Firefox for Canvas submission-status sync

## Install and run

```bash
npm install
npm run build:extension
npm run dev
```

Open `http://localhost:3000`. The root route sends you to **Upcoming**.

By default the local SQLite database is `.data/assignments.sqlite`. You can override it with `ASSIGNMENTS_DB_PATH`; see `.env.example`.

## Connect Canvas deadlines

1. In Canvas, open **Calendar** and find the calendar-feed/iCal export option.
2. Copy your private calendar feed URL. Treat it like a password: anyone with the full URL may be able to read the feed.
3. In Kairos, open **Sources → Canvas**.
4. Paste the URL, choose **Test connection**, then **Connect Canvas**.
5. The initial sync imports assignment deadlines and sends you to **Upcoming**.

The feed URL is stored only in the local SQLite credential table. It is not returned in source-status API responses, rendered into pages, or committed to Git.

## Enable Canvas submission status in Firefox

Build the extension first:

```bash
npm run build:extension
```

Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select `extension/firefox/manifest.json`.
4. Sign in to `https://canvas.uw.edu` and leave at least one Canvas tab open.
5. Open `http://localhost:3000`.
6. Open the Kairos extension popup and confirm that Canvas is detected.
7. Use **Sync submission status** in Kairos, or leave automatic stale-on-open refresh enabled.

Temporary Firefox add-ons are removed when Firefox restarts, so reload the extension after a restart.

Kairos never asks for a Canvas access token, UW password, exported cookie, or authorization header. The extension broker asks the open Canvas tab to fetch only the Canvas assignment pages derived from Kairos's numeric course/assignment locators. The page content stays inside the extension; Kairos receives only normalized status fields.

Automatic refresh is enabled by default when the last successful status check is at least **15 minutes** old. It runs at most once when a dashboard page is mounted. Manual **Sync submission status** is always available. Milestone 2 intentionally has no periodic background alarm or timer.

Chrome/Chromium extension support is deferred.

## Submission-status states

Kairos displays these primary states:

- **Not submitted**
- **Submitted**
- **Graded**
- **Excused**
- **Status unavailable** for unknown or unavailable data

**Late** and **Missing** are independent flags and can appear alongside the primary state. Kairos does not infer **Not submitted** merely because Canvas does not show a “Submitted” label.

The legacy assignment `status` field from iCal remains source metadata and is not used as the student's submission state.

## What Milestone 2 adds

- Canvas iCal remains authoritative for deadlines
- local SQLite persistence of normalized submission status
- Firefox WebExtension bridge with no cookie API permission
- same-origin Canvas requests from the authenticated Canvas tab
- website-owned manual sync
- stale-on-open automatic refresh after 15 minutes
- sequential batches of at most 100 assignments
- actionable extension-missing, no-tab, signed-out, partial, and success states
- Settings diagnostics for automatic refresh, last success, and extension detection

Gradescope and Ed remain future connectors only.

## Tests

Install Playwright's Chromium and Firefox binaries once after `npm install`:

```bash
npx playwright install chromium firefox
```

Then run the verification suite:

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

The Chromium E2E project retains the Canvas iCal onboarding smoke test. The Firefox project tests the submission-status workflow with a deterministic page-level extension bridge shim that speaks the same protocol as the real extension. CI never depends on live `canvas.uw.edu`, UW credentials, or a user's Canvas page HTML.

For a real-browser acceptance smoke, load the temporary Firefox extension, keep one signed-in `canvas.uw.edu` tab open, open Kairos, and run **Sync submission status**. Confirm a known assignment changes from **Status unavailable** to the expected state. Then close all Canvas tabs and verify Kairos shows the actionable no-tab message without deleting the saved status. Signing out of Canvas should likewise preserve the last saved status while reporting the signed-out condition.

## Reset local data

Stop the development server and remove the local database:

```bash
rm -f .data/assignments.sqlite .data/assignments.sqlite-wal .data/assignments.sqlite-shm
```

Then restart with `npm run dev` and reconnect Canvas.

## Privacy notes

- Do not paste your UW password into this app.
- Do not commit `.data/`, `.env` files, or a real Canvas feed URL.
- Do not export Canvas cookies for Kairos.
- The Firefox extension requests only `tabs` plus the explicit Canvas/Kairos host permissions in its manifest; it does not request cookie, history, downloads, or `<all_urls>` access.
- A failed deadline or submission-status sync does not delete previously stored assignments/statuses.
- Canvas, Gradescope, and Ed may disagree on deadlines; future cross-source linking will preserve those differences rather than silently overwriting one source.
