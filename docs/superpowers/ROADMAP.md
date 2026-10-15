# Kairos Roadmap

**Updated:** 2026-10-10

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

## Milestone 5 — Calendar destination sync — Complete

Implemented:
- outbound one-way synchronization from Kairos assignments to dedicated Google Calendar, Outlook / Microsoft 365, and Apple iCloud Calendar destinations;
- calendar destinations modeled separately from assignment sources so Canvas, Gradescope, and Ed provenance remains unchanged;
- deterministic 15-minute deadline event projection with idempotent create/update/recreate behavior and no event for undated assignments;
- default-on **Hide submitted assignments** calendar preference that removes Submitted, Graded, and Excused work from generated events and recreates events if work becomes active again;
- Google OAuth authorization-code + PKCE using the narrow `calendar.app.created` scope;
- Microsoft public-client authorization-code + PKCE using delegated `Calendars.ReadWrite` plus `offline_access`;
- Apple iCloud CalDAV using an Apple Account email + app-specific password and validated Apple CalDAV host discovery/redirects;
- local server-side SQLite storage for refresh tokens/app-specific credentials, with no credential echo and no claim of encryption at rest;
- provider-isolated reconciliation with durable assignment↔remote-event mappings, partial/error health, and no rollback of successful source synchronization;
- source-triggered best-effort reconciliation plus one final calendar pass in the Upcoming **Sync All** workflow;
- stale-on-visible reconciliation while Kairos is open, without a hosted 24/7 background worker;
- explicit **Remove generated events**, **Disconnect**, and provider reconnect behavior;
- deterministic unit, repository/integration, component, and Playwright E2E coverage including idempotency, due-date updates, user-deleted event recreation, provider failure isolation, and secret non-exposure.

Automated validation:
- feature CI has passed Vitest, lint, typecheck, Firefox extension build, Playwright E2E, production build, dynamic-dashboard verification, and credential/permission review on the implementation branch.

Completed real-account validation:
- Google Calendar connect/sync behavior;
- Outlook / Microsoft 365 connect/sync behavior, secondary-calendar visibility, reconnect, and duplicate-prevention behavior;
- Apple iCloud Calendar connect/sync behavior, writable Kairos calendar creation, repeat/idempotency, due-date update, event-delete/recreate behavior, and app-specific-password non-exposure.

Primary docs:
- `docs/superpowers/specs/2026-10-05-calendar-sync-design.md`
- `docs/superpowers/plans/2026-10-05-calendar-sync-milestone-5.md`

## Milestone 6 — Multi-user hosted foundation — Complete

Implemented across 6A–6C:
- Cloudflare Workers/vinext, D1, Auth.js, and tenant schema foundation;
- AES-GCM hosted credential encryption plus durable, user-bound browser-sync and calendar-OAuth request state;
- tenant-scoped D1 repositories, services, APIs, calendar reconciliation, and dashboard reads;
- production runtime removal of legacy SQLite, with `better-sqlite3` retained only for test harnesses;
- production configuration for `https://mykairos.me` on Cloudflare Workers with D1 persistence;
- Google and Microsoft account authentication through Auth.js with hosted-safe session handling;
- strict per-user tenancy across sources, assignments, settings, credentials, calendar destinations, and OAuth transactions;
- composite database constraints plus repository-level user scoping to prevent cross-tenant relationships and access;
- application-level AES-GCM encryption for Canvas feed URLs, Ed tokens, calendar refresh tokens, and iCloud app-specific passwords;
- durable, expiring, single-use Google/Microsoft calendar OAuth state suitable for serverless Workers;
- exact hosted production callback/origin handling and Firefox bridge support for `https://mykairos.me`;
- account deletion and clean production/local environment separation;
- manual-only production deployment workflow plus Workers/D1 build, migration, tenancy, credential, and production-safety gates;
- deterministic two-user hosted E2E coverage using real Auth.js database sessions, including cross-user mutation rejection, sign-out protection, and user-scoped extension submission results.

Completed hosted acceptance:
- production deployment and migrations at `https://mykairos.me`;
- user-confirmed identity, logout, two-user isolation, sources/Firefox extension, calendar synchronization, account deletion, and edge-case acceptance;
- repository privacy/security review, identity-token minimization, public-session allowlisting, origin guards, credential non-exposure, and rollback readiness;
- 509 automated tests and 14 Chromium/Firefox browser cases, with build/runtime verification;
- sign-off commit `6a4f9089319a01818853183298ee6f16827c22ab`, annotated tag `milestone-6`, runtime commit `f068e24bd45b46dee4c5a5a8d219115efaf769ef`.

Acceptance attribution, production identifiers, and documented limits are in `docs/deployment/acceptance-milestone-6.md` and `docs/deployment/security-review-2026-10-10.md`. Milestone 6's rollback readiness review does not satisfy Milestone 7's required live rollback drill. Its release commits/tag are published, and PR #14 integrated them into protected `main` with history preserved as `4eb597e` on October 15. M7 integration and resulting-main CI remain separate.

Primary design:
- `docs/superpowers/specs/2026-10-06-multi-user-hosted-foundation-design.md`

Implementation plans:
- `docs/superpowers/plans/2026-10-06-milestone-6a-workers-d1-auth-foundation.md`
- `docs/superpowers/plans/2026-10-06-milestone-6b-tenant-data-credentials-oauth.md`
- `docs/superpowers/plans/2026-10-06-milestone-6c-production-boundary-deployment.md`

Hosted acceptance:
- `docs/deployment/acceptance-milestone-6.md`

## Milestone 7 — Public beta readiness — Engineering complete; release acceptance open

Scope:
- open signup with Google or Microsoft; no invite codes and no `@uw.edu` eligibility restriction;
- UW-first product positioning and continued `canvas.uw.edu` browser integration rather than arbitrary Canvas institutions;
- first-run onboarding with skippable source/calendar setup and targeted returning-user recovery;
- Google production OAuth branding/verification and Microsoft production registration hardening;
- Mozilla-signed Firefox extension distribution with current Manifest V3 data-collection declarations;
- Cloudflare Turnstile plus per-user/provider sync/connect rate limits and duplicate-work controls;
- privacy-preserving structured logs, health checks, deployment visibility, and free-tier capacity monitoring;
- `support@mykairos.me` / `security@mykairos.me` inbound routing or documented equivalents;
- finalized privacy/terms/revocation/account-deletion guidance;
- incident response, production deployment, rollback, and two-account hosted acceptance;
- final security and production-readiness go/no-go review before broad public announcement.

Primary design:
- `docs/superpowers/specs/2026-10-06-public-beta-readiness-design.md`

Implementation plan:
- `docs/superpowers/plans/2026-10-10-milestone-7-public-beta.md` links the onboarding/recovery, admission/bounded-work, and distribution/operations slices.
- M6 is merged with history preserved; M7 PR #15 targets protected `main`, with final integration and exact-main CI recorded there.
- Published-source 72a5b2a CI passes 1,475 tests, 54 browser cases, 30 simulated deployment cases and the build/native/type/lint/safety checks. Source reviews retain three external D1 evidence blocks; readiness remains INCOMPLETE until required external controls and hosted checks close.
- Google branding is operator-confirmed approved. Signed Firefox 0.4.0, ordinary installation/native consent/source reads and the public description/privacy-link/homepage update are verified as attributed. A real version upgrade is a next-release follow-up, not an added signed-installability criterion.
- A compatible recovery candidate is built/native-verified and representative cleanup costs are measured. Exact hosted/two-account/provider acceptance, actual operational/privacy/token/capacity evidence and live rollback remain release gates. Support/security delivery is operator-confirmed; new workflow activation remains separate.
- No production upload, remote migration, traffic change, export or restore was performed. Explicit production approval is still required. See `docs/deployment/closeout-milestone-7.md` and the readiness/security/acceptance records.

## Local guest mode — Planned after Milestone 7, not yet numbered

User selected this follow-up on October 14, 2026. People should be able to use Kairos without creating or signing into a Kairos account, with assignments and preferences stored on their device. This changes storage and integration boundaries and needs an architectural design before implementation; it is outside Milestone 7's launch acceptance.

The proposed starting scope is a browser guest experience with local persistence, import/export and backup controls, clear behavior when browser data is cleared, and an optional later move to an account. Live source connections, calendar authorization, credential storage, offline support, and the Firefox bridge must be assessed during that design. A Kairos account and a provider account are separate concerns; guest mode must not imply access to provider data without its required authorization. The exact feature set and migration behavior remain to be agreed.

## Later extension follow-ups — Planned, not yet numbered

- Chromium support for the Canvas submission-status extension
- optional opt-in periodic background refresh while preserving stale-on-open as the default behavior

## Deferred ideas — Not committed milestones

These remain intentionally deferred until the core aggregation/integration workflow proves reliable:
- notifications
- mobile-native app
- AI planning/prioritization
- analytics dashboards
- collaboration/comments/notes
- plugin marketplace
- complex recurring scheduling

## Cross-source behavior

As additional sources arrive, Kairos should preserve each source record independently. Potential duplicates may be linked, and conflicting due dates should be shown explicitly; Kairos should not silently invent a canonical deadline or destructively merge records.
