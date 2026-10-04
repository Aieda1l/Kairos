# UW Assignment Dashboard Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Next.js dashboard that securely imports a UW student's Canvas iCal feed into SQLite and presents the same normalized assignments in Upcoming, Calendar, and All Assignments views.

**Architecture:** Use one Next.js App Router project with server-only source adapters and SQLite repositories behind route handlers. Canvas iCal retrieval/parsing is isolated from normalization and persistence; the UI receives only normalized assignment/source-status models and adapts selected 21st.dev interaction patterns into local components.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, shadcn-compatible primitives, `better-sqlite3`, `ical.js`, `zod`, `date-fns`, `date-fns-tz`, `next-themes`, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-uw-assignment-dashboard-design.md`

## Global Constraints

- Canvas ingestion must use the student's calendar/iCal feed; do not depend on a student Canvas REST API token.
- Never request or store the user's UW NetID password.
- Treat the private Canvas feed URL as a credential: keep it server-side/local, redact it from logs, and never serialize it into client-rendered payloads.
- Persist dates as ISO-8601 timestamps and display them in the configured timezone, default `America/Los_Angeles`.
- Repeated syncs must be idempotent on `(source_connection_id, external_id)` and must not delete previously imported rows after a failed or incomplete sync.
- Preserve future source identities (`canvas`, `gradescope`, `ed`) but enable only Canvas in milestone 1.
- Do not silently merge cross-source assignments or invent a canonical deadline when sources disagree.
- UI must remain keyboard accessible, meet WCAG AA contrast for text/primary controls, respect reduced motion, and remain usable at approximately 320 CSS px without page-level horizontal scrolling.
- Use the approved 21st.dev references as interaction/layout inspiration: collapsible dashboard sidebar, fullscreen calendar, table-with-dialog, restrained segmented control, and Modern Minimal theme with a restrained `#4b2e83` interaction accent.
- Do not use UW logos or imply official UW affiliation.
- Milestone 1 is manual-sync only: no background scheduler, notifications, cloud account, or live Gradescope/Ed connector.

## Review Focus

- **Partially malformed iCal feed:** valid VEVENTs must still import; invalid VEVENTs must be counted as skipped and produce a partial-success summary rather than aborting the sync. Covered in Task 3 parser tests and Task 4 sync integration tests.
- **Concurrent/repeated sync:** two attempts for the same source must not create duplicate rows or overlap writes; the second active attempt receives a stable busy result. Covered in Task 4 integration tests.
- **DST/date boundary behavior:** a due time near midnight or a DST change must classify and display consistently in `America/Los_Angeles` without a one-hour/day drift. Covered in Task 5 date tests.
- **Hostile/accidental secret exposure:** non-HTTPS production feed URLs, `file:` URLs, logs, API payloads, and rendered HTML must not expose or read local secrets. Covered in Tasks 2, 6, and 10 security tests.
- **Sparse events:** VEVENTs without course metadata, URLs, or due dates must render with safe fallbacks (`Canvas`, no source link, `No due date`) instead of crashing or disappearing. Covered in Tasks 3, 5, and 7 tests.

---

## File Structure

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
    (dashboard)/
      layout.tsx
      upcoming/page.tsx
      calendar/page.tsx
      assignments/page.tsx
      sources/page.tsx
      settings/page.tsx
      loading.tsx
      error.tsx
    api/
      sources/canvas/test/route.ts
      sources/canvas/connect/route.ts
      sources/canvas/sync/route.ts
      settings/timezone/route.ts
      test-fixtures/canvas-feed/route.ts
  components/
    ui/                         shadcn-compatible primitives
    app-shell.tsx
    app-sidebar.tsx
    mobile-nav.tsx
    theme-provider.tsx
    theme-toggle.tsx
  features/
    assignments/
      assignment-explorer.tsx
      assignment-list.tsx
      assignment-row.tsx
      assignment-detail-dialog.tsx
      assignment-filter-bar.tsx
      assignment-table.tsx
      assignment-calendar.tsx
      source-badge.tsx
    sources/
      canvas-source-card.tsx
      future-source-card.tsx
      source-status.tsx
    sync/
      sync-button.tsx
      sync-summary.tsx
  lib/
    assignments/
      types.ts
      normalize.ts
      queries.ts
    dates/
      classify-due-date.ts
      format.ts
    db/
      client.ts
      migrate.ts
      repositories/assignments.ts
      repositories/source-connections.ts
      repositories/source-credentials.ts
      repositories/settings.ts
    security/
      redact.ts
    sources/
      types.ts
      canvas-ical/errors.ts
      canvas-ical/validate-url.ts
      canvas-ical/parser.ts
      canvas-ical/fetch-feed.ts
      canvas-ical/source.ts
    sync/
      lock.ts
      sync-source.ts
      types.ts

tests/
  fixtures/canvas/
    valid.ics
    partial.ics
    updated.ics
  unit/
  integration/
  component/
  e2e/
```

---

### Task 1: Project foundation, SQLite schema, and canonical models

**Files:**
- Create/modify: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/lib/assignments/types.ts`, `src/lib/sources/types.ts`
- Create: `src/lib/db/client.ts`, `src/lib/db/migrate.ts`
- Test: `tests/integration/db-schema.test.ts`

**Interfaces:**
- Produces `SourceKind`, `AssignmentStatus`, `Assignment`, `SourceConnection`, and `AssignmentSource` exactly as defined in the spec.
- Produces `SourceAssignment = { externalId: string; courseId: string | null; courseName: string; title: string; dueAt: string | null; status: AssignmentStatus; sourceUrl: string | null; sourceUpdatedAt: string | null }`.
- Produces `ConnectionResult = { ok: true; itemCount: number } | { ok: false; code: string; message: string }`.
- Produces `openDatabase(path?: string): Database.Database` and `migrate(db: Database.Database): void` for every later persistence task.

- [ ] **Step 1: Establish the Next.js project/tooling baseline**

Create the App Router project files in the existing repository (do not replace `docs/` or `.git/`). Install runtime dependencies `next`, `react`, `react-dom`, `better-sqlite3`, `ical.js`, `zod`, `date-fns`, `date-fns-tz`, `next-themes`, `lucide-react`, `clsx`, `tailwind-merge`, and `class-variance-authority`; install the corresponding TypeScript/testing/lint dev dependencies including Vitest, jsdom, React Testing Library, user-event, and Playwright. Define scripts: `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (`vitest`), and `test:e2e` (`playwright test`).

- [ ] **Step 2: Write the failing schema test**

Test `migrate()` against an in-memory database and assert that `source_connections`, `source_credentials`, `assignments`, `assignment_links`, and `app_settings` exist; assert the unique index on `(source_connection_id, external_id)` exists and the default `timezone` setting is `America/Los_Angeles`.

- [ ] **Step 3: Run the schema test and verify it fails**

Run: `npm test -- tests/integration/db-schema.test.ts`

Expected: FAIL because the DB client/migration and/or tables do not exist yet.

- [ ] **Step 4: Implement the canonical types and minimal SQLite migration**

Use raw `better-sqlite3` with `PRAGMA foreign_keys = ON`. Store runtime DB data under `.data/assignments.sqlite` by default, allow `ASSIGNMENTS_DB_PATH` override for tests, and create these tables:

- `source_connections` exactly as specified, with `kind` constrained to `canvas|gradescope|ed` and one connection per kind for milestone 1;
- `source_credentials(source_connection_id PRIMARY KEY, canvas_feed_url TEXT NULL, updated_at TEXT NOT NULL)`;
- `assignments` with the spec fields and unique `(source_connection_id, external_id)`;
- `assignment_links` reserved for future sources;
- `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)` seeded with `timezone = America/Los_Angeles`.

`src/app/page.tsx` should redirect to `/upcoming`. Add `.data/`, `.env*`, Playwright artifacts, and SQLite sidecar files to `.gitignore` while keeping `.env.example` allowed.

- [ ] **Step 5: Run foundation checks**

Run: `npm test -- tests/integration/db-schema.test.ts && npm run lint && npm run typecheck`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: establish dashboard foundation"
```

---

### Task 2: Server-only Canvas credential validation and redaction

**Files:**
- Create: `src/lib/security/redact.ts`
- Create: `src/lib/sources/canvas-ical/validate-url.ts`
- Create: `src/lib/db/repositories/source-credentials.ts`
- Test: `tests/unit/redact.test.ts`, `tests/unit/canvas-url-validation.test.ts`, `tests/integration/source-credentials.test.ts`

**Interfaces:**
- Consumes `openDatabase()` from Task 1.
- Produces `redactSecret(value: string): string` and `redactError(value: unknown, secrets?: string[]): string`.
- Produces `validateCanvasFeedUrl(raw: string, options?: { allowLoopbackHttp?: boolean }): URL`.
- Produces `SourceCredentialRepository` with `setCanvasFeedUrl(connectionId: string, feedUrl: string): void` and `getCanvasFeedUrl(connectionId: string): string | null`.

- [ ] **Step 1: Write failing tests for accepted/rejected URLs, redaction, and credential persistence**

Assert production validation accepts an `https://...` feed, rejects `file:`, `ftp:`, credential-bearing URLs, blank input, and ordinary `http:` URLs; allow loopback `http://127.0.0.1/...` only when `allowLoopbackHttp` is explicitly true for deterministic E2E fixtures. Assert redaction never returns a full private URL/token. Assert credential repository round-trips only through server code.

- [ ] **Step 2: Run the security tests and verify they fail**

Run: `npm test -- tests/unit/redact.test.ts tests/unit/canvas-url-validation.test.ts tests/integration/source-credentials.test.ts`

Expected: FAIL because the helpers/repository do not exist.

- [ ] **Step 3: Implement minimal validation, redaction, and credential repository**

Validation must use `new URL()`, require `https:` in normal operation, reject username/password URL components, and never read from filesystem schemes. Redaction should preserve enough context for debugging (for example host/error class) without preserving query/path tokens. Mark credential repository modules server-only and never export feed URLs through public source models.

- [ ] **Step 4: Run the security tests**

Run: `npm test -- tests/unit/redact.test.ts tests/unit/canvas-url-validation.test.ts tests/integration/source-credentials.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security src/lib/sources/canvas-ical/validate-url.ts src/lib/db/repositories/source-credentials.ts tests
git commit -m "feat: secure Canvas feed credentials"
```

---

### Task 3: Canvas iCal parser, fetcher, and source adapter

**Files:**
- Create: `src/lib/sources/canvas-ical/errors.ts`
- Create: `src/lib/sources/canvas-ical/parser.ts`
- Create: `src/lib/sources/canvas-ical/fetch-feed.ts`
- Create: `src/lib/sources/canvas-ical/source.ts`
- Create: `tests/fixtures/canvas/valid.ics`, `tests/fixtures/canvas/partial.ics`, `tests/fixtures/canvas/updated.ics`
- Test: `tests/unit/canvas-parser.test.ts`, `tests/unit/canvas-source.test.ts`

**Interfaces:**
- Consumes `AssignmentSource`, `SourceAssignment`, `ConnectionResult`, URL validation, and redaction from Tasks 1-2.
- Produces `parseCanvasIcal(input: string): { assignments: SourceAssignment[]; skipped: number; errors: string[] }`.
- Produces `fetchCanvasFeed(url: URL, fetchImpl?: typeof fetch): Promise<string>`.
- Produces `CanvasIcalSource implements AssignmentSource`, constructed as `new CanvasIcalSource(feedUrl: URL, fetchImpl?: typeof fetch)`, with `testConnection(): Promise<ConnectionResult>`, `sync(): Promise<SourceAssignment[]>`, and `getLastParseReport(): { skipped: number; errors: string[] }`.

- [ ] **Step 1: Write failing fixture-driven parser/source tests**

Pin these behaviors against fixtures modeled on Canvas's current iCal serializer: import only assignment VEVENTs identified by Canvas assignment UID/URL patterns (for example `event-assignment-*`, assignment-override/sub-assignment variants, or a `#assignment_` calendar anchor) and ignore ordinary calendar events without treating them as parse errors; UID is the preferred `externalId`; missing UID receives a deterministic SHA-256 fallback from stable event fields; a trailing Canvas summary suffix such as `Homework 3 [CSE 331]` becomes `title = "Homework 3"` and `courseName = "CSE 331"` only after the event is positively identified as an assignment; parse `courseId` from `include_contexts=course_<id>` when present; when both the course id and `#assignment_<id>` anchor are present, convert the Canvas calendar URL into the direct `https://<host>/courses/<courseId>/assignments/<assignmentId>` source link, otherwise retain the event URL; `DTSTAMP` becomes `sourceUpdatedAt`; status is `unknown`. Timed `DTSTART` becomes due time. For Canvas assignment `DTSTART;VALUE=DATE`, reconstruct the source instant as 23:59:00 in `America/Los_Angeles` before converting to ISO-8601, matching Canvas's all-day encoding for 23:59 assignment deadlines in this UW-focused app. Missing optional URL/course metadata uses `null`/`Canvas`; malformed assignment VEVENTs are skipped individually; a syntactically invalid/empty calendar returns `INVALID_ICAL` or `EMPTY_FEED`; fetch status 401/403 maps to `UNAUTHORIZED_OR_EXPIRED_FEED`; other network failures map to `NETWORK_ERROR`.

- [ ] **Step 2: Run parser/source tests and verify they fail**

Run: `npm test -- tests/unit/canvas-parser.test.ts tests/unit/canvas-source.test.ts`

Expected: FAIL because parser/source classes do not exist.

- [ ] **Step 3: Implement parser, error mapping, fetcher, and `CanvasIcalSource`**

Use `ical.js` to parse VEVENTs and keep source-specific logic inside `canvas-ical/`. Do not infer a course by stripping arbitrary title prefixes; only strip the verified trailing Canvas course-code suffix on positively identified assignment events. Count ignored non-assignment calendar events as skipped informational records, not parse errors; `partial` is driven by actual parse errors. Preserve parse diagnostics on the source instance only long enough for the sync service to read them; `sync()` still conforms to the spec's `Promise<SourceAssignment[]>` adapter contract.

- [ ] **Step 4: Run parser/source tests**

Run: `npm test -- tests/unit/canvas-parser.test.ts tests/unit/canvas-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources/canvas-ical tests/fixtures/canvas tests/unit/canvas-*.test.ts
git commit -m "feat: parse Canvas iCal assignments"
```

---

### Task 4: Normalization, repositories, idempotent sync, and source status

**Files:**
- Create: `src/lib/assignments/normalize.ts`
- Create: `src/lib/db/repositories/assignments.ts`
- Create: `src/lib/db/repositories/source-connections.ts`
- Create: `src/lib/sync/types.ts`, `src/lib/sync/lock.ts`, `src/lib/sync/sync-source.ts`
- Test: `tests/unit/normalize.test.ts`, `tests/integration/assignment-repository.test.ts`, `tests/integration/sync-source.test.ts`

**Interfaces:**
- Consumes Canvas source and DB primitives from Tasks 1-3.
- Produces `normalizeSourceAssignment(source: SourceKind, input: SourceAssignment, nowIso: string): NormalizedAssignment`.
- Produces `NormalizedAssignment = Omit<Assignment, "id" | "firstSeenAt" | "lastSeenAt">`.
- Produces `AssignmentFilters = { course?: string; source?: SourceKind; search?: string }`.
- Produces `AssignmentRepository.upsertMany(sourceConnectionId: string, assignments: NormalizedAssignment[], seenAt: string): { inserted: number; updated: number }` and `list(filters?: AssignmentFilters): Assignment[]`.
- Produces `SourceConnectionRepository.getByKind(kind: SourceKind)`, `upsertCanvas(label: string)`, `markSyncStarted(id, at)`, `markSyncSuccess(id, at, errorCode?)`, `markSyncError(id, at, errorCode)`.
- Produces `SyncSummary = { connectionId: string; inserted: number; updated: number; skipped: number; errors: string[]; partial: boolean; completedAt: string }`.
- Produces `syncCanvasConnection(connectionId: string, deps?: SyncDependencies): Promise<SyncSummary>`.

- [ ] **Step 1: Write failing normalization/repository/sync tests**

Assert first sync inserts; second identical sync updates/refreshes `lastSeenAt` without increasing row count; changed due date updates the existing row; partial parse persists valid rows and returns `partial: true`; network failure leaves existing assignments untouched and records source status/error; stale feed omissions do not delete old rows; two simultaneous syncs for the same connection cannot overlap and the second receives `SYNC_IN_PROGRESS`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/unit/normalize.test.ts tests/integration/assignment-repository.test.ts tests/integration/sync-source.test.ts`

Expected: FAIL because repositories/sync service do not exist.

- [ ] **Step 3: Implement normalization, repositories, and per-source in-process lock**

Use one small `Map<string, Promise|boolean>`-style lock for the local single-process milestone. On a partial parse, persist valid records, mark the connection's last sync as success with `last_error_code = 'PARTIAL_PARSE'`, and return `partial: true`; on hard error, mark error and rethrow/return a sanitized stable code without deleting assignments.

- [ ] **Step 4: Run sync/persistence tests**

Run: `npm test -- tests/unit/normalize.test.ts tests/integration/assignment-repository.test.ts tests/integration/sync-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assignments src/lib/db/repositories src/lib/sync tests/unit/normalize.test.ts tests/integration
git commit -m "feat: add idempotent assignment sync"
```

---

### Task 5: Timezone formatting, due-date grouping, and assignment queries

**Files:**
- Create: `src/lib/dates/classify-due-date.ts`, `src/lib/dates/format.ts`, `src/lib/dates/validate-timezone.ts`
- Create: `src/lib/assignments/queries.ts`
- Create: `src/lib/db/repositories/settings.ts`
- Test: `tests/unit/due-date-groups.test.ts`, `tests/unit/date-format.test.ts`, `tests/unit/timezone-validation.test.ts`, `tests/integration/assignment-queries.test.ts`, `tests/integration/settings-repository.test.ts`

**Interfaces:**
- Consumes `AssignmentRepository.list()` from Task 4.
- Produces `DueGroup = "overdue" | "today" | "tomorrow" | "this-week" | "later" | "no-due-date"`.
- Produces `classifyDueDate(dueAt: string | null, now: Date, timeZone?: string): DueGroup` defaulting to `America/Los_Angeles`.
- Produces `formatDueDate(dueAt: string | null, timeZone?: string): string`.
- Produces `validateTimeZone(value: string): string` that returns a valid IANA zone or throws a stable validation error.
- Produces `SettingsRepository.getTimeZone(): string` and `SettingsRepository.setTimeZone(timeZone: string): void`.
- Produces `getAssignmentsView(repo: AssignmentRepository, filters: AssignmentFilters): Assignment[]` and `groupUpcoming(assignments: Assignment[], now: Date, timeZone: string): Record<DueGroup, Assignment[]>`.

- [ ] **Step 1: Write failing timezone/group/query tests**

Use fixed instants around Pacific midnight and the 2026 U.S. Pacific DST transitions (March 8 and November 1, 2026). Assert reconstructed Canvas date-only deadlines and normal timestamp deadlines do not shift a calendar day; exact due times render in the configured timezone; overdue/today/tomorrow/this-week boundaries are stable; search is case-insensitive; source/course filters compose; missing course metadata remains filterable as `Canvas`; valid IANA timezone values persist, invalid timezone strings are rejected, and the repository defaults to `America/Los_Angeles`.

- [ ] **Step 2: Run date/query tests and verify they fail**

Run: `npm test -- tests/unit/due-date-groups.test.ts tests/unit/date-format.test.ts tests/unit/timezone-validation.test.ts tests/integration/assignment-queries.test.ts tests/integration/settings-repository.test.ts`

Expected: FAIL because date/query helpers do not exist.

- [ ] **Step 3: Implement date/query helpers**

Use `date-fns`/`date-fns-tz` with explicit IANA timezone conversion; never classify using the server machine's implicit local timezone. Validate timezone preferences before persistence and default missing settings to `America/Los_Angeles`. Sort due assignments ascending and no-due assignments last, then title as deterministic tie-breaker.

- [ ] **Step 4: Run date/query tests**

Run: `npm test -- tests/unit/due-date-groups.test.ts tests/unit/date-format.test.ts tests/unit/timezone-validation.test.ts tests/integration/assignment-queries.test.ts tests/integration/settings-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates src/lib/assignments/queries.ts src/lib/db/repositories/settings.ts tests/unit tests/integration/assignment-queries.test.ts tests/integration/settings-repository.test.ts
git commit -m "feat: classify and query assignment deadlines"
```

---

### Task 6: Canvas test/connect/sync API routes

**Files:**
- Create: `src/app/api/sources/canvas/test/route.ts`
- Create: `src/app/api/sources/canvas/connect/route.ts`
- Create: `src/app/api/sources/canvas/sync/route.ts`
- Create: `src/app/api/settings/timezone/route.ts`
- Test: `tests/integration/canvas-api-routes.test.ts`, `tests/integration/settings-api-route.test.ts`, `tests/integration/secret-exposure.test.ts`

**Interfaces:**
- Consumes validation, credentials, source connections, Canvas source, sync service, and timezone settings from Tasks 2-5.
- Produces `POST /api/sources/canvas/test` body `{ feedUrl: string }` → sanitized `ConnectionResult`.
- Produces `POST /api/sources/canvas/connect` body `{ feedUrl: string; label?: string }` → sanitized `{ connection: SourceConnection; sync: SyncSummary }` after validation/persist/initial sync.
- Produces `POST /api/sources/canvas/sync` → sanitized `SyncSummary` for the stored Canvas connection.
- Produces `GET /api/settings/timezone` → `{ timeZone: string }` and `PUT /api/settings/timezone` body `{ timeZone: string }` → validated persisted timezone.

- [ ] **Step 1: Write failing route tests**

Mock upstream fetch and assert: invalid URL returns 400/stable code; unauthorized feed returns sanitized action-oriented code; successful test does not persist; successful connect stores credential server-side and returns no `feedUrl`; sync without configuration returns a stable 409/404-style configuration error; concurrent sync returns `SYNC_IN_PROGRESS`; response bodies never contain the test feed token/path. For settings, assert GET returns `America/Los_Angeles` initially, PUT persists a valid IANA zone, and PUT rejects an invalid zone without changing the previous value.

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npm test -- tests/integration/canvas-api-routes.test.ts tests/integration/settings-api-route.test.ts tests/integration/secret-exposure.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement thin route handlers**

Validate request bodies with `zod`; delegate work to existing services; never log request bodies; translate internal errors into stable status/code/message objects. `connect` must revalidate/test before saving the URL and must run initial sync only after credential persistence succeeds. The timezone route must use the Task 5 validator/repository and return only the configured IANA name.

- [ ] **Step 4: Run route/security tests**

Run: `npm test -- tests/integration/canvas-api-routes.test.ts tests/integration/settings-api-route.test.ts tests/integration/secret-exposure.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sources/canvas src/app/api/settings/timezone tests/integration/canvas-api-routes.test.ts tests/integration/settings-api-route.test.ts tests/integration/secret-exposure.test.ts
git commit -m "feat: expose secure Canvas sync routes"
```

---

### Task 7: App shell, Modern Minimal theme, settings, and shared page states

**Files:**
- Create: `src/components/ui/*` only for primitives actually used (`button`, `badge`, `dialog`, `sheet`, `input`, `label`, `select`, `table`, `alert`, `skeleton`)
- Create: `src/components/app-shell.tsx`, `src/components/app-sidebar.tsx`, `src/components/mobile-nav.tsx`, `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`
- Create: `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/settings/page.tsx`, `src/app/(dashboard)/loading.tsx`, `src/app/(dashboard)/error.tsx`
- Test: `tests/component/app-shell.test.tsx`, `tests/component/settings.test.tsx`, `tests/component/dashboard-states.test.tsx`

**Interfaces:**
- Consumes the timezone route contract from Task 6.
- Produces the reusable dashboard shell, theme/timezone settings, and shared loading/error states used by all later pages.

- [ ] **Step 1: Write failing shell/settings/state tests**

Assert sidebar links are keyboard reachable and include Upcoming, Calendar, All Assignments, Sources, Settings; narrow layout exposes a functional mobile navigation trigger; theme toggle has an accessible label; Settings loads/saves the configured timezone through the API; dashboard loading state renders a skeleton; dashboard error state renders an actionable retry without raw exception text.

- [ ] **Step 2: Run component tests and verify they fail**

Run: `npm test -- tests/component/app-shell.test.tsx tests/component/settings.test.tsx tests/component/dashboard-states.test.tsx`

Expected: FAIL because the shell/settings components do not exist.

- [ ] **Step 3: Add the shadcn-compatible primitives used by milestone 1**

Initialize shadcn in the existing Tailwind app and add only: `button`, `badge`, `dialog`, `sheet`, `input`, `label`, `select`, `table`, `alert`, `skeleton`. Keep generated primitives local under `src/components/ui/` for reviewability.

- [ ] **Step 4: Implement the shell, theme, settings, and shared states using the approved 21st.dev direction**

Adapt the Sonu Kumar collapsible-sidebar interaction rather than importing a whole admin template. Apply Modern Minimal neutral surfaces/tokens in `globals.css`; reserve `#4b2e83` for active/focus/primary interaction states. Persist theme via `next-themes` and timezone via `/api/settings/timezone`. Loading/error boundaries must not expose secrets or raw stack traces.

- [ ] **Step 5: Run component/static checks**

Run: `npm test -- tests/component/app-shell.test.tsx tests/component/settings.test.tsx tests/component/dashboard-states.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components src/app/'(dashboard)'/layout.tsx src/app/'(dashboard)'/settings src/app/'(dashboard)'/loading.tsx src/app/'(dashboard)'/error.tsx src/app/globals.css tests/component/app-shell.test.tsx tests/component/settings.test.tsx tests/component/dashboard-states.test.tsx
git commit -m "feat: add dashboard shell and settings"
```

---

### Task 8: Canvas Sources onboarding and manual sync UI

**Files:**
- Create: `src/app/(dashboard)/sources/page.tsx`
- Create: `src/features/sources/canvas-source-card.tsx`, `src/features/sources/future-source-card.tsx`, `src/features/sources/source-status.tsx`
- Create: `src/features/sync/sync-button.tsx`, `src/features/sync/sync-summary.tsx`
- Test: `tests/component/canvas-source-card.test.tsx`, `tests/component/source-status.test.tsx`

**Interfaces:**
- Consumes Canvas route contracts from Task 6 and shell/primitives from Task 7.
- Produces `SyncButton` and source-status components reused by Upcoming.

- [ ] **Step 1: Write failing onboarding/sync component tests**

Assert Canvas supports paste → Test connection → Connect, displays sanitized errors, disables controls during requests, clears the full feed URL after connection, shows last successful sync/status, renders partial-sync skipped/error counts without discarding successful records, and exposes a disabled-while-running Sync Now action. On successful connect + initial sync, assert the client navigates to `/upcoming`. Assert Gradescope and Ed are visibly disabled future connectors and do not offer fake connection actions.

- [ ] **Step 2: Run source component tests and verify they fail**

Run: `npm test -- tests/component/canvas-source-card.test.tsx tests/component/source-status.test.tsx`

Expected: FAIL because source/sync UI does not exist.

- [ ] **Step 3: Implement Sources onboarding and manual sync UI**

Keep the feed URL only in local input state until the connect request completes, then clear it. Render only sanitized source connection/status data returned from server code. Use explicit text/icon labels in addition to color for success/error/source state.

- [ ] **Step 4: Run source component/static checks**

Run: `npm test -- tests/component/canvas-source-card.test.tsx tests/component/source-status.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(dashboard)'/sources src/features/sources src/features/sync tests/component/canvas-source-card.test.tsx tests/component/source-status.test.tsx
git commit -m "feat: add Canvas source onboarding"
```

---

### Task 9: Upcoming assignment experience, filters, and detail dialog

**Files:**
- Create: `src/app/(dashboard)/upcoming/page.tsx`
- Create: `src/features/assignments/assignment-explorer.tsx`, `assignment-list.tsx`, `assignment-row.tsx`, `assignment-detail-dialog.tsx`, `assignment-filter-bar.tsx`, `source-badge.tsx`
- Test: `tests/component/upcoming.test.tsx`, `tests/component/assignment-detail.test.tsx`

**Interfaces:**
- Consumes Task 5 query/group helpers, Task 7 shell, and Task 8 sync/status components.
- Produces reusable `AssignmentExplorer` filtering state and `AssignmentDetailDialog` used again by All Assignments and Calendar.

- [ ] **Step 1: Write failing Upcoming/detail tests**

Assert group order is Overdue → Today → Tomorrow → This week → Later → No due date; source/course filters update visible assignments; no records shows a clear connect/sync empty state; the page exposes Sync Now and last-successful-sync text; rows show course/title/due/source/status as text, not color alone; missing URL omits the external-link action; pointer click and keyboard activation both open details; source URL opens as a normal anchor when present.

- [ ] **Step 2: Run component tests and verify they fail**

Run: `npm test -- tests/component/upcoming.test.tsx tests/component/assignment-detail.test.tsx`

Expected: FAIL because assignment UI does not exist.

- [ ] **Step 3: Implement Upcoming and reusable assignment components**

Keep Upcoming scannable: no charts and no analytics cards. Filters may be client-side over the normalized list for milestone 1; course/source options must derive from loaded assignments and remain deterministic.

- [ ] **Step 4: Run Upcoming/detail tests**

Run: `npm test -- tests/component/upcoming.test.tsx tests/component/assignment-detail.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(dashboard)'/upcoming src/features/assignments tests/component/upcoming.test.tsx tests/component/assignment-detail.test.tsx
git commit -m "feat: add upcoming assignment dashboard"
```

---

### Task 10: All Assignments table and Calendar planning view

**Files:**
- Create: `src/app/(dashboard)/assignments/page.tsx`, `src/app/(dashboard)/calendar/page.tsx`
- Create: `src/features/assignments/assignment-table.tsx`, `src/features/assignments/assignment-calendar.tsx`
- Test: `tests/component/assignment-table.test.tsx`, `tests/component/assignment-calendar.test.tsx`

**Interfaces:**
- Consumes `AssignmentExplorer`, `AssignmentDetailDialog`, normalized records, and date formatting from Tasks 5 and 9.
- Produces the dense table view and month calendar view that show the same assignment records as Upcoming.

- [ ] **Step 1: Write failing table/calendar tests**

Table: assert columns Assignment/Course/Due/Source/Status, filters/search work, due/status sorting is deterministic, row activation opens the shared detail UI, and a narrow layout uses a compact list/card representation rather than page-level horizontal overflow. Calendar: assert month navigation, assignment markers on the correct configured-timezone calendar day, keyboard-selectable assignments, multiple assignments per day, no-due assignments excluded from the grid but not deleted, and selecting a marker opens the shared detail UI.

- [ ] **Step 2: Run planning-view tests and verify they fail**

Run: `npm test -- tests/component/assignment-table.test.tsx tests/component/assignment-calendar.test.tsx`

Expected: FAIL because table/calendar components do not exist.

- [ ] **Step 3: Implement approved 21st.dev-inspired table/dialog and fullscreen-calendar adaptations**

Adapt Ruixen's dense table→dialog pattern and Ahmed Mayara's fullscreen month-grid interaction, but keep data flow in existing local assignment components. Do not add CRUD affordances or generic admin controls from the references. Use a compact responsive fallback below the table's usable width.

- [ ] **Step 4: Run planning-view tests and static checks**

Run: `npm test -- tests/component/assignment-table.test.tsx tests/component/assignment-calendar.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(dashboard)'/assignments src/app/'(dashboard)'/calendar src/features/assignments/assignment-table.tsx src/features/assignments/assignment-calendar.tsx tests/component
git commit -m "feat: add assignment table and calendar views"
```

---

### Task 11: End-to-end fixture flow, security regression checks, responsive verification, and README

**Files:**
- Create: `src/app/api/test-fixtures/canvas-feed/route.ts`
- Create: `tests/e2e/canvas-onboarding.spec.ts`
- Create/modify: `README.md`, `.env.example`, `playwright.config.ts`
- Test: `tests/e2e/canvas-onboarding.spec.ts`, plus complete suite

**Interfaces:**
- Consumes the complete milestone 1 application.
- Produces documented one-command local startup and deterministic end-to-end evidence for the acceptance criteria.

- [ ] **Step 1: Write the failing Playwright smoke test and final security assertions**

Run the app with `E2E_FIXTURES=1`, an isolated `ASSIGNMENTS_DB_PATH`, and a fixture-only loopback feed route. Browser flow: start unconfigured → Sources → paste fixture URL → Test → Connect → initial sync auto-navigates to Upcoming → Upcoming contains fixture assignment → Calendar contains same assignment → All Assignments contains same assignment → return to Sources and confirm last-sync state survived navigation → Sync Now again → All Assignments still has exactly one matching row. Assert rendered HTML and API response bodies never contain the fixture secret token after submission (the local connect request body necessarily contains the URL supplied by the user). Include a 320px viewport smoke assertion for no page-level horizontal overflow and keyboard-only navigation through the primary workflow.

- [ ] **Step 2: Run the E2E test and verify it fails before fixture route/docs wiring is complete**

Run: `npm run test:e2e -- tests/e2e/canvas-onboarding.spec.ts`

Expected: FAIL until deterministic fixture mode and remaining wiring are implemented.

- [ ] **Step 3: Implement fixture-only route and project documentation**

`/api/test-fixtures/canvas-feed` must return 404 unless `E2E_FIXTURES=1`. README must document prerequisites, `npm install`, one-command local start (`npm run dev`), where SQLite data lives, how to obtain/paste the Canvas calendar feed without sharing a UW password, how to run unit/component/E2E tests, how to reset local data, and that Gradescope/Ed are intentionally deferred. `.env.example` must contain only non-secret example configuration.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run test:e2e
npm run lint
npm run typecheck
npm run build
git grep -nE 'canvas_feed_url=.*(https?://|token)|pseudonym|feed_code' -- ':!tests/fixtures/**' ':!docs/**' || true
```

Expected: all test/build/static commands PASS; grep finds no committed real credential. Manually inspect one desktop and one ~320px viewport in light/dark mode for focus visibility, readable contrast, and no page-level horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test: verify milestone one workflow"
```

---

## Completion Gate

Before declaring milestone 1 complete, verify all acceptance criteria from the design spec against the built app: secure Canvas iCal connection, SQLite persistence, idempotent sync, consistent records across all three views, source/course filtering, Pacific-time display, non-destructive errors, usable light/dark themes, keyboard accessibility, passing automated/E2E tests, setup documentation, and no credentials in the repository.
