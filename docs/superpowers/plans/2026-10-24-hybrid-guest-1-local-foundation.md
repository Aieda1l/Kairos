# Hybrid Guest Local Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a strict local guest data model, real browser persistence, backup primitives and account-free assignment views.

**Architecture:** Pure schemas/reducers back a typed IndexedDB store; public guest composition consumes snapshots and never mounts hosted providers.

**Tech Stack:** Existing TypeScript/Zod/React, native IndexedDB, Vitest and Playwright; no new dependency.

**Spec:** [Approved design](../specs/2026-10-24-hybrid-local-guest-mode-design.md). **Contracts/dependencies:** [Parent plan](2026-10-24-hybrid-local-guest-mode.md).

## Global Constraints

- Inherit the parent plan's fixed contracts; snapshots/backups expose no secret, capability, lease or pending request.
- Identity is connection ID + external ID; source statuses and Gradescope metadata use strictly newer timestamps.
- Limits: 10,000 assignments/statuses, 1,000 courses, 8 MiB dataset, 10 MiB import; reject atomically.
- Guest flag default false; no session/D1 access for guest view rendering and no change to hosted API authorization.

## Review Focus

Native atomicity/late-writer/reset tests are mandatory; a memory store fake cannot prove IndexedDB correctness. Same-origin guest/account isolation belongs to F4 and A2. Import must never merge guessed provider identities.

### F1: Freeze browser-safe domain and source DTO contracts

**Files:** Create `src/lib/guest/{types,schema,errors,projection}.ts`, `src/lib/guest/sources/contracts.ts`, `tests/helpers/guest-fixtures.ts`; test `tests/unit/guest-schema.test.ts`, `guest-source-contracts.test.ts`.

**Interfaces:** Produce the parent contracts, `parseGuestSnapshot(value:unknown):GuestSnapshot`, `projectGuestAssignments(snapshot:GuestSnapshot):Assignment[]`, strict version-1 Canvas/Ed request/response schemas. `guestSnapshotFixture(overrides?:Partial<GuestSnapshot>):GuestSnapshot` and deterministic `guestUuid(index:number):string` are test-only helpers.

- [ ] **Step 1 — Write RED schema/projection tests.** Assert connection provenance, status joining and bounded graph validation:
  ```ts
  const {assignmentId,...expectedStatus}=snapshot.statuses[0];
  expect(projectGuestAssignments(snapshot)[0].submissionStatus).toEqual(expectedStatus);
  expect(() => parseGuestSnapshot({...snapshot,statuses:[{...snapshot.statuses[0],assignmentId:guestUuid(999)}]})).toThrow();
  expect(() => guestCanvasFeedRequestSchema.parse({...validFeed,userId:"foreign"})).toThrow();
  expect(() => guestEdLessonsRequestSchema.parse({...validEd,courseId:"1/../2"})).toThrow();
  ```
  Pin 4096/4097 secret characters, 32/33 decimal digits, duplicate local IDs and dangling course/status references; no schema should read browser globals on import.
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/unit/guest-schema.test.ts tests/unit/guest-source-contracts.test.ts`; expect missing contract/behavior failures.
- [ ] **Step 3 — Implement contracts.** Use existing normalized/domain/protocol types. Define `GuestSafeCode`/fixed copy and discriminated commit inputs once. Strictly validate UTC dates, IANA timezone, source/connection references, supported output URLs and byte/count limits; source DTOs contain no local/account identity or raw upstream profile data.
- [ ] **Step 4 — Verify GREEN.** Run the same command and `npm run typecheck`; expect all new assertions and existing public type contracts to pass.
- [ ] **Step 5 — Commit.** `git add src/lib/guest tests/helpers/guest-fixtures.ts tests/unit/guest-schema.test.ts tests/unit/guest-source-contracts.test.ts` then `git commit -m "feat: define guest data and source contracts"`.

### F2: Preserve source merge semantics and credential-free backup primitives

**Files:** Create `src/lib/guest/merge.ts`, `backup.ts`; test `tests/unit/guest-merge.test.ts`, `guest-backup.test.ts`.

**Interfaces:** Consume F1. Produce `mergeGuestCourseResult(snapshot:GuestSnapshot,result:GuestCourseResult,at:string,uuid:()=>string):GuestSnapshot`, `serializeGuestBackup(snapshot:GuestSnapshot,exportedAt:string):string`, `parseGuestBackup(text:string):GuestBackupV1`. `GuestCourseResult` contains connection ID/generation, stage, external course ID/null, checkedAt, normalized assignments, validated status writes, success/error and failed count. Backup is an explicit allowlisted noncredential projection.

- [ ] **Step 1 — Write RED merge/backup tests.** Pin:
  ```ts
  expect(second.assignments[0].id).toBe(first.assignments[0].id);
  expect(second.assignments[0].firstSeenAt).toBe(first.assignments[0].firstSeenAt);
  expect(mergeGuestCourseResult(first,olderResult,at,uuid).statuses).toEqual(first.statuses);
  expect(mergeGuestCourseResult(first,failedResult,at,uuid).assignments).toEqual(first.assignments);
  expect(parseGuestBackup(serializeGuestBackup(first,at)).schemaVersion).toBe(1);
  ```
  Also assert omitted rows retained, successful empty course freshness, failed siblings retained, Gradescope metadata first-wins, foreign/duplicate members rejected, credential/internal fields excluded structurally, unsupported versions/references/oversized imports rejected.
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/unit/guest-merge.test.ts tests/unit/guest-backup.test.ts`; expect the new semantics to fail before implementation.
- [ ] **Step 3 — Implement pure functions.** Generate IDs only for new identities; retain all normalized fields. Separate attemptedAt from successfulAt. Import is replacement input, not a title/date/source-kind merge. Preserve source-specific Ed progress and Canvas date-only values by reusing normalized inputs.
- [ ] **Step 4 — Verify GREEN.** Run the same tests, `npm test -- tests/integration/assignment-repository.test.ts tests/integration/gradescope-sync-service.test.ts` and `npm run typecheck`; do not change hosted merge behavior.
- [ ] **Step 5 — Commit.** Stage only F2 files and commit `feat: add guest merge and backup rules`.

### F3: Implement transactional IndexedDB storage and local lease/request fences

**Files:** Create `src/lib/guest/{store,indexeddb,store-data,store-runs}.ts`; test `tests/e2e/guest-storage.spec.ts`, `guest-concurrency.spec.ts`, browser-only `tests/e2e/fixtures/guest-store-harness.ts`; modify `playwright.config.ts`, `vite.config.ts` for explicit guest test selection and loopback-only test flag.

**Interfaces:** `openGuestStore(options?:{name?:string;uuid?:()=>string}):Promise<GuestStore>` implements the parent port. Version-1 stores: metadata, connections, courses, assignments, statuses, syncStates, preferences, credentials, requests. Unique indexes enforce connection kind and connection+external identity. `requests` stores bounded registration membership/consume-once state; it is internal and excluded from snapshots/backup.

- [ ] **Step 1 — Write RED native-browser tests.** Load the test-only harness via Vite's dev module URL from the public root; it imports the actual store and is never imported by product code. Assert reload persistence, exactly one winner from simultaneous beginRun calls, 30-second expiry takeover with larger generation, impossible-future/clock-rollback lease cannot cause permanent busy, stale release cannot clear the winner, commit after disconnect/reset/import returns discarded, and duplicate request commit is consumed once. Verify same-source credential re-entry/forget advances generation without losing coursework, and a failed credential test changes no accepted data. Inject a quota/put error between mutations and assert the original dataset survives in every store.
  Core assertions for `native guest transactions fence stale writers`:
  ```ts
  expect(acquisitions.filter(Boolean)).toHaveLength(1);
  expect(staleCommit.status).toBe("discarded");
  expect(afterQuotaAbort).toEqual(beforeQuotaAbort);
  expect(afterOldRelease.lease.runId).toBe(newOwner.runId);
  ```
- [ ] **Step 2 — Verify RED.** Add both new spec names to both Chromium/Firefox regexes. Run `npx playwright test tests/e2e/guest-storage.spec.ts tests/e2e/guest-concurrency.spec.ts --project=chromium --project=firefox`; expect missing implementation failures, not zero selected tests.
- [ ] **Step 3 — Implement the real store.** One read/write transaction rechecks dataset/run/connection/request identity, current lease and deadline, applies merge, consumes the request and saves outcomes. Never await network/crypto outside IDB requests inside that transaction. Acquisition increments run generation; renewals preserve identity and update only expiry. Request fences compare immutable identity, not an old copied renewal timestamp. Expired or impossible-future leases cannot create permanent busy state; superseding advances the generation. Replace/reset uses a new dataset instance, clears credentials/requests and remaps connection references atomically. Broadcast is notification only; transaction checks are authoritative.
- [ ] **Step 4 — Verify GREEN.** Run the same native tests and F1/F2 tests. Verify the harness is absent from production imports/build graph and no test endpoint/backdoor was added.
- [ ] **Step 5 — Commit.** Stage F3 files only; commit `feat: persist guest data with fenced browser transactions`.

### F4: Add default-off account-free guest views and composition seams

**Files:** Create `src/lib/guest/feature.ts`, `src/features/guest/{guest-provider,guest-shell,guest-views}.tsx`, `src/app/guest/{layout,page}.tsx` and page files under `upcoming`, `calendar`, `assignments`, `sources`, `settings`; modify `src/features/assignments/{assignment-table,assignment-explorer}.tsx`, `src/app/page.tsx`, `wrangler.jsonc`, test fixture binding in `vite.config.ts`; test `tests/component/guest-views.test.tsx`, `guest-provider.test.tsx`, `tests/e2e/guest-views.spec.ts` and existing assignment/public-page tests.

**Interfaces:** `isGuestEnabled(env:Record<string,unknown>):boolean` accepts only string `true`. `GuestProvider({children,storeFactory?})` hydrates/subscribes to the F3 store with loading/error/ready states; `useGuest()` exposes snapshot and typed actions, not remembered secrets in rendering data. `AssignmentTable` gains optional controlled `filters/onFiltersChange/sort/onSortChange`; `AssignmentExplorer` gains optional `syncControls/sourcesHref/filters/onFiltersChange`, retaining all hosted defaults.

- [ ] **Step 1 — Write RED public/component tests.** Mock session/D1 resolvers to throw if a guest view touches them. Assert disabled flag/no CTA, enabled guest entry without session, correct `/guest/*` links, local timezone/filter persistence, honest storage error and no hosted controls/sign-out. Assert existing hosted rendering still uses its default controls/links.
  Core assertions for `guest views do not enter account runtime`:
  ```ts
  expect(sessionResolver).not.toHaveBeenCalled();
  expect(d1Resolver).not.toHaveBeenCalled();
  expect(screen.getByText("Saved in this browser")).toBeVisible();
  expect(isGuestEnabled({KAIROS_GUEST_ENABLED:"false"})).toBe(false);
  ```
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/component/guest-views.test.tsx tests/component/guest-provider.test.tsx tests/component/assignment-table.test.tsx tests/component/public-pages.test.tsx`. Run `npx playwright test tests/e2e/guest-views.spec.ts --project=chromium --project=firefox`.
- [ ] **Step 3 — Implement composition.** Guest reads call only the local store. Feature resolution reads Worker configuration but not session/D1. Default base/production flag false; only guarded E2E fixture config enables it. Render `Saved in this browser`, optional account link and local Upcoming/Calendar/Assignments. Sources/settings placeholders link to the coming Part 3 controls without claiming live completion. Reuse actual presentational components; no `router.refresh()` after local writes.
- [ ] **Step 4 — Verify GREEN.** Repeat focused checks, F3 browser checks affected by route composition, `npm run typecheck`, `npm run lint`, `npm run build:vinext`, `npm run verify:hosted`. Expect hosted defaults and disabled production behavior intact.
- [ ] **Step 5 — Commit.** Stage only F4 files; commit `feat: add account-free guest dashboard views`.
