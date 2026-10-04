# Kairos

Kairos is named for the Greek personification of the right or opportune moment. It is a local-first deadline dashboard for a UW Seattle student. Milestone 1 connects to the private Canvas calendar/iCal feed, stores normalized assignment metadata in SQLite, and presents the same records in **Upcoming**, **Calendar**, and **All Assignments** views.

This is a personal tool, not an official University of Washington product. It does not use UW logos and never asks for your UW NetID password.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The root route sends you to **Upcoming**.

By default the local SQLite database is `.data/assignments.sqlite`. You can override it with `ASSIGNMENTS_DB_PATH`; see `.env.example`.

## Connect Canvas

1. In Canvas, open **Calendar** and find the calendar-feed/iCal export option.
2. Copy your private calendar feed URL. Treat it like a password: anyone with the full URL may be able to read the feed.
3. In Kairos, open **Sources → Canvas**.
4. Paste the URL, choose **Test connection**, then **Connect Canvas**.
5. The initial sync imports assignment events and sends you to **Upcoming**.

The feed URL is stored only in the local SQLite credential table. It is not returned in source-status API responses, rendered into pages, or committed to Git.

## What milestone 1 does

- Canvas iCal ingestion without a Canvas REST API token
- idempotent manual sync
- non-destructive partial-feed handling
- Upcoming urgency groups
- month calendar
- searchable/filterable assignment table
- local timezone preference (default `America/Los_Angeles`)
- light/dark theme
- responsive navigation and compact narrow-screen list

Gradescope and Ed are intentionally shown as future connectors only. They do not request credentials or pretend to sync yet.

## Tests

Install Playwright's local Chromium binary once after `npm install`:

```bash
npx playwright install chromium
```

Then run the verification suite:

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

Playwright uses a fixture-only local Canvas feed route and an isolated database. The fixture route is unavailable unless `E2E_FIXTURES=1`.

## Reset local data

Stop the development server and remove the local database:

```bash
rm -f .data/assignments.sqlite .data/assignments.sqlite-wal .data/assignments.sqlite-shm
```

Then restart with `npm run dev` and reconnect Canvas.

## Privacy notes

- Do not paste your UW password into this app.
- Do not commit `.data/`, `.env` files, or a real Canvas feed URL.
- A failed sync does not delete previously imported assignments.
- Canvas, Gradescope, and Ed may disagree on deadlines; future cross-source linking will preserve those differences rather than silently overwriting one source.
