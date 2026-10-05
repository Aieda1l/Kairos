# Kairos Roadmap

**Updated:** 2026-10-05

This file records the current milestone numbering for Kairos. Approved milestone design/specification documents remain historical records and are not renumbered retroactively.

## Milestone 1 — Core local assignment dashboard — Complete

Delivered:
- local-first Next.js + TypeScript application
- SQLite persistence
- Canvas iCal onboarding and synchronization
- Upcoming, Calendar, and All Assignments views
- course/source filters and assignment detail UI
- source health, timezone/settings, light/dark themes
- responsive/accessibility work
- fixture-driven unit, integration, component, and E2E coverage

Primary archival docs:
- `docs/superpowers/specs/2026-10-03-uw-assignment-dashboard-design.md`
- `docs/superpowers/plans/2026-10-03-uw-assignment-dashboard-milestone-1.md`

## Milestone 2 — Canvas submission status — Complete

Delivered:
- Firefox-first unpacked WebExtension
- signed-in `canvas.uw.edu` tab reuse without exporting credentials/cookies
- normalized Not submitted / Submitted / Graded / Excused / Status unavailable states
- independent Late and Missing flags
- stale-on-open refresh plus website-owned manual refresh
- failure-safe persistence that retains prior known status
- extension/website protocol validation and security boundaries
- automated unit, integration, component, extension, and E2E coverage

Primary docs:
- `docs/superpowers/specs/2026-10-03-canvas-submission-status-design.md`
- `docs/superpowers/plans/2026-10-03-canvas-submission-status-milestone-2.md`

## Milestone 3 — Direct Gradescope connector — Complete

Implemented:
- direct read-only Gradescope access through the existing Firefox extension;
- reuse of an already signed-in `www.gradescope.com` tab without exporting passwords, cookies, CSRF tokens, response headers, or raw authenticated HTML;
- student course discovery with explicit local course selection;
- release, due, late-due, source-status, normalized submission state, published score/max score, and source-link persistence;
- stale-on-open plus manual Gradescope refresh;
- partial/failure-safe persistence that keeps prior known assignment/status/grade data;
- strict source-specific bridge protocols and numeric-identity validation;
- fixture-driven parser, protocol, repository, integration, component, and Firefox E2E coverage;
- source-independent Upcoming/Calendar resolution behavior while preserving Gradescope records separately from Canvas.

Completed validation:
- real-browser smoke against the user's signed-in Gradescope account confirmed discovery/sync behavior before PR #11 was squash-merged.

Primary docs:
- `docs/superpowers/specs/2026-10-04-gradescope-connector-design.md`
- `docs/superpowers/plans/2026-10-04-gradescope-connector-milestone-3.md`

## Milestone 4 — Direct Ed connector — Complete

Delivered:
- direct read-only Ed API access using a user-created personal API token;
- token persistence only in the local server-side SQLite credential table;
- enrolled-course discovery with explicit local course selection;
- all visible Ed Lessons imported, including undated lessons;
- hidden/unlisted lesson exclusion and conservative progress normalization;
- effective release/due timestamp support without invented deadlines;
- partial/failure-safe per-course synchronization that preserves prior data;
- Ed Sources UI with test/connect, token replacement, course refresh/selection, and manual sync;
- Ed-native progress labels in assignment surfaces plus one purple Upcoming Sync All action for every connected source;
- deterministic integration/component/E2E coverage designed to assert token non-exposure.

Completed validation:
- full feature CI passed: Vitest, lint, typecheck, Firefox extension build, Playwright E2E, production build, dynamic-dashboard verification, and credential/permission review;
- real-account smoke confirmed Ed token connection, course discovery/selection, lesson synchronization, Ed-native progress/status presentation, calendar styling, and the Upcoming Sync All workflow.

Primary docs:
- `docs/superpowers/specs/2026-10-05-ed-connector-design.md`
- `docs/superpowers/plans/2026-10-05-ed-connector-milestone-4.md`

## Later extension follow-ups — Planned, not yet numbered

- Chromium support for the Canvas submission-status extension
- optional opt-in periodic background refresh while preserving stale-on-open as the default behavior

## Deferred ideas — Not committed milestones

These remain intentionally deferred until the core aggregation/integration workflow proves reliable:
- notifications
- mobile-native app
- cloud accounts or multi-device sync
- application-level user authentication
- AI planning/prioritization
- analytics dashboards
- collaboration/comments/notes
- plugin marketplace
- complex recurring scheduling

## Cross-source behavior

As additional sources arrive, Kairos should preserve each source record independently. Potential duplicates may be linked, and conflicting due dates should be shown explicitly; Kairos should not silently invent a canonical deadline or destructively merge records.
