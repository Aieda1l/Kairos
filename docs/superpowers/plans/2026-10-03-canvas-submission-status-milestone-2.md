# Canvas Submission Status Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firefox-first Canvas submission-status synchronization to Kairos while keeping Canvas iCal as the deadline authority and keeping UW credentials/cookies entirely outside Kairos.

**Architecture:** Keep submission state in separate SQLite tables and expose it as a nested read model on assignments. A client-side Kairos provider starts a server-issued sync request, sends server-derived Canvas assignment identifiers through a narrow Firefox WebExtension bridge, posts normalized results back to Kairos for validation/persistence, and refreshes server-rendered assignment views. The Firefox extension uses an already-signed-in `canvas.uw.edu` tab for same-origin assignment-page requests and never exports cookies, page HTML, or authorization material.

**Tech Stack:** Next.js 16, React 19, TypeScript, SQLite/`better-sqlite3`, Zod, Firefox Manifest V3 WebExtensions, esbuild, Vitest/jsdom, React Testing Library, Playwright (Chromium for existing onboarding plus Firefox for the submission-status browser flow).

**Spec:** `docs/superpowers/specs/2026-10-03-canvas-submission-status-design.md`

## Global Constraints

- Canvas iCal remains the authoritative source for assignment deadlines.
- Firefox is the only browser-extension target in Milestone 2; Chromium support is deferred.
- The unpacked extension must work from `extension/firefox/manifest.json` after `npm run build:extension`.
- Kairos never asks for, stores, receives, or logs UW credentials, Canvas cookies, or authorization headers.
- The extension must not request the `cookies` permission, browsing-history permission, downloads permission, `<all_urls>`, or unrelated host access.
- Extension Canvas fetches are constructed only as `https://canvas.uw.edu/courses/<courseId>/assignments/<assignmentId>`.
- The Kairos page bridge activates only on exact origins `http://localhost:3000` and `http://127.0.0.1:3000`.
- Every cross-boundary message is protocol version 1 and schema-validated.
- One extension message contains at most 100 assignments; larger logical refreshes are split into sequential chunks.
- Canvas assignment-page requests use a fixed concurrency limit of 4.
- Automatic submission-status refresh is enabled by default and fires once per page load only when the last successful refresh is at least 15 minutes old.
- Manual `Sync submission status` remains available and bypasses the 15-minute freshness check.
- Primary states are `unknown | not_submitted | submitted | graded | excused`; `isLate` and `isMissing` remain independent flags.
- Absence of a submitted signal must never be interpreted as `not_submitted`.
- Failed lookups preserve the last successful per-assignment status.
- A status refresh advances `last_successful_at` only when at least one assignment was successfully checked; successful-but-partial runs record `PARTIAL_SYNC`.
- No periodic background timer is introduced in Milestone 2.
- Existing commands `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`, and `npm run build` must remain green before merge.

## Review Focus

- **Malformed or hostile assignment locator data:** a Canvas record with missing/non-numeric IDs or a misleading source URL must be skipped; the extension must still construct only the hard-coded `canvas.uw.edu` URL. Covered in Task 1 locator tests and Task 4 URL-construction tests.
- **Out-of-order completion from multiple Kairos tabs:** a result with an older `checkedAt` must not overwrite a newer persisted status. Covered in Task 2 repository tests.
- **Expired Canvas session / SSO redirect:** the extension must return `CANVAS_SIGNED_OUT`, preserve existing statuses, and never post login-page HTML back to Kairos. Covered in Task 4 fetcher tests and Task 3 completion tests.
- **Conflicting Canvas markup:** pages containing contradictory submitted/not-submitted or incompatible status signals must return `unknown` with an extractor error and preserve the previous known status. Covered in Task 4 extractor tests and Task 2 persistence tests.
- **Duplicate React effects / multiple automatic triggers:** development Strict Mode or rerenders must not start more than one automatic refresh per page load. Covered in Task 5 provider tests.

---

## File Structure

```text
src/
  app/
    (dashboard)/
      layout.tsx
      settings/page.tsx
    api/
      sources/canvas/submission-status/
        start/route.ts
        complete/route.ts
  features/
    submission-status/
      extension-bridge.ts
      submission-status-provider.tsx
      submission-status-control.tsx
      submission-status-badge.tsx
  lib/
    extension-protocol/
      submission-status.ts
    submission-status/
      types.ts
      canvas-locator.ts
      request-registry.ts
      sync-service.ts
    db/
      migrate.ts
      repositories/
        assignments.ts
        submission-status.ts

extension/
  firefox/
    manifest.json
    popup.html
    src/
      background.ts
      background/
        broker.ts
      canvas/
        extract-status.ts
        fetch-statuses.ts
      content/
        kairos-bridge.ts
        canvas.ts
      popup.ts
    tests/
      canvas-extractor.test.ts
      canvas-fetcher.test.ts
      broker.test.ts
      manifest.test.ts
  dist/                           generated, gitignored

scripts/
  build-firefox-extension.mjs

tests/
  fixtures/
    canvas-submission-pages/
      submitted.html
      not-submitted.html
      graded.html
      excused.html
      late.html
      missing.html
      ambiguous.html
      signed-out.html
  unit/
    canvas-submission-locator.test.ts
    extension-protocol.test.ts
    submission-status-staleness.test.ts
  integration/
    submission-status-repository.test.ts
    submission-status-api-routes.test.ts
  component/
    submission-status-provider.test.tsx
    submission-status-ui.test.tsx
  e2e/
    submission-status.spec.ts
```

Generated extension output lives at `extension/firefox/dist/` and is not committed. The unpacked extension root remains `extension/firefox/`; its manifest points at generated files under `dist/`.

---

### Task 1: Shared submission model, protocol schemas, and Canvas locator derivation

**Files:**
- Create: `src/lib/submission-status/types.ts`
- Create: `src/lib/submission-status/canvas-locator.ts`
- Create: `src/lib/extension-protocol/submission-status.ts`
- Test: `tests/unit/canvas-submission-locator.test.ts`
- Test: `tests/unit/extension-protocol.test.ts`

**Interfaces:**
- Produces `SubmissionState = "unknown" | "not_submitted" | "submitted" | "graded" | "excused"`.
- Produces `AssignmentSubmissionStatus = { state: SubmissionState; isLate: boolean; isMissing: boolean; submittedAt: string | null; checkedAt: string; extractorVersion: string }`.
- Produces `SubmissionStatusSyncState = { lastAttemptedAt: string | null; lastSuccessfulAt: string | null; lastErrorCode: SubmissionSyncErrorCode | null; updatedCount: number; failedCount: number }`.
- Produces `CanvasAssignmentLocator = { assignmentLocalId: string; courseId: string; assignmentId: string }`.
- Produces `parseCanvasAssignmentLocator(assignment: Pick<Assignment, "id" | "source" | "courseId" | "sourceUrl">): CanvasAssignmentLocator | null`.
- Produces protocol constants/schemas/types for page↔extension and background↔Canvas messages, including `SubmissionSyncRequestV1`, `SubmissionStatusResultV1`, `KairosBridgeRequestV1`, `KairosBridgeResponseV1`, and stable `SubmissionSyncErrorCode` values.
- All sync-batch schemas enforce `protocolVersion: 1`, decimal-only `courseId`/`assignmentId`, and at most 100 assignments.

- [ ] **Step 1: Write failing locator and protocol tests**

Locator assertions:

```ts
expect(parseCanvasAssignmentLocator({
  id: "local-1",
  source: "canvas",
  courseId: "999",
  sourceUrl: "http://127.0.0.1:3000/courses/999/assignments/4242"
})).toEqual({assignmentLocalId:"local-1", courseId:"999", assignmentId:"4242"});

expect(parseCanvasAssignmentLocator({
  id: "bad",
  source: "canvas",
  courseId: "abc",
  sourceUrl: "https://evil.example/courses/abc/assignments/1"
})).toBeNull();
```

Also assert a path course ID that disagrees with stored `courseId` returns `null`, non-Canvas assignments return `null`, query/hash noise cannot create a locator unless a valid assignment ID is present, a 101-item protocol batch is rejected, non-decimal identifiers are rejected, and payloads containing arbitrary `url`, cookie, header, or HTML fields are rejected by strict schemas.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/unit/canvas-submission-locator.test.ts tests/unit/extension-protocol.test.ts`

Expected: FAIL because the model/protocol/locator modules do not exist.

- [ ] **Step 3: Implement the shared types and strict Zod schemas**

Use `z.object(...).strict()` at every external message boundary. Define these stable sync error codes at minimum:

```text
EXTENSION_UNAVAILABLE
EXTENSION_TIMEOUT
CANVAS_TAB_UNAVAILABLE
CANVAS_SIGNED_OUT
CANVAS_NETWORK_ERROR
UNRECOGNIZED_STATUS
PARTIAL_SYNC
INVALID_RESULT
```

The locator may extract the assignment ID from a direct `/courses/<course>/assignments/<assignment>` path or Canvas `#assignment_<id>` fragment, but it returns only numeric IDs; it never returns or forwards the source URL.

- [ ] **Step 4: Run the locator/protocol tests**

Run: `npm test -- tests/unit/canvas-submission-locator.test.ts tests/unit/extension-protocol.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/submission-status src/lib/extension-protocol tests/unit/canvas-submission-locator.test.ts tests/unit/extension-protocol.test.ts
git commit -m "feat: define submission status protocol"
```

---

### Task 2: Submission-status persistence and assignment read model

**Files:**
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/lib/assignments/types.ts`
- Modify: `src/lib/db/repositories/assignments.ts`
- Create: `src/lib/db/repositories/submission-status.ts`
- Modify: `tests/integration/db-schema.test.ts`
- Modify: `tests/integration/assignment-repository.test.ts`
- Test: `tests/integration/submission-status-repository.test.ts`

**Interfaces:**
- Extends `Assignment` with `submissionStatus: AssignmentSubmissionStatus | null`; the existing iCal `status` field remains unchanged for source compatibility and is no longer used as the Canvas submission-status UI.
- Produces `SubmissionStatusRepository.getSyncState(sourceConnectionId: string): SubmissionStatusSyncState`.
- Produces `SubmissionStatusRepository.markAttempt(sourceConnectionId: string, attemptedAt: string): void`.
- Produces `SubmissionStatusRepository.applyCompletion(sourceConnectionId: string, results: SubmissionStatusResultV1[], failedCount: number, errorCode: SubmissionSyncErrorCode | null, completedAt: string): { updated: number; ignoredStale: number }`.
- `AssignmentRepository.list()` LEFT JOINs the latest `assignment_submission_status` record and returns the nested `submissionStatus`.

- [ ] **Step 1: Write failing schema/repository tests**

Assert migration adds:

```text
assignment_submission_status
  assignment_id PK/FK
  state
  is_late
  is_missing
  submitted_at
  checked_at
  extractor_version
  updated_at

submission_status_sync
  source_connection_id PK/FK
  last_attempted_at
  last_successful_at
  last_error_code
  updated_count
  failed_count
  updated_at
```

Repository assertions:

- a successful `submitted` result is readable through `AssignmentRepository.list()[0].submissionStatus`;
- a later `graded` result replaces it;
- an older `checkedAt` result is ignored and cannot overwrite the newer value;
- a result with `errorCode` does not overwrite the last successful assignment status;
- a successful `unknown` result without `errorCode` is persisted as a checked-but-unavailable status;
- successful results plus failures advance `lastSuccessfulAt`, set counts, and record `PARTIAL_SYNC`;
- zero successful results leave the previous `lastSuccessfulAt` unchanged;
- deleting an assignment cascades its submission-status row.

- [ ] **Step 2: Run persistence tests and verify they fail**

Run: `npm test -- tests/integration/db-schema.test.ts tests/integration/assignment-repository.test.ts tests/integration/submission-status-repository.test.ts`

Expected: FAIL because the new schema/repository/read model does not exist.

- [ ] **Step 3: Implement the migration and repository transaction**

Use one transaction in `applyCompletion()`. Upsert only results without `errorCode`; compare ISO timestamps before replacing an existing status and count older results as `ignoredStale`. Update `last_attempted_at` only in `markAttempt()`. In `applyCompletion()`, advance `last_successful_at` only when at least one successful result was accepted or found newer/equal; preserve the previous successful timestamp on total failure.

- [ ] **Step 4: Update existing assignment fixtures/tests for the nested read model**

Add `submissionStatus: null` to manually constructed `Assignment` values in unit/component tests that require the strict `Assignment` type. Do not change iCal normalization to write submission state.

- [ ] **Step 5: Run persistence/regression tests**

Run: `npm test -- tests/integration/db-schema.test.ts tests/integration/assignment-repository.test.ts tests/integration/submission-status-repository.test.ts tests/unit/normalize.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db src/lib/assignments/types.ts tests
git commit -m "feat: persist Canvas submission status"
```

---

### Task 3: Server-issued submission sync start/complete flow

**Files:**
- Create: `src/lib/submission-status/request-registry.ts`
- Create: `src/lib/submission-status/sync-service.ts`
- Create: `src/app/api/sources/canvas/submission-status/start/route.ts`
- Create: `src/app/api/sources/canvas/submission-status/complete/route.ts`
- Test: `tests/integration/submission-status-api-routes.test.ts`

**Interfaces:**
- Produces `SubmissionSyncRequestRegistry` with `register(requestId, connectionId, locators, startedAt)` and `consume(requestId)`; registry entries expire after 10 minutes and are process-local only.
- Produces `startCanvasSubmissionStatusSync(db, now?: Date): { requestId: string; assignments: CanvasAssignmentLocator[]; maxBatchSize: 100 }`.
- Produces `SubmissionSyncCompleteInput = { requestId: string; results: SubmissionStatusResultV1[]; batchErrorCode?: SubmissionSyncErrorCode | null }`.
- Produces `completeCanvasSubmissionStatusSync(db, input: SubmissionSyncCompleteInput, now?: Date): SubmissionSyncCompleteResponse`.
- `POST /api/sources/canvas/submission-status/start` returns the start response and marks `last_attempted_at`.
- `POST /api/sources/canvas/submission-status/complete` consumes the request, validates every returned identity against the exact registered locator set, persists valid successful results, records failures/error state, and returns updated counts/sync timestamps.

- [ ] **Step 1: Write failing start/complete route tests**

Assert:

- start without a Canvas connection returns a stable configuration error;
- start derives locators from all imported Canvas assignments with valid numeric IDs and excludes invalid/non-Canvas rows;
- start marks `lastAttemptedAt`;
- complete rejects an unknown/expired `requestId`;
- complete rejects a local ID/course ID/assignment ID tuple that differs from the registered request;
- complete rejects duplicate returned identities;
- complete with one success + one failed result persists only the success, reports partial, and advances `lastSuccessfulAt`;
- complete with `CANVAS_SIGNED_OUT` and no successful results preserves prior assignment statuses and prior `lastSuccessfulAt`;
- complete with contradictory/parse-error result carrying `UNRECOGNIZED_STATUS` preserves the prior known status;
- consuming the same request twice is rejected.

- [ ] **Step 2: Run API/service tests and verify they fail**

Run: `npm test -- tests/integration/submission-status-api-routes.test.ts`

Expected: FAIL because the registry/service/routes do not exist.

- [ ] **Step 3: Implement the request registry and sync service**

Generate `requestId` with `crypto.randomUUID()`. Register the exact locator list returned by start. The completion service must derive `failedCount` from explicit failed/error results plus any requested assignment omitted from the response; it must never accept a result that was not part of the registered request.

Use stable HTTP behavior:

```text
404/409  Canvas not connected / no active request
400      invalid protocol/result payload
200      complete, including successful partial runs
```

Return user-safe error codes/messages only.

- [ ] **Step 4: Implement thin Zod-validated route handlers**

Routes must not log request bodies or returned Canvas data. They call the service and serialize only normalized identifiers/status metadata.

- [ ] **Step 5: Run route/persistence/security tests**

Run: `npm test -- tests/integration/submission-status-api-routes.test.ts tests/integration/submission-status-repository.test.ts tests/integration/secret-exposure.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/submission-status src/app/api/sources/canvas/submission-status tests/integration
git commit -m "feat: add submission status sync API"
```

---

### Task 4: Firefox WebExtension build, Canvas extraction, and background broker

**Files:**
- Create: `extension/firefox/manifest.json`
- Create: `extension/firefox/popup.html`
- Create: `extension/firefox/src/background.ts`
- Create: `extension/firefox/src/background/broker.ts`
- Create: `extension/firefox/src/canvas/extract-status.ts`
- Create: `extension/firefox/src/canvas/fetch-statuses.ts`
- Create: `extension/firefox/src/content/canvas.ts`
- Create: `extension/firefox/src/content/kairos-bridge.ts`
- Create: `extension/firefox/src/popup.ts`
- Create: `scripts/build-firefox-extension.mjs`
- Create: `extension/firefox/tests/canvas-extractor.test.ts`
- Create: `extension/firefox/tests/canvas-fetcher.test.ts`
- Create: `extension/firefox/tests/broker.test.ts`
- Create: `extension/firefox/tests/manifest.test.ts`
- Create: `tests/fixtures/canvas-submission-pages/*.html`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces `CANVAS_EXTRACTOR_VERSION = "canvas-html-v1"`.
- Produces `extractCanvasSubmissionStatus(html: string, finalUrl: string, checkedAt: string): ExtractedCanvasSubmissionStatus`.
- Produces `fetchCanvasSubmissionStatuses(assignments: CanvasAssignmentLocator[], fetchImpl?: typeof fetch, now?: () => Date): Promise<CanvasBatchResultV1>`; requests use `credentials: "include"`, `redirect: "follow"`, and concurrency 4.
- Produces a background `handleBridgeRequest(message, browserAdapter)` function that can be unit-tested without real browser globals.
- Produces browser entrypoints bundled to `extension/firefox/dist/background.js`, `kairos-bridge.js`, `canvas-content.js`, and `popup.js`.
- Adds `npm run build:extension`; changes `npm run build` to run the extension build before `next build`.

- [ ] **Step 1: Make extension tests collectible, then add failing Canvas HTML fixtures/extractor tests**

Extend `vitest.config.ts` test includes with `extension/firefox/tests/**/*.test.ts` before the first extension test run. Then add fixture expectations:

```text
submitted.html       -> submitted
not-submitted.html   -> not_submitted
graded.html          -> graded
excused.html         -> excused
late.html            -> submitted + isLate
missing.html         -> not_submitted + isMissing
ambiguous.html       -> unknown + UNRECOGNIZED_STATUS
signed-out.html      -> top-level CANVAS_SIGNED_OUT
```

Use current Canvas student-page signals already observed in Canvas itself, including `#sidebar_content .details` / `.header` text such as `Submitted!` and `Not Submitted!`, plus explicit grade/excused/status regions. Do not infer `not_submitted` merely because `Submitted!` is missing.

- [ ] **Step 2: Add failing fetcher/broker/manifest tests**

Assert:

- fetch URLs are exactly `https://canvas.uw.edu/courses/999/assignments/4242` for locator `999/4242`;
- at most 4 fetches are concurrently pending;
- 401/403, network errors, and login/SSO responses become stable error results without HTML in the returned payload;
- one assignment fetch failure does not abort other assignments;
- background broker returns `CANVAS_TAB_UNAVAILABLE` when no Canvas tab exists;
- background broker forwards only validated runtime messages to a matching Canvas tab;
- manifest host permissions are limited to Canvas plus localhost/127.0.0.1 bridge hosts;
- manifest contains no `cookies`, history, downloads, or `<all_urls>` permission.

- [ ] **Step 3: Run extension tests and verify they fail**

Run: `npm test -- extension/firefox/tests`

Expected: FAIL because the extension modules/build do not exist and Vitest does not yet collect extension tests.

- [ ] **Step 4: Implement the pure extractor/fetcher/broker modules**

Extraction precedence is exactly:

```text
excused > graded > submitted > not_submitted > unknown
```

Conflicting explicit signals return `unknown` plus `UNRECOGNIZED_STATUS`. A clean `unknown` without an error is reserved for a page that was successfully fetched and clearly has no trustworthy student submission status.

- [ ] **Step 5: Implement Firefox entrypoints and manifest**

`kairos-bridge.ts`:

- activates only when `location.origin` is exactly `http://localhost:3000` or `http://127.0.0.1:3000`;
- listens for protocol-v1 `window.postMessage` requests from the same window/origin;
- validates them, calls `browser.runtime.sendMessage`, validates the response, then posts only the normalized response back.

`canvas.ts`:

- runs only on `https://canvas.uw.edu/*`;
- accepts only validated Canvas runtime batch messages;
- calls the pure fetcher;
- returns normalized records only.

`background.ts`:

- handles ping/diagnostic requests;
- locates a `canvas.uw.edu` tab using the browser adapter;
- forwards batch work to that tab.

`popup.ts` shows extension version and Canvas-tab detected/unavailable. It contains no sync button.

- [ ] **Step 6: Implement the esbuild script and package scripts**

Add dev dependencies `esbuild` and `@types/firefox-webext-browser`. Keep the extension-test Vitest include added in Step 1. Ignore `extension/firefox/dist/`.

Run: `npm run build:extension`

Expected: manifest-referenced JS files exist under `extension/firefox/dist/`.

- [ ] **Step 7: Run extension tests/build/static checks**

Run: `npm test -- extension/firefox/tests && npm run build:extension && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add extension scripts package.json vitest.config.ts .gitignore tests/fixtures/canvas-submission-pages
git commit -m "feat: add Firefox Canvas status extension"
```

---

### Task 5: Kairos extension bridge and automatic/manual synchronization provider

**Files:**
- Create: `src/features/submission-status/extension-bridge.ts`
- Create: `src/features/submission-status/submission-status-provider.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`
- Create: `tests/unit/submission-status-staleness.test.ts`
- Create: `tests/component/submission-status-provider.test.tsx`

**Interfaces:**
- Produces `isSubmissionStatusStale(lastSuccessfulAt: string | null, now: Date): boolean` with a 15-minute threshold.
- Produces `pingKairosExtension(timeoutMs?: number): Promise<ExtensionDiagnostic>`; default ping timeout 750 ms.
- Produces `syncExtensionBatch(request: SubmissionSyncRequestV1, timeoutMs?: number): Promise<CanvasBatchResultV1>`; default batch timeout 30 seconds.
- Produces `SubmissionStatusProvider` and `useSubmissionStatusSync()`.
- Context exposes `{ phase, extensionDetected, lastSuccessfulAt, updatedCount, failedCount, message, syncNow }`, where `phase` is `idle | syncing | success | partial | error`.

- [ ] **Step 1: Write failing staleness/provider tests**

Assert:

- `null` is stale;
- 14m59s old is fresh;
- exactly 15m old is stale;
- provider pings the extension on mount;
- provider automatically starts one sync when stale and `enabled=true`;
- rerendering / React effect replay still starts only one automatic sync per mounted page load;
- a fresh state does not auto-sync;
- `syncNow()` always starts regardless of freshness;
- 205 assignments from the start API produce extension chunks of 100, 100, and 5, sequentially;
- extension timeout records `EXTENSION_TIMEOUT` through the complete API;
- extension unavailable records `EXTENSION_UNAVAILABLE`;
- Canvas-tab unavailable / signed-out errors preserve prior success state while surfacing actionable context;
- after a successful/partial completion, `router.refresh()` runs once.

- [ ] **Step 2: Run provider tests and verify they fail**

Run: `npm test -- tests/unit/submission-status-staleness.test.ts tests/component/submission-status-provider.test.tsx`

Expected: FAIL because the bridge/provider does not exist.

- [ ] **Step 3: Implement the page bridge client**

Use `window.postMessage` only with `window.location.origin` as `targetOrigin`. Correlate every response by `requestId`, validate it with the shared Zod schema, and remove listeners/timeouts after resolve/reject.

Do not put credentials, Canvas HTML, or arbitrary URLs into any page message.

- [ ] **Step 4: Implement provider orchestration**

For one logical sync:

1. POST `/api/sources/canvas/submission-status/start`;
2. split returned assignments into sequential chunks of at most 100;
3. send each chunk through the extension bridge;
4. collect normalized results/errors;
5. POST one `complete` payload using the server-issued `requestId`;
6. update context state and call `router.refresh()`.

Use a `useRef` guard for the once-per-page-load automatic trigger. Do not add intervals, alarms, or retries.

- [ ] **Step 5: Wire the provider into the dashboard layout**

In the server layout, migrate the DB, read the Canvas connection and submission sync state, and determine whether at least one imported Canvas assignment has a valid locator. Pass `enabled={Boolean(connection && hasEligibleAssignment)}` plus the initial sync state into the client provider, then wrap `AppShell`.

- [ ] **Step 6: Run provider/regression tests**

Run: `npm test -- tests/unit/submission-status-staleness.test.ts tests/component/submission-status-provider.test.tsx tests/component/app-shell.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/submission-status src/app/'(dashboard)'/layout.tsx tests/unit/submission-status-staleness.test.ts tests/component/submission-status-provider.test.tsx
git commit -m "feat: auto-sync Canvas submission status"
```

---

### Task 6: Submission-status controls, badges, assignment views, and Settings

**Files:**
- Create: `src/features/submission-status/submission-status-badge.tsx`
- Create: `src/features/submission-status/submission-status-control.tsx`
- Modify: `src/features/assignments/assignment-row.tsx`
- Modify: `src/features/assignments/assignment-table.tsx`
- Modify: `src/features/assignments/assignment-detail-dialog.tsx`
- Modify: `src/features/assignments/assignment-explorer.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `tests/component/upcoming.test.tsx`
- Modify: `tests/component/assignment-table.test.tsx`
- Modify: `tests/component/assignment-detail.test.tsx`
- Modify: `tests/component/settings.test.tsx`
- Create: `tests/component/submission-status-ui.test.tsx`

**Interfaces:**
- Produces `SubmissionStatusBadge({ status }: { status: AssignmentSubmissionStatus | null })`.
- Produces `SubmissionStatusControl()`, backed by `useSubmissionStatusSync()`.
- UI mapping is exact:
  - null or `unknown` → `Status unavailable`
  - `not_submitted` → `Not submitted`
  - `submitted` → `Submitted`
  - `graded` → `Graded`
  - `excused` → `Excused`
  - append visible `Late` / `Missing` secondary labels independently.

- [ ] **Step 1: Write failing badge/control/settings tests**

Assert all primary labels and combinations such as `Submitted · Late` and `Not submitted · Missing`. Assert the old raw `unknown` label is not rendered as the normal Canvas status.

Control assertions:

- idle/fresh: `Canvas submissions · Updated <time>` and button `Sync submission status`;
- syncing: button disabled with `Syncing submission status…`;
- extension unavailable: `Firefox extension not detected`;
- no Canvas tab: `Open Canvas in Firefox, then try again.`;
- signed out: `Sign in to Canvas, then retry.`;
- partial: `18 of 20 submission statuses updated`;
- success updates without a modal.

Settings assertions:

```text
Submission status
Automatic refresh          On
Refresh when older than    15 minutes
Last successful refresh    <timestamp or Never>
Firefox extension          Connected / Not detected
```

The automatic-refresh row is informational in Milestone 2; it is not a toggle.

- [ ] **Step 2: Run UI tests and verify they fail**

Run: `npm test -- tests/component/submission-status-ui.test.tsx tests/component/upcoming.test.tsx tests/component/assignment-table.test.tsx tests/component/assignment-detail.test.tsx tests/component/settings.test.tsx`

Expected: FAIL because the new UI does not exist.

- [ ] **Step 3: Implement the badge/control components**

Use existing Button/Alert/Badge primitives and text labels so status is never color-only. The control must not replace the existing iCal `Sync Now`; it is a separate Canvas-submission control.

- [ ] **Step 4: Replace assignment submission display in row/table/detail**

Use `assignment.submissionStatus`, not the iCal `assignment.status`, for visible submission state. Table status sorting compares `submissionStatus?.state ?? "unknown"`. The detail dialog shows `submittedAt` / `checkedAt` only when available and useful; do not expose extractor internals.

Calendar markers remain deadline-focused, but the shared detail dialog shows submission status when opened from Calendar.

- [ ] **Step 5: Add the control to Upcoming and the diagnostics to Settings**

Place the submission control near the existing Canvas sync metadata. Keep the iCal last-sync text distinct from submission-status last-success text.

- [ ] **Step 6: Run UI/static tests**

Run: `npm test -- tests/component/submission-status-ui.test.tsx tests/component/upcoming.test.tsx tests/component/assignment-table.test.tsx tests/component/assignment-detail.test.tsx tests/component/settings.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/submission-status src/features/assignments src/app/'(dashboard)'/settings tests/component
git commit -m "feat: show Canvas submission status"
```

---

### Task 7: Firefox-oriented E2E coverage, docs, and release verification

**Files:**
- Create: `tests/e2e/submission-status.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`
- Modify: `.env.example` only if fixture configuration needs documentation
- Modify: `tests/e2e/canvas-onboarding.spec.ts` only as required for the strict `Assignment` read model or project scoping

**Interfaces:**
- Adds a Firefox Playwright project for `submission-status.spec.ts` while retaining the existing Canvas onboarding smoke test on Chromium.
- E2E uses a deterministic page-level extension bridge shim that speaks the exact shared protocol; extension extractor/background behavior remains covered by Task 4 unit tests. Live `canvas.uw.edu` and UW credentials are never CI dependencies.
- README documents build/load/use/troubleshooting for the unpacked Firefox extension and clearly identifies the manual Firefox smoke step that validates real browser-extension wiring.

- [ ] **Step 1: Write the failing Firefox submission-status E2E test**

Use the existing fixture Canvas iCal onboarding to create the assignment with course `999` / assignment `4242`. Before visiting the dashboard, inject a test bridge with `page.addInitScript()` that:

- responds to protocol-v1 ping as the Firefox extension;
- accepts only valid sync batches;
- deliberately holds the first batch response until the test has asserted the initial `Status unavailable` state;
- returns `submitted` for the known locator with no credentials/HTML fields after the test releases that response.

Then assert:

1. assignment begins with `Status unavailable`;
2. stale-on-open synchronization fires automatically;
3. badge becomes `Submitted`;
4. last-successful submission timestamp is rendered;
5. manual `Sync submission status` works;
6. a second page rerender does not create a duplicate automatic start in the same mounted page;
7. captured Kairos API/message bodies contain no `cookie`, `authorization`, UW password, or Canvas page HTML.

- [ ] **Step 2: Run the new E2E test and verify it fails**

Run: `npx playwright test tests/e2e/submission-status.spec.ts --project=firefox`

Expected: FAIL until provider/UI/config are wired.

- [ ] **Step 3: Update Playwright project scoping**

Configure:

- `chromium`: existing `canvas-onboarding.spec.ts`;
- `firefox`: `submission-status.spec.ts`.

Document `npx playwright install chromium firefox`.

- [ ] **Step 4: Update README for Firefox extension usage**

Document:

```text
npm install
npm run build:extension
npm run dev
```

Then:

1. open `about:debugging#/runtime/this-firefox`;
2. choose `Load Temporary Add-on…`;
3. select `extension/firefox/manifest.json`;
4. sign in to `https://canvas.uw.edu` and leave one Canvas tab open;
5. open `http://localhost:3000`;
6. verify the extension popup reports Canvas detected;
7. use `Sync submission status` or wait for stale-on-open refresh.

Explain that temporary add-ons must be reloaded after Firefox restarts, no password/token is requested, automatic periodic background refresh is intentionally not implemented, and Chrome support is deferred.

- [ ] **Step 5: Run the automated completion gate**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run build
git grep -nE '(cookies.*permission|<all_urls>|authorization.*:|password.*canvas|canvas\.uw\.edu.*cookie)' -- extension src tests ':!tests/fixtures/**' || true
```

Expected:

- all test/lint/typecheck/E2E/build commands PASS;
- `npm run build` also produces the Firefox extension bundle;
- grep finds no prohibited permission or committed credential-handling path (review legitimate test text if any).

- [ ] **Step 6: Perform the manual Firefox acceptance smoke**

With a real signed-in Canvas tab and a user-provided iCal-connected Kairos database:

- load the temporary extension;
- open Kairos;
- confirm extension detection;
- run manual submission sync;
- confirm at least one known submitted assignment changes from `Status unavailable` to a reliable state;
- confirm closing all Canvas tabs produces the actionable no-tab message without deleting the saved status;
- sign out of Canvas and confirm signed-out behavior preserves the saved status;
- inspect Firefox extension permissions and confirm there is no cookie/history/download/`<all_urls>` permission.

If Canvas markup for a real assignment differs from fixtures, capture only sanitized structural details needed to add a regression fixture; never commit the user's page HTML or personal course data.

- [ ] **Step 7: Commit**

```bash
git add README.md playwright.config.ts tests/e2e .env.example
git commit -m "test: verify Firefox submission status flow"
```

---

## Completion Gate

Before declaring Milestone 2 complete, verify every acceptance criterion in the design spec against the branch:

- Firefox extension loads unpacked after `npm run build:extension`;
- iCal remains the deadline source;
- stale-on-open refresh fires by default at 15 minutes and only once per page load;
- manual website refresh works;
- a signed-in open Canvas tab is sufficient;
- Canvas credentials/cookies/auth headers/page HTML never enter Kairos;
- Not submitted, Submitted, Graded, Excused, Late, Missing, and Status unavailable render correctly;
- ambiguous/conflicting extraction never guesses Not submitted;
- partial failures persist successful results and preserve previous failed-assignment statuses;
- out-of-order stale results cannot overwrite newer checks;
- extension missing, no-tab, signed-out, partial, and success states are actionable;
- Settings reports automatic refresh, threshold, last success, and extension detection;
- extension build/tests, Kairos unit/integration/component tests, Firefox-oriented E2E, lint, typecheck, and production build all pass.
