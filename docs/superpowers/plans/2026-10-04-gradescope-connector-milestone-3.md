# Kairos Milestone 3 — Direct Gradescope Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Firefox-first, read-only Gradescope connector that discovers student courses from an already signed-in Gradescope tab and imports complete assignment metadata, submission state, and published grades into Kairos.

**Architecture:** Extend the existing Kairos Firefox extension with a Gradescope content script and strict Gradescope bridge protocol. The browser content script performs same-origin authenticated reads and emits normalized records only; Kairos validates server-issued request/course identities, persists source-specific metadata locally, and preserves prior known data on partial or failed syncs.

**Tech Stack:** Next.js 16.3.8, React 19.3, TypeScript 5.9, Zod 4.1, SQLite via better-sqlite3 13, Firefox Manifest V3, esbuild, Vitest 5, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-gradescope-connector-design.md`

## Global Constraints

- Firefox first; Chromium support remains deferred.
- Reuse an already signed-in `https://www.gradescope.com/*` tab.
- Never ask for, store, export, or proxy Gradescope/UW passwords, session cookies, CSRF tokens, response headers, or raw authenticated HTML.
- Gradescope reads are read-only; no uploads, submissions, deadline edits, assignment edits, or grade edits.
- Only fixed Gradescope origin + validated decimal course/assignment identifiers may drive requests.
- Preserve Gradescope source records independently from Canvas; never silently merge cross-source assignments or invent a canonical deadline.
- Persist release date, normal due date, late due date, source status text, normalized submission state, published score, maximum score, and display score from the beginning.
- The normal due date remains the Upcoming/Calendar deadline; late due date is source metadata, not a replacement deadline.
- Unknown Gradescope status text remains `unknown`; initially only exact normalized `No Submission` and `Not Submitted` map to `not_submitted`.
- Failed/partial refreshes never delete previously stored assignment/status/grade data.
- Stale-on-open threshold is 15 minutes; manual refresh is always available; no periodic background alarm.
- Maximum protocol sizes: 50 discovered courses, 20 selected courses per sync request, 500 normalized assignments per sync result.
- Live Gradescope is manual smoke-test only, never CI.

## Review Focus

- Gradescope returns an authenticated 200 page with an unexpected DOM shape: report `GRADESCOPE_PARSE_ERROR`, preserve stored data, and never guess identities.
- A course page contains section/summary/non-assignment rows: omit them without inventing assignments and count privacy-safe parse diagnostics.
- Grade text is non-decimal or decorated (for example blank, dash, text feedback, or unexpected spacing): preserve source text, do not coerce a numeric grade, and keep state conservative.
- One selected course fails while others succeed: persist successful courses, retain failed-course data, mark partial sync, and advance successful freshness only when at least one course was actually checked.
- An old extension or spoofed bridge sends extra sensitive fields or unexpected course IDs: strict schemas/identity validation reject the result before persistence.

---

### Task 1: Extend the source/assignment data model with safe additive migrations

**Files:**
- Modify: `src/lib/assignments/types.ts`
- Modify: `src/lib/sources/types.ts`
- Modify: `src/lib/assignments/normalize.ts`
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/lib/db/repositories/source-connections.ts`
- Modify: `src/lib/db/repositories/assignments.ts`
- Create: `src/lib/db/repositories/source-courses.ts`
- Modify: `src/lib/submission-status/types.ts`
- Modify: `src/lib/db/repositories/submission-status.ts`
- Test: `tests/integration/gradescope-schema.test.ts`
- Modify test: `tests/integration/assignment-repository.test.ts`
- Modify test: `tests/integration/submission-status-repository.test.ts`

**Interfaces:**
- Produces `Assignment.releaseAt: string | null`, `lateDueAt: string | null`, `sourceStatusText: string | null`, `gradeScore: string | null`, `gradeMax: string | null`, `gradeDisplay: string | null`.
- Produces matching nullable fields on `SourceAssignment` / `NormalizedAssignment`.
- Produces `SourceCourse` with `id`, `sourceConnectionId`, `externalCourseId`, `shortName`, `fullName`, `term`, `year`, `enabled`, `firstSeenAt`, `lastSeenAt`.
- Produces `SourceCourseRepository.upsertDiscovered(sourceConnectionId, courses, seenAt)`, `list(sourceConnectionId)`, `listEnabled(sourceConnectionId)`, and `setEnabled(sourceConnectionId, externalCourseIds)`.
- Produces `SourceConnectionRepository.upsertGradescope(label: string): SourceConnection`.
- Refactors `SubmissionStatusRepository.applyCompletion(...)` to consume a source-agnostic internal `SubmissionStatusWrite[]` rather than the Canvas wire type; Canvas callers adapt without changing behavior.

- [ ] **Step 1: Write failing migration/repository tests**

Add tests proving:
- an existing pre-Milestone-3 `assignments` table receives all six nullable metadata columns after `migrate(db)`;
- `source_courses` is created idempotently and preserves enabled selection across rediscovery;
- Gradescope source connection upsert is idempotent;
- assignment upsert round-trips release/late/status/grade metadata;
- Canvas assignments with no new metadata still round-trip nulls;
- source-agnostic submission writes preserve stale-write protection.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:
`npm test -- tests/integration/gradescope-schema.test.ts tests/integration/assignment-repository.test.ts tests/integration/submission-status-repository.test.ts`

Expected: FAIL because the metadata columns/repository/types do not exist.

- [ ] **Step 3: Implement additive migration and model/repository interfaces**

Use `PRAGMA table_info(assignments)` to conditionally issue `ALTER TABLE assignments ADD COLUMN ...` for existing databases. Keep `CREATE TABLE IF NOT EXISTS source_courses (...)` in the schema. Do not introduce a destructive rebuild migration.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS.

- [ ] **Step 5: Run Canvas regression slice**

Run:
`npm test -- tests/integration/assignment-repository.test.ts tests/integration/submission-status-repository.test.ts tests/unit/due-date-groups.test.ts`

Expected: PASS with existing Canvas behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assignments src/lib/sources/types.ts src/lib/db/migrate.ts src/lib/db/repositories src/lib/submission-status tests/integration tests/unit/due-date-groups.test.ts
git commit -m "feat: add Gradescope persistence model"
```

### Task 2: Add strict Gradescope extension protocol schemas

**Files:**
- Create: `src/lib/extension-protocol/gradescope.ts`
- Create: `src/lib/extension-protocol/bridge.ts`
- Modify: `src/lib/extension-protocol/submission-status.ts`
- Test: `tests/unit/gradescope-protocol.test.ts`
- Modify test: `tests/unit/extension-protocol.test.ts`

**Interfaces:**
- Produces `gradescopeCourseV1Schema`.
- Produces `gradescopeAssignmentV1Schema` with validated decimal `courseId`/`assignmentId`, dates, source status, normalized state, decimal-string grade fields, `checkedAt`, and `extractorVersion`; it does **not** accept an arbitrary URL field.
- Produces `gradescopeDiscoverRequestV1Schema`, `gradescopeDiscoverResultV1Schema`, `gradescopeSyncRequestV1Schema`, `gradescopeSyncResultV1Schema`.
- Produces stable Gradescope error codes: `GRADESCOPE_TAB_UNAVAILABLE`, `GRADESCOPE_SIGNED_OUT`, `GRADESCOPE_NETWORK_ERROR`, `GRADESCOPE_COURSE_UNAVAILABLE`, `GRADESCOPE_PARSE_ERROR`, plus `PARTIAL_SYNC` and `INVALID_RESULT`.
- Produces common `kairosBridgeRequestV1Schema` / `kairosBridgeResponseV1Schema` in `bridge.ts` composing Canvas + Gradescope messages.
- Extends PONG with optional `gradescopeTabDetected` so a missing field from an older extension remains parseable.

- [ ] **Step 1: Write failing protocol tests**

Assert:
- discovery result accepts at most 50 strict course records;
- sync request accepts at most 20 decimal course IDs;
- sync result accepts at most 500 strict assignments;
- grade strings accept decimal forms such as `8.5`, `10`, `0.25` and reject `NaN`, `Infinity`, embedded labels, and exponent notation;
- any `url`, `cookie`, `headers`, `authorization`, `csrfToken`, `html`, or `body` field causes strict rejection;
- common bridge union accepts Canvas messages unchanged and new Gradescope messages.

- [ ] **Step 2: Run protocol tests and verify RED**

Run:
`npm test -- tests/unit/gradescope-protocol.test.ts tests/unit/extension-protocol.test.ts`

Expected: FAIL because Gradescope/common bridge schemas do not exist.

- [ ] **Step 3: Implement minimal schemas/types**

Keep source-specific wire contracts separate. Preserve existing Canvas schema exports for compatibility while moving only bridge composition to `bridge.ts`.

- [ ] **Step 4: Run protocol tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extension-protocol tests/unit/gradescope-protocol.test.ts tests/unit/extension-protocol.test.ts
git commit -m "feat: define Gradescope bridge protocol"
```

### Task 3: Port the Gradescope student-page parsers into focused TypeScript extractors

**Files:**
- Create: `extension/firefox/src/gradescope/extract-courses.ts`
- Create: `extension/firefox/src/gradescope/extract-assignments.ts`
- Create: `extension/firefox/tests/fixtures/gradescope-account-student.html`
- Create: `extension/firefox/tests/fixtures/gradescope-course-student.html`
- Create: `extension/firefox/tests/fixtures/gradescope-course-malformed.html`
- Create: `extension/firefox/tests/gradescope-course-extractor.test.ts`
- Create: `extension/firefox/tests/gradescope-assignment-extractor.test.ts`

**Interfaces:**
- Produces `extractGradescopeStudentCourses(html: string): GradescopeCourseV1[]`.
- Produces `extractGradescopeStudentAssignments(html: string, courseId: string, checkedAt: string): { assignments: GradescopeAssignmentV1[]; diagnostics: GradescopeParseDiagnostic[] }`.
- Uses `DOMParser`; no BeautifulSoup/Python dependency.
- Maps numeric visible score to `graded`, exact normalized `Submitted` to `submitted`, exact `No Submission`/`Not Submitted` to `not_submitted`, all other text to `unknown`.
- Leaves `submittedAt` null unless a future verified page field exists.
- Emits no source URL over the wire; server code later constructs `https://www.gradescope.com/courses/:courseId/assignments/:assignmentId`.

- [ ] **Step 1: Add sanitized fixture HTML and failing extractor tests**

Cover:
- student-only course parsing when account also has instructor sections;
- link-based assignment ID;
- submit-button assignment ID;
- release/due/late `datetime` parsing;
- submitted row;
- numeric graded row;
- explicit no-submission rows;
- unknown status text;
- missing dates;
- non-assignment/section row ignored;
- stable-ID-missing row omitted + diagnostic;
- malformed page returns a parse failure rather than an empty-success ambiguity;
- decorated/non-decimal grade text does not become numeric.

- [ ] **Step 2: Run extractor tests and verify RED**

Run:
`npm test -- extension/firefox/tests/gradescope-course-extractor.test.ts extension/firefox/tests/gradescope-assignment-extractor.test.ts`

Expected: FAIL because extractor modules do not exist.

- [ ] **Step 3: Implement the minimal DOM extractors**

Base selectors/semantics on the current `nyuoss/gradescope-api` student-path behavior, but keep parsing functions pure and fixture-driven.

- [ ] **Step 4: Run extractor tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/firefox/src/gradescope extension/firefox/tests
git commit -m "feat: parse Gradescope student courses and assignments"
```

### Task 4: Add same-origin Gradescope fetching and extension broker support

**Files:**
- Create: `extension/firefox/src/gradescope/fetch.ts`
- Create: `extension/firefox/src/content/gradescope.ts`
- Modify: `extension/firefox/src/background.ts`
- Modify: `extension/firefox/src/background/broker.ts`
- Modify: `extension/firefox/src/content/kairos-bridge.ts`
- Modify: `extension/firefox/manifest.json`
- Modify: `scripts/build-firefox-extension.mjs`
- Modify: `extension/firefox/src/popup.ts`
- Modify: `extension/firefox/popup.html`
- Create: `extension/firefox/tests/gradescope-fetcher.test.ts`
- Modify: `extension/firefox/tests/background-broker.test.ts`
- Modify: `extension/firefox/tests/manifest.test.ts`

**Interfaces:**
- Produces `discoverGradescopeCourses(fetchImpl = fetch): Promise<GradescopeDiscoverResultV1>`.
- Produces `fetchGradescopeAssignments(request: GradescopeSyncRequestV1, fetchImpl = fetch, now = () => new Date()): Promise<GradescopeSyncResultV1>`.
- Broker adapter gains `findGradescopeTab()` and `sendToGradescopeTab(tabId, request)`.
- Manifest adds only `https://www.gradescope.com/*` host permission and `dist/gradescope-content.js` content script.
- Build adds `gradescope-content` entry point.
- Popup displays Canvas and Gradescope tab detection independently.

- [ ] **Step 1: Write failing fetch/broker/manifest tests**

Assert:
- discovery GETs same-origin `/account` with `credentials: "include"` and follows redirects;
- sync fetches only `/courses/<decimalId>` for IDs in the request;
- final origin must be exactly `https://www.gradescope.com`;
- redirect/login/401/403 maps to `GRADESCOPE_SIGNED_OUT`;
- 429/5xx/other HTTP statuses produce privacy-safe diagnostics;
- unexpected authenticated DOM maps to `GRADESCOPE_PARSE_ERROR`;
- one course failure + one success yields `PARTIAL_SYNC`;
- broker routes Gradescope messages only to a Gradescope tab;
- manifest contains no cookies/history/downloads/`<all_urls>`/webRequest permission.

- [ ] **Step 2: Run extension tests and verify RED**

Run:
`npm test -- extension/firefox/tests/gradescope-fetcher.test.ts extension/firefox/tests/background-broker.test.ts extension/firefox/tests/manifest.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement fetcher, content script, broker dispatch, build/manifest/popup changes**

Use bounded course concurrency of 4. Never pass raw response text outside the Gradescope content-script extractor call.

- [ ] **Step 4: Run focused extension tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Build the extension**

Run: `npm run build:extension`

Expected: exit 0 with `gradescope-content.js` emitted.

- [ ] **Step 6: Commit**

```bash
git add extension/firefox scripts/build-firefox-extension.mjs
git commit -m "feat: add Gradescope Firefox bridge"
```

### Task 5: Persist discovered Gradescope courses and selection through server-issued discovery requests

**Files:**
- Create: `src/lib/gradescope/request-registry.ts`
- Create: `src/lib/gradescope/discovery-service.ts`
- Create: `src/app/api/sources/gradescope/discover/start/route.ts`
- Create: `src/app/api/sources/gradescope/discover/complete/route.ts`
- Create: `src/app/api/sources/gradescope/courses/route.ts`
- Test: `tests/unit/gradescope-request-registry.test.ts`
- Test: `tests/integration/gradescope-discovery-api.test.ts`

**Interfaces:**
- Produces short-lived process-local registry entries with a 10-minute expiry and single-use consumption.
- `startGradescopeDiscovery(db, now?) -> { requestId }` registers a discovery request.
- `completeGradescopeDiscovery(db, input, now?) -> { connection, courses }` validates the result, upserts `kind="gradescope"`, and persists discovered courses disabled by default on first sight while preserving prior enabled values.
- `PUT /api/sources/gradescope/courses` accepts `{ enabledCourseIds: string[] }`, validates IDs against discovered courses, and replaces the enabled set.
- Rediscovery never silently enables a new course.

- [ ] **Step 1: Write failing registry/discovery API tests**

Cover expiry, consume-once, mismatched request ID, strict result parsing, >50 courses rejection, selection preservation, unknown enable-ID rejection, and no credential/source HTML fields in accepted request bodies.

- [ ] **Step 2: Run tests and verify RED**

Run:
`npm test -- tests/unit/gradescope-request-registry.test.ts tests/integration/gradescope-discovery-api.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement registry, services, and routes**

Keep registry source-specific so Gradescope discovery/sync identities cannot collide with Canvas submission-status registry state.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gradescope src/app/api/sources/gradescope tests/unit/gradescope-request-registry.test.ts tests/integration/gradescope-discovery-api.test.ts
git commit -m "feat: persist Gradescope course discovery"
```

### Task 6: Implement validated Gradescope assignment sync and atomic metadata/status persistence

**Files:**
- Create: `src/lib/gradescope/sync-service.ts`
- Create: `src/app/api/sources/gradescope/sync/start/route.ts`
- Create: `src/app/api/sources/gradescope/sync/complete/route.ts`
- Modify: `src/lib/db/repositories/assignments.ts`
- Modify: `src/lib/db/repositories/submission-status.ts`
- Test: `tests/integration/gradescope-sync-service.test.ts`
- Test: `tests/integration/gradescope-sync-api.test.ts`

**Interfaces:**
- `startGradescopeSync(db, now?) -> { requestId, courseIds, maxCourseBatchSize: 20 }` binds the request to the exact enabled discovered course IDs and marks an attempt.
- `completeGradescopeSync(db, input, now?)` consumes the request, rejects unexpected course IDs, constructs canonical source URLs server-side, upserts assignment metadata, applies normalized submission writes, and returns counts/freshness/error diagnostics.
- A successful parsed assignment uses `externalId = assignmentId` within the Gradescope source connection.
- Grade/status/metadata for a failed course are left untouched.
- A course with a successful parse but zero assignments counts as actually checked.
- `lastSuccessfulAt` advances when >=1 selected course was actually checked, including partial success.

- [ ] **Step 1: Write failing sync tests**

Cover:
- exact enabled course IDs in start result;
- no-enabled-course behavior;
- unexpected/missing returned course identity rejection;
- idempotent assignment upsert with all metadata;
- server-generated canonical Gradescope URL;
- normalized status persistence;
- numeric grade strings preserved exactly;
- partial success persists only successful course;
- failed course retains old data;
- stale submission `checkedAt` cannot overwrite newer state;
- total failure leaves `lastSuccessfulAt` unchanged;
- successful empty course advances freshness.

- [ ] **Step 2: Run sync tests and verify RED**

Run:
`npm test -- tests/integration/gradescope-sync-service.test.ts tests/integration/gradescope-sync-api.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement minimal sync service/routes and transactional persistence**

Use a single DB transaction per completion request for assignment metadata + submission-state writes for successful course results. Do not delete assignments missing from the latest response.

- [ ] **Step 4: Run sync tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Run Canvas persistence regression tests**

Run:
`npm test -- tests/integration/submission-status-api-routes.test.ts tests/integration/submission-status-repository.test.ts tests/integration/assignment-repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gradescope src/app/api/sources/gradescope src/lib/db/repositories tests/integration
git commit -m "feat: sync Gradescope assignments"
```

### Task 7: Build the Gradescope source UI and stale-on-open/manual refresh client flow

**Files:**
- Create: `src/features/gradescope/extension-bridge.ts`
- Create: `src/features/gradescope/gradescope-provider.tsx`
- Create: `src/features/sources/gradescope-source-card.tsx`
- Modify: `src/app/(dashboard)/sources/page.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/features/submission-status/extension-bridge.ts`
- Test: `tests/component/gradescope-source-card.test.tsx`
- Test: `tests/component/gradescope-provider.test.tsx`
- Modify test: `tests/component/submission-status-provider.test.tsx`

**Interfaces:**
- `pingKairosExtension()` returns both Canvas and optional Gradescope tab detection without duplicating the PING implementation.
- `GradescopeProvider` exposes discovery state, sync state, `discoverCourses()`, `saveEnabledCourses(ids)`, and `syncNow()`.
- Uses the same 15-minute stale threshold as Canvas but independent Gradescope freshness.
- Auto-sync runs once per dashboard mount when connected + enabled courses exist + data is stale.
- Sources card supports: Open Gradescope, Discover courses, course checkboxes, Save selection, Sync Gradescope, connection/sync diagnostics.

- [ ] **Step 1: Write failing provider/source-card tests**

Cover:
- no extension;
- extension detected but no Gradescope tab;
- signed-out discovery error;
- discovered courses rendered unchecked on first discovery;
- saved enabled selection round-trips;
- manual sync;
- exactly one stale-on-open sync;
- no auto-sync when fresh or no enabled courses;
- partial sync message;
- router refresh only after new successful data.

- [ ] **Step 2: Run tests and verify RED**

Run:
`npm test -- tests/component/gradescope-source-card.test.tsx tests/component/gradescope-provider.test.tsx tests/component/submission-status-provider.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement provider/bridge/source card and wire dashboard layout**

Keep Canvas `SubmissionStatusProvider` behavior unchanged; nesting a separate `GradescopeProvider` is preferred over turning one provider into a multi-source state machine.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/gradescope src/features/sources src/features/submission-status/extension-bridge.ts src/app/'(dashboard)' tests/component
git commit -m "feat: add Gradescope source controls"
```

### Task 8: Surface Gradescope dates, source status, and grades across assignment views

**Files:**
- Modify: `src/features/assignments/assignment-detail-dialog.tsx`
- Modify: `src/features/assignments/assignment-table.tsx`
- Modify: `src/features/assignments/assignment-row.tsx`
- Modify: `src/features/assignments/assignment-calendar.tsx` only if needed for generic status assumptions
- Modify: `src/features/submission-status/status-presentation.ts` only if source-neutral naming is needed
- Test: `tests/component/gradescope-assignment-ui.test.tsx`
- Modify test: `tests/component/assignment-detail.test.tsx`
- Modify test: `tests/component/assignment-table.test.tsx`
- Modify test: `tests/component/upcoming.test.tsx`
- Modify test: `tests/component/assignment-calendar.test.tsx`
- Modify test: `tests/unit/due-date-groups.test.ts`

**Interfaces:**
- Detail dialog displays release, due, late due, source status, normalized status, score/max score, and source link for Gradescope.
- All Assignments desktop table gains a `Grade` column showing `gradeDisplay` or em dash; mobile cards include grade when present.
- Upcoming keeps using `dueAt`; Gradescope submitted/graded work is excluded by the existing normalized resolved-state rule.
- Calendar creates only the normal due-date event and retains resolved styling; it does not create a separate late-due event.

- [ ] **Step 1: Write failing assignment UI/regression tests**

Assert:
- `8.5 / 10` visible in table/detail for Gradescope;
- release and late due visible in detail with timezone formatting;
- exact source status text visible in detail;
- source link label says `Open in Gradescope`;
- submitted/graded Gradescope assignments are absent from all Upcoming groups;
- unknown/not-submitted Gradescope assignments remain;
- calendar contains one event for the normal due date only and retains completion styling;
- Canvas rows render unchanged with empty grade metadata.

- [ ] **Step 2: Run UI/grouping tests and verify RED**

Run:
`npm test -- tests/component/gradescope-assignment-ui.test.tsx tests/component/assignment-detail.test.tsx tests/component/assignment-table.test.tsx tests/component/upcoming.test.tsx tests/component/assignment-calendar.test.tsx tests/unit/due-date-groups.test.ts`

Expected: FAIL on Gradescope-specific presentation.

- [ ] **Step 3: Implement source-neutral presentation changes**

Avoid Gradescope-only branching where the new metadata fields can be rendered generically; retain source-specific labels only where appropriate.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/assignments src/features/submission-status tests/component tests/unit/due-date-groups.test.ts
git commit -m "feat: display Gradescope assignment details"
```

### Task 9: Add end-to-end privacy coverage, documentation, and final verification

**Files:**
- Create: `tests/e2e/gradescope-sync.spec.ts`
- Modify: `tests/e2e/submission-status.spec.ts` only for shared PING shape compatibility
- Modify: `README.md`
- Modify: `docs/superpowers/ROADMAP.md`
- Modify: `.github/workflows/milestone-2-ci.yml` only if current workflow omits a verification command needed by Milestone 3

**Interfaces:**
- E2E mocks the extension page bridge; it does not contact live Gradescope.
- E2E validates discovery -> selection -> sync -> persisted assignment metadata -> resolved Upcoming behavior.
- Captured browser bridge/API payloads must not contain: `cookie`, `authorization`, `csrf`, `password`, `<html`, or test secret markers.
- README documents Firefox loading, signed-in Gradescope tab requirement, discovery/selection/sync behavior, privacy boundary, parser-maintenance caveat, and real-browser smoke steps.
- Roadmap marks Milestone 3 complete only after automated verification and manual real-account smoke both succeed.

- [ ] **Step 1: Write failing Gradescope E2E**

Use deterministic mocked course discovery and assignment sync results including release/due/late dates, Submitted and Graded records, and a published `8.5 / 10` score.

- [ ] **Step 2: Run E2E and verify RED before final wiring/doc fixes**

Run: `npm run test:e2e -- tests/e2e/gradescope-sync.spec.ts`

Expected: FAIL until the complete browser/UI flow is wired.

- [ ] **Step 3: Make only the minimal integration/documentation changes required for the E2E and shipped workflow**

Do not add new product scope.

- [ ] **Step 4: Run the complete automated verification suite**

Run in order:

```bash
npm test
npm run lint
npm run typecheck
npm run build:extension
npm run test:e2e
npm run build
```

Expected:
- Vitest: 0 failed tests;
- ESLint: exit 0;
- TypeScript: exit 0;
- Firefox extension build: exit 0;
- Playwright: 0 failed tests;
- Next.js production build: exit 0.

- [ ] **Step 5: Run explicit privacy/permission review**

Inspect the final manifest and repository diff for prohibited permission/data patterns. At minimum verify the extension does not request `cookies`, `history`, `downloads`, `<all_urls>`, or webRequest interception, and that Gradescope bridge/result schemas cannot carry raw HTML/headers/auth tokens.

- [ ] **Step 6: Commit automated completion/docs**

```bash
git add tests/e2e README.md docs/superpowers/ROADMAP.md .github/workflows/milestone-2-ci.yml
git commit -m "test: complete Gradescope connector coverage"
```

- [ ] **Step 7: Manual real-browser smoke gate**

With the freshly built temporary Firefox extension:
1. Confirm the new extension version and both Canvas/Gradescope tab indicators.
2. Sign into Gradescope normally in Firefox.
3. Discover student courses.
4. Enable at least one real course.
5. Sync Gradescope.
6. Compare at least one assignment with each available state against Gradescope for title, release date, due date, late due date, source status, numeric grade/max, and source link.
7. Confirm submitted/graded items disappear from Upcoming but remain in Calendar/All Assignments.
8. Test no-Gradescope-tab and signed-out behavior.
9. Confirm prior known data remains after a forced failed refresh.

Do not claim Milestone 3 complete until this real-browser smoke is reported successful.

- [ ] **Step 8: Whole-branch review**

Use the Superpowers requesting-code-review workflow against the approved spec + this plan. Resolve correctness/security findings before branch integration.

- [ ] **Step 9: Finish the development branch**

Use `superpowers:finishing-a-development-branch` and present the integration choices only after fresh full verification is green.
