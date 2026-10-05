# Kairos

Kairos is a local-first assignment dashboard for a UW Seattle student. It combines Canvas deadlines, Canvas submission status, a direct read-only Gradescope connector, and a direct read-only Ed connector.

This is a personal tool, not an official University of Washington product. It does not use UW logos and never asks for your UW NetID, Canvas, or Gradescope password.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Firefox for Canvas submission-status and Gradescope browser-local sync
- An Ed personal API token if you want to connect Ed

## Install and run

```bash
npm install
npm run build:extension
npm run dev
```

Open `http://localhost:3000`. The root route sends you to **Upcoming**.

By default the local SQLite database is `.data/assignments.sqlite`. You can override it with `ASSIGNMENTS_DB_PATH`; see `.env.example`.

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

The extension requests only `tabs` plus explicit Kairos, Canvas, and Gradescope host access. It does **not** request cookie, history, downloads, `<all_urls>`, or webRequest interception permissions.

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
npm run build:extension
npm run test:e2e
npm run build
```

The Chromium E2E project covers Canvas iCal onboarding and deterministic Ed API onboarding/sync fixtures. Firefox E2E tests use deterministic page-level extension bridge shims for Canvas submission status and Gradescope discovery/sync. CI never depends on live Canvas, Gradescope, or Ed sessions or real credentials.

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

## Reset local data

Stop the development server and remove the local database:

```bash
rm -f .data/assignments.sqlite .data/assignments.sqlite-wal .data/assignments.sqlite-shm
```

Then restart with `npm run dev` and reconnect the sources you use.

## Privacy notes

- Do not paste your UW, Canvas, or Gradescope password into Kairos. Ed uses a personal API token instead of your password.
- Do not commit `.data/`, `.env` files, a real Canvas feed URL, or a real Ed API token.
- Do not export Canvas or Gradescope cookies for Kairos.
- The extension has no cookie API permission and never sends authenticated Canvas/Gradescope HTML through the page bridge.
- A failed or partial sync retains previously known assignment, status, and grade data.
- Canvas, Gradescope, and Ed may disagree; Kairos preserves those differences rather than destructively merging them.
