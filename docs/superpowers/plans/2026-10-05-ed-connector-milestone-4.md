# Kairos Milestone 4 — Direct Ed Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct, read-only Ed connector that stores a user-created Ed PAT locally, discovers/selects courses, and syncs all visible Ed Lessons—including undated lessons—into Kairos without exposing the token or destroying prior data on failures.

**Architecture:** Add a server-only Ed API client plus focused parser/source modules under `src/lib/sources/ed/`. Connection/discovery and synchronization remain ordinary Next.js server routes backed by the existing source connection, credential, course, assignment, and submission-status repositories; a separate Ed client provider/card manages browser UI state without involving the Firefox extension.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Next.js 16 App Router, React 19, Zod 4, better-sqlite3, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-ed-connector-design.md`

## Global Constraints

- Ed API base URL is fixed to `https://edstem.org/api/`; never accept an arbitrary upstream URL.
- Authenticate only with `Authorization: Bearer <PAT>`; never ask for the user's Ed password.
- Store the PAT only in server-only local SQLite persistence; never return or re-render it after save.
- Milestone 4 is read-only: no Ed Discussion, Resources, Workspaces, quiz submission, lesson completion, or other Ed write calls.
- Import all visible Ed Lessons, including lessons with `dueAt = null`; exclude hidden and unlisted lessons.
- Never invent a deadline for an undated lesson.
- Failed/partial refreshes preserve previously known Ed data.
- Cross-source records remain independent; no automatic deduplication or canonical-deadline selection.
- New discovered courses default disabled; existing enabled selections survive rediscovery.
- Real credentials are manual-smoke only and never enter tests, logs, fixtures, or commits.
- Implementation follows TDD and makes no new product dependency unless a task explicitly calls for one.

## Review Focus

1. **Invalid replacement PAT after a working connection:** updating with an invalid token must leave the previously stored valid PAT and course state untouched. Covered in Task 3 integration tests.
2. **Valid empty Ed course/lesson collections:** zero courses or zero visible lessons are successful supported results, not parser failures. Covered in Tasks 2 and 4.
3. **Unexpected/duplicate course selection IDs:** the selection API must reject IDs not present in discovered Ed courses and duplicate IDs without changing prior selection. Covered in Task 3.
4. **Partial sync with one failed course and one successful empty course:** the empty course still counts as successfully checked, the failed course retains old data, and freshness advances with `PARTIAL_SYNC`. Covered in Task 4.
5. **Undated completed Ed lesson:** it must persist in All Assignments, remain absent from Upcoming, and be treated as resolved without fabricating a due date. Covered in Tasks 4, 6, and 7.

---

### Task 1: Add Ed credential and connection persistence primitives

**Files:**
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/lib/db/repositories/source-credentials.ts`
- Modify: `src/lib/db/repositories/source-connections.ts`
- Test: `tests/integration/db-schema.test.ts`
- Test: `tests/integration/source-credentials.test.ts`
- Test: `tests/integration/source-connections.test.ts` if present; otherwise add Ed assertions to the nearest source-connection repository test

**Interfaces:**
- Consumes: existing `source_connections`, `source_credentials`, `SourceKind = "canvas" | "gradescope" | "ed"`.
- Produces: `SourceCredentialRepository.setEdApiToken(connectionId: string, token: string): void`.
- Produces: `SourceCredentialRepository.getEdApiToken(connectionId: string): string | null`.
- Produces: `SourceConnectionRepository.upsertEd(label: string): SourceConnection`.

- [ ] **Step 1: Write failing migration/repository tests**

Add assertions that after `migrate(db)`:

```ts
const columns = db.prepare("PRAGMA table_info(source_credentials)").all() as Array<{name:string}>;
expect(columns.map(column=>column.name)).toContain("ed_api_token");
```

Add an Ed credential round-trip test using a local marker such as `fixture-ed-token-never-echo`, and assert a public `SourceConnection` has no token/credential property.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npm test -- tests/integration/db-schema.test.ts tests/integration/source-credentials.test.ts
```

Expected: FAIL because `ed_api_token`, `setEdApiToken`, and `getEdApiToken` do not exist.

- [ ] **Step 3: Implement the additive credential migration and repository methods**

In `migrate.ts`, add an idempotent `ensureSourceCredentialColumns(db)` analogous to `ensureAssignmentMetadataColumns(db)` so existing databases gain:

```text
ed_api_token TEXT
```

Do not rebuild/drop `source_credentials`.

Implement the two Ed credential methods using the same row as Canvas credentials, preserving the other credential column on update.

Add `upsertEd(label)` as the Ed-specific wrapper over the existing private `upsert`.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```bash
npm test -- tests/integration/db-schema.test.ts tests/integration/source-credentials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/migrate.ts src/lib/db/repositories/source-credentials.ts src/lib/db/repositories/source-connections.ts tests/integration/db-schema.test.ts tests/integration/source-credentials.test.ts
git commit -m "feat: add Ed credential persistence"
```

---

### Task 2: Build the strict Ed API client, parsers, and one-course source adapter

**Files:**
- Create: `src/lib/sources/ed/errors.ts`
- Create: `src/lib/sources/ed/schemas.ts`
- Create: `src/lib/sources/ed/client.ts`
- Create: `src/lib/sources/ed/parser.ts`
- Create: `src/lib/sources/ed/source.ts`
- Create: `tests/unit/ed-client.test.ts`
- Create: `tests/unit/ed-parser.test.ts`
- Create: `tests/unit/ed-source.test.ts`

**Interfaces:**
- Produces `EdErrorCode = "ED_AUTH_INVALID" | "ED_NETWORK_ERROR" | "ED_RATE_LIMITED" | "ED_UPSTREAM_ERROR" | "ED_PARSE_ERROR" | "ED_COURSE_UNAVAILABLE"`.
- Produces `EdSourceError extends Error` with stable `code: EdErrorCode`.
- Produces `EdApiClient`, constructed as `new EdApiClient(token: string, fetchImpl?: typeof fetch)`.
- Produces `EdApiClient.fetchUser(): Promise<unknown>`.
- Produces `EdApiClient.fetchLessons(courseId: string): Promise<unknown>`.
- Produces `parseEdCourses(payload: unknown): DiscoveredSourceCourse[]`.
- Produces `parseEdLessons(payload: unknown, course: SourceCourse): SourceAssignment[]`.
- Produces `EdSource implements AssignmentSource`, constructed as `new EdSource(token: string, course: SourceCourse, fetchImpl?: typeof fetch)`; `sync()` returns that course's visible normalized lessons.

- [ ] **Step 1: Write failing client tests**

Cover:

- requests target exactly `https://edstem.org/api/user` and `https://edstem.org/api/courses/123/lessons`;
- request header is `Authorization: Bearer fixture-ed-token-never-echo`;
- 401/403 -> `ED_AUTH_INVALID`;
- 429 -> `ED_RATE_LIMITED`;
- 5xx -> `ED_UPSTREAM_ERROR`;
- rejected fetch -> `ED_NETWORK_ERROR`;
- error messages do not contain the test token;
- non-decimal/unsafe course IDs are rejected before network access.

- [ ] **Step 2: Write failing parser tests**

Use small JSON fixtures, not copied authenticated account payloads.

Course cases:

```ts
expect(parseEdCourses({courses:[]})).toEqual([]);
expect(parseEdCourses(validUserFixture)).toContainEqual({
  externalCourseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
});
```

Lesson cases must assert:

- valid 0/1/many lessons;
- `effective_available_at` wins over `available_at`;
- `effective_due_at` wins over `due_at`;
- null/empty due date becomes `dueAt:null`;
- hidden and unlisted lessons are omitted;
- `completed -> status:"submitted"`;
- `attempted/unattempted -> status:"pending"`;
- unknown progress -> `status:"unknown"`;
- `sourceStatusText` retains meaningful Ed progress/state;
- missing stable lesson ID/title fails that row safely;
- unrecognized top-level payload -> `ED_PARSE_ERROR`;
- `sourceUrl` is `null` until a stable canonical lesson URL has been verified.

- [ ] **Step 3: Run unit tests and verify failure**

Run:

```bash
npm test -- tests/unit/ed-client.test.ts tests/unit/ed-parser.test.ts tests/unit/ed-source.test.ts
```

Expected: FAIL because the Ed modules do not exist.

- [ ] **Step 4: Implement the minimal Ed client and parser/source modules**

Use strict Zod schemas for the top-level structures and permissive `.passthrough()`/optional fields only inside supported Ed records so irrelevant beta fields do not break parsing.

`EdApiClient` exposes only `fetchUser()` and `fetchLessons(courseId)`; keep the generic request helper private.

`EdSource.testConnection()` fetches/parses the configured course lessons and returns `{ok:true,itemCount}` or the stable safe error. `EdSource.sync()` returns `parseEdLessons(...)`.

- [ ] **Step 5: Run unit tests and verify pass**

Run:

```bash
npm test -- tests/unit/ed-client.test.ts tests/unit/ed-parser.test.ts tests/unit/ed-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sources/ed tests/unit/ed-client.test.ts tests/unit/ed-parser.test.ts tests/unit/ed-source.test.ts
git commit -m "feat: add Ed API source adapter"
```

---

### Task 3: Add token test/connect, course discovery, refresh, and selection routes

**Files:**
- Create: `src/lib/ed/discovery-service.ts`
- Create: `src/app/api/sources/ed/test/route.ts`
- Create: `src/app/api/sources/ed/connect/route.ts`
- Create: `src/app/api/sources/ed/courses/route.ts`
- Create: `src/app/api/sources/ed/refresh/route.ts`
- Create: `tests/integration/ed-connection-api.test.ts`
- Create: `tests/integration/ed-courses-api.test.ts`
- Modify: `tests/integration/secret-exposure.test.ts`

**Interfaces:**
- Consumes: Task 1 Ed credential/connection methods; Task 2 `EdApiClient` and `parseEdCourses`; existing `SourceCourseRepository`.
- Produces `testEdConnection(token: string, fetchImpl?: typeof fetch): Promise<{ok:true;itemCount:number}>`.
- Produces `connectEd(db, token, fetchImpl?, now?): Promise<{connection: SourceConnection; courses: SourceCourse[]}>`.
- Produces `refreshEdCourses(db, fetchImpl?, now?): Promise<{connection: SourceConnection; courses: SourceCourse[]}>`.
- Produces `replaceEnabledEdCourses(db, enabledCourseIds: string[]): {connection: SourceConnection; courses: SourceCourse[]}`.
- Routes:
  - `POST /api/sources/ed/test` body `{token:string}`;
  - `POST /api/sources/ed/connect` body `{token:string}`;
  - `GET /api/sources/ed/courses`;
  - `PUT /api/sources/ed/courses` body `{enabledCourseIds:string[]}`;
  - `POST /api/sources/ed/refresh`.

- [ ] **Step 1: Write failing test/connect integration tests**

Assert:

- test calls `/api/user`, returns only `{ok:true,itemCount}`, and does not create `source_connections` or `source_credentials`;
- connect validates before persistence, stores the PAT only after success, upserts `kind:"ed"`, persists discovered courses disabled, and response JSON excludes the token;
- 401/403 produces `ED_AUTH_INVALID`;
- malformed `/api/user` produces `ED_PARSE_ERROR`;
- a valid `{courses:[]}` response succeeds with zero courses;
- replacing a working connection with an invalid new PAT leaves the old stored PAT unchanged.

- [ ] **Step 2: Write failing course selection/refresh tests**

Assert:

- GET with no connection returns `{connection:null,courses:[]}`;
- refresh uses the stored PAT server-side;
- rediscovery updates names/term/year but preserves existing enabled flags;
- newly discovered courses are disabled;
- duplicate IDs or an ID not present in this connection's discovered courses are rejected without changing prior selection.

- [ ] **Step 3: Run integration tests and verify failure**

Run:

```bash
npm test -- tests/integration/ed-connection-api.test.ts tests/integration/ed-courses-api.test.ts tests/integration/secret-exposure.test.ts
```

Expected: FAIL because Ed services/routes do not exist.

- [ ] **Step 4: Implement discovery service and routes**

Use a strict request schema with a non-empty trimmed token and decimal-string course IDs.

`connectEd` must perform validation/discovery first, then persist connection/token/courses in one local transaction after upstream success.

`replaceEnabledEdCourses` must compare requested IDs against `SourceCourseRepository.list(connection.id)` before calling `setEnabled`.

`refreshEdCourses` must not alter stored credentials and must preserve current enabled selections through `upsertDiscovered`.

All unexpected errors are converted to stable safe route messages; token-aware errors use explicit redaction.

- [ ] **Step 5: Run integration tests and verify pass**

Run the same command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ed/discovery-service.ts src/app/api/sources/ed tests/integration/ed-connection-api.test.ts tests/integration/ed-courses-api.test.ts tests/integration/secret-exposure.test.ts
git commit -m "feat: connect Ed and manage courses"
```

---

### Task 4: Add course-isolated Ed sync with partial-failure preservation

**Files:**
- Create: `src/lib/ed/sync-service.ts`
- Create: `src/app/api/sources/ed/sync/route.ts`
- Create: `tests/integration/ed-sync-service.test.ts`
- Create: `tests/integration/ed-sync-api.test.ts`
- Modify: `tests/integration/assignment-repository.test.ts` only if an Ed-specific persistence assertion cannot be expressed cleanly in the new sync-service test

**Interfaces:**
- Consumes: Task 1 repositories; Task 2 `EdSource`; existing `AssignmentRepository` and `SubmissionStatusRepository`.
- Produces `EdSyncErrorCode = EdErrorCode | "PARTIAL_SYNC" | "ED_NOT_CONNECTED" | "ED_NO_COURSES_ENABLED"`.
- Produces `syncEdConnection(db: Database.Database, options?: {fetchImpl?: typeof fetch; now?: Date}): Promise<EdSyncResult>`.
- Produces `EdSyncResult = {insertedCount:number;updatedCount:number;statusUpdatedCount:number;failedCourseCount:number;lastAttemptedAt:string|null;lastSuccessfulAt:string|null;lastErrorCode:EdSyncErrorCode|null}`.
- Produces `POST /api/sources/ed/sync` with no credential-bearing request body.

- [ ] **Step 1: Write failing sync-service tests for happy paths**

Seed an Ed connection, stored token, discovered enabled course(s), then mock Ed lesson responses.

Assert:

- only enabled courses are requested;
- all visible lessons are upserted;
- hidden/unlisted lessons are not persisted;
- dated and undated lessons both persist;
- valid empty lesson list counts as a successful course check;
- repeated sync updates rather than duplicates the same `externalId`.

- [ ] **Step 2: Write failing status/freshness tests**

For each successfully synced lesson, write a source-agnostic `assignment_submission_status` row so current UI resolution behavior works:

- Ed `completed` -> submission `state:"submitted"`;
- Ed `attempted`/`unattempted`/unknown -> submission `state:"unknown"`;
- `isLate:false`, `isMissing:false`, `submittedAt:null`;
- `checkedAt` is the course sync timestamp;
- `extractorVersion:"ed-api-v1"`.

Keep the generic `Assignment.status` mapping from Task 2 unchanged.

Assert a completed Ed lesson is resolved by existing Upcoming logic.

- [ ] **Step 3: Write failing partial/total failure tests**

Cover:

- one successful course + one `ED_COURSE_UNAVAILABLE` -> successful course upserts, failed-course previous assignment remains unchanged, `lastErrorCode:"PARTIAL_SYNC"`;
- one failed course + one successful empty course -> partial success and `lastSuccessfulAt` advances;
- all courses fail -> no assignment changes and previous `lastSuccessfulAt` is retained;
- invalid/missing stored token/connection -> `ED_NOT_CONNECTED`;
- no enabled courses -> `ED_NO_COURSES_ENABLED`;
- 429 and parse errors surface stable codes without token/body leakage.

- [ ] **Step 4: Run sync tests and verify failure**

Run:

```bash
npm test -- tests/integration/ed-sync-service.test.ts tests/integration/ed-sync-api.test.ts
```

Expected: FAIL because the Ed sync service/route do not exist.

- [ ] **Step 5: Implement `syncEdConnection` transaction boundaries**

At sync start:

- mark the connection attempt using `SubmissionStatusRepository.markAttempt`;
- load the stored PAT and enabled courses;
- fetch each course independently with an `EdSource`.

Collect successful course assignments and failures separately. Do not let one course exception abort collection of other course results.

Persist only successful-course assignments/status rows. Never delete missing assignments.

Use `SubmissionStatusRepository.applyCompletion(..., successfulChecksOverride)` so a successful empty course advances freshness.

Return `PARTIAL_SYNC` when successful course count > 0 and failed course count > 0; use the first stable upstream error when all fail.

- [ ] **Step 6: Implement `POST /api/sources/ed/sync`**

Return 409 for not-connected/no-enabled-course cases, safe 401 semantics for invalid authentication if the whole sync fails auth, and 200 with `lastErrorCode:"PARTIAL_SYNC"` for partial success.

Never accept a PAT in this route.

- [ ] **Step 7: Run focused tests and verify pass**

Run the same sync test command.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ed/sync-service.ts src/app/api/sources/ed/sync/route.ts tests/integration/ed-sync-service.test.ts tests/integration/ed-sync-api.test.ts
git commit -m "feat: sync Ed lessons safely"
```

---

### Task 5: Add the Ed client provider and Sources card

**Files:**
- Create: `src/features/ed/ed-provider.tsx`
- Create: `src/features/sources/ed-source-card.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/(dashboard)/sources/page.tsx`
- Create: `tests/component/ed-provider.test.tsx`
- Create: `tests/component/ed-source-card.test.tsx`

**Interfaces:**
- Consumes Task 3/4 routes and existing `SourceConnection`/`SourceCourse`.
- Produces `EdProvider` context with:
  - `connection: SourceConnection | null`;
  - `courses: SourceCourse[]`;
  - `phase: "idle" | "testing" | "connecting" | "refreshing" | "syncing" | "success" | "partial" | "error"`;
  - `message: string`;
  - `testToken(token: string)`;
  - `connect(token: string)`;
  - `refreshCourses()`;
  - `saveEnabledCourses(ids: string[])`;
  - `syncNow()`.
- Produces `EdSourceCard`; the PAT input lives only in component state and is cleared after successful connection/update.

- [ ] **Step 1: Write failing provider tests**

Mock `fetch` and assert:

- test submits token only to `/api/sources/ed/test`;
- connect submits token only to `/api/sources/ed/connect`, then updates public connection/course state from the response;
- sync calls `/api/sources/ed/sync` without a token body;
- refresh and selection update course state;
- `PARTIAL_SYNC` sets partial phase/message;
- a successful connect clears any token-bearing transient state owned by the provider.

- [ ] **Step 2: Write failing card tests**

Cover pre-connection UI:

- token input has `type="password"` and accessible label `Ed API token`;
- copy explains local storage/read-only behavior;
- Test connection and Connect Ed actions are present.

Cover connected UI:

- existing token value is never present;
- course checkboxes reflect enabled state;
- Refresh courses, Save selection, Sync Ed, and Update token are available;
- new course selection sends exact IDs;
- last attempted/successful state is visible when present;
- actionable auth/partial messages render safely.

- [ ] **Step 3: Run component tests and verify failure**

Run:

```bash
npm test -- tests/component/ed-provider.test.tsx tests/component/ed-source-card.test.tsx
```

Expected: FAIL because the provider/card do not exist.

- [ ] **Step 4: Implement `EdProvider`**

Follow the separate-provider pattern used by Gradescope rather than merging Ed into an existing provider.

Do **not** add stale-on-open automatic Ed sync in this milestone; the approved spec requires manual `Sync now` but explicitly defers background periodic refresh and does not require an automatic mount refresh.

- [ ] **Step 5: Integrate provider and replace the placeholder card**

In `DashboardLayout`, load the Ed public connection/courses and sync freshness using existing repositories, then nest `EdProvider` alongside the current providers.

In Sources page, replace `FutureSourceCard name="Ed"` with `<EdSourceCard />`.

- [ ] **Step 6: Run component tests and verify pass**

Run the same component test command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/ed/ed-provider.tsx src/features/sources/ed-source-card.tsx src/app/'(dashboard)'/layout.tsx src/app/'(dashboard)'/sources/page.tsx tests/component/ed-provider.test.tsx tests/component/ed-source-card.test.tsx
git commit -m "feat: add Ed source onboarding UI"
```

---

### Task 6: Pin Ed assignment behavior across Upcoming and assignment surfaces

**Files:**
- Modify: `src/lib/assignments/queries.ts`
- Modify: `tests/unit/due-date-groups.test.ts`
- Create: `tests/component/ed-assignment-ui.test.tsx`
- Modify: assignment row/table/detail files only if the new tests expose missing generic rendering:
  - `src/features/assignments/assignment-row.tsx`
  - `src/features/assignments/assignment-table.tsx`
  - `src/features/assignments/assignment-detail-dialog.tsx`

**Interfaces:**
- Consumes: persisted Ed `Assignment` plus Task 4 submission-status rows.
- Produces: existing `groupUpcoming(...)` behavior with one source-specific rule from the approved spec: undated Ed lessons are excluded from Upcoming rather than placed in `no-due-date`; non-Ed no-due-date behavior remains unchanged.

- [ ] **Step 1: Write failing Upcoming behavior tests**

Add cases proving:

```ts
// pending Ed lesson with a due date -> normal due bucket
// pending Ed lesson with dueAt:null -> absent from all Upcoming groups
// completed Ed lesson with a due date -> absent because submission state is submitted
// Canvas assignment with dueAt:null -> still follows existing no-due-date behavior
```

This pins the approved Ed-specific undated rule without changing legacy Canvas behavior.

- [ ] **Step 2: Write failing Ed assignment UI tests**

Create an Ed assignment fixture and assert:

- Source badge renders `Ed`;
- due date renders normally when present and `No due date` when null;
- `sourceStatusText` such as `completed` or `attempted` appears in detail;
- release date appears when present;
- source link is absent when `sourceUrl:null` rather than rendering an invalid link.

- [ ] **Step 3: Run tests and verify the intended failure**

Run:

```bash
npm test -- tests/unit/due-date-groups.test.ts tests/component/ed-assignment-ui.test.tsx
```

Expected: the new undated-Ed Upcoming assertion fails until query logic is updated; generic assignment rendering may already pass.

- [ ] **Step 4: Implement the minimal Upcoming/query change**

In `groupUpcoming`, after resolved-work filtering:

```text
if source is ed and dueAt is null, skip it
```

Do not remove or rename the existing `no-due-date` bucket because other sources rely on it.

Only change assignment presentation components if their tests reveal a generic-field gap.

- [ ] **Step 5: Run focused tests and verify pass**

Run the same command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assignments/queries.ts tests/unit/due-date-groups.test.ts tests/component/ed-assignment-ui.test.tsx src/features/assignments
git commit -m "feat: integrate Ed lessons into assignment views"
```

---

### Task 7: Add end-to-end coverage and secret-leak regression checks

**Files:**
- Create: `src/lib/ed/e2e-fixture-fetch.ts`
- Modify: `src/app/api/sources/ed/test/route.ts`
- Modify: `src/app/api/sources/ed/connect/route.ts`
- Modify: `src/app/api/sources/ed/refresh/route.ts`
- Modify: `src/app/api/sources/ed/sync/route.ts`
- Create: `tests/e2e/ed-sync.spec.ts`
- Modify: `src/app/api/test-fixtures/reset/route.ts` only if current reset does not clear generic Ed tables through its existing database reset

**Interfaces:**
- Uses public Ed Sources UI and server routes exactly as a browser user does.
- Produces `getEdRouteFetch(): typeof fetch`: returns normal global `fetch` unless `E2E_FIXTURES === "1"`; in fixture mode it returns a deterministic in-process fetch implementation for the same fixed `https://edstem.org/api/*` URLs.
- The fixture fetch accepts only the known E2E token marker and only the exact Ed endpoints needed by the scenario; it never changes `EdApiClient`'s fixed production origin.
- No real PAT, external Ed request, or Ed account is used.

- [ ] **Step 1: Add the server-side Ed E2E fixture transport**

Because Ed network calls originate inside Next.js server routes, do not use Playwright `page.route()` to mock `edstem.org`; browser routing cannot intercept server-side fetches.

Implement `getEdRouteFetch()` behind the existing `E2E_FIXTURES=1` gate. In fixture mode, return deterministic JSON for:

- `GET https://edstem.org/api/user`;
- `GET https://edstem.org/api/courses/123/lessons`.

Return 401 for any token other than `fixture-ed-token-never-echo`, and reject any unexpected method/path. Normal application mode must return the real global `fetch`.

Wire the Ed test/connect/refresh/sync routes to pass `getEdRouteFetch()` into their service functions. Unit/integration tests may continue injecting/stubbing fetch directly.

- [ ] **Step 2: Write the E2E scenario**

Exercise:

1. reset fixture database;
2. open Sources;
3. enter `fixture-ed-token-never-echo`;
4. test connection;
5. connect;
6. enable discovered course `123`;
7. save selection;
8. sync Ed;
9. verify a dated pending lesson appears in All Assignments and Upcoming;
10. verify an undated lesson appears in All Assignments but not Upcoming;
11. verify a completed lesson remains visible in All Assignments but not Upcoming;
12. verify the Ed source status/detail fields.

- [ ] **Step 3: Add request/response secret capture assertions**

Capture Kairos `/api/sources/ed/` response bodies and post bodies.

Allow the PAT only in the request body for `/test` and `/connect`; assert it is absent from:

- every response body;
- `/courses`, `/refresh`, and `/sync` request bodies;
- rendered page text after successful connection;
- any error text.

Also assert no serialized `authorization` header appears in Kairos API payloads.

- [ ] **Step 4: Run the repository E2E target**

Run:

```bash
npm run test:e2e -- tests/e2e/ed-sync.spec.ts
```

Expected: PASS. If Playwright config requires project selection for this file, use the existing project's supported invocation rather than adding a new browser dependency.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ed/e2e-fixture-fetch.ts src/app/api/sources/ed tests/e2e/ed-sync.spec.ts src/app/api/test-fixtures/reset/route.ts
git commit -m "test: cover Ed onboarding and sync"
```

---

### Task 8: Update user documentation and roadmap state

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/ROADMAP.md`

**Interfaces:**
- Documentation reflects implemented behavior only; do not claim Milestone 4 complete until automated verification and live-account smoke are both green.

- [ ] **Step 1: Update README Ed setup/privacy documentation**

Add a **Connect Ed** section that says:

- create/copy a personal access token from Ed's API-token settings;
- paste it only into Kairos Sources → Ed;
- Kairos stores it in local SQLite in plaintext for this milestone;
- anyone with access to that database may be able to recover it;
- choose explicit courses;
- Sync Ed imports all visible lessons, including undated lessons;
- hidden/unlisted lessons are excluded;
- Ed API is beta/unofficial and may require maintenance;
- Kairos performs no Ed writes.

Update cross-source/privacy/test sections to include Ed without weakening the existing Canvas/Gradescope statements.

- [ ] **Step 2: Correct roadmap Milestone 3 status**

Change Milestone 3 to complete and record that real-browser smoke succeeded and PR #11 was squash-merged.

Do not rewrite the historical Milestone 3 design/spec.

- [ ] **Step 3: Update Milestone 4 roadmap status to implementation complete / manual smoke pending**

List delivered automated scope and state the remaining real-account smoke gate.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/ROADMAP.md
git commit -m "docs: document Ed connector"
```

---

### Task 9: Run complete verification and real-account acceptance smoke

**Files:**
- Modify only files required to fix failures discovered by verification.
- After successful live smoke, modify: `docs/superpowers/ROADMAP.md` to mark Milestone 4 complete.

**Interfaces:**
- This task is the release gate; no new feature scope.

- [ ] **Step 1: Run focused Ed suites**

Run:

```bash
npm test -- tests/unit/ed-client.test.ts tests/unit/ed-parser.test.ts tests/unit/ed-source.test.ts tests/integration/ed-connection-api.test.ts tests/integration/ed-courses-api.test.ts tests/integration/ed-sync-service.test.ts tests/integration/ed-sync-api.test.ts tests/component/ed-provider.test.tsx tests/component/ed-source-card.test.tsx tests/component/ed-assignment-ui.test.tsx tests/integration/secret-exposure.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the full automated verification suite**

Run exactly:

```bash
npm test
npm run lint
npm run typecheck
npm run build:extension
npm run test:e2e
npm run build
```

Expected:

- Vitest all pass;
- lint exits 0;
- typecheck exits 0;
- Firefox extension build exits 0 with no Ed permission expansion;
- Playwright all pass;
- production build exits 0.

- [ ] **Step 3: Perform the real-account Ed smoke without exposing the PAT**

The user enters their PAT directly into the local Kairos UI; it is never pasted into chat, shell history, test code, screenshots, or committed files.

Verify:

1. Test connection succeeds.
2. Expected enrolled courses appear.
3. Existing selections survive Refresh courses.
4. Enable at least one course and Sync Ed.
5. Compare lesson titles, visibility, progress, release dates, and due dates with Ed.
6. Confirm an undated real lesson if one exists; if none exists, the fixture/E2E coverage remains the acceptance evidence for that shape.
7. Confirm completed lessons are absent from Upcoming.
8. Confirm hidden/unlisted lessons are not imported if the account exposes such examples.
9. Replace the PAT with a deliberately invalid value through Update token and verify the existing stored valid credential is not destroyed; then restore/confirm normal sync without exposing either token.
10. Confirm no token is rendered back in the UI or returned in inspected Kairos API responses.

- [ ] **Step 4: Mark Milestone 4 complete after the live smoke succeeds**

Update `docs/superpowers/ROADMAP.md` from “manual smoke pending” to “Complete” and record the completed validation at a high level without account-specific/private data.

- [ ] **Step 5: Re-run documentation-sensitive smoke checks and inspect the diff**

Run:

```bash
git status --short
git diff --check
```

Expected: no whitespace errors; only intended Milestone 4 files changed.

- [ ] **Step 6: Commit the acceptance/roadmap closure**

```bash
git add docs/superpowers/ROADMAP.md
git commit -m "docs: complete Milestone 4"
```
