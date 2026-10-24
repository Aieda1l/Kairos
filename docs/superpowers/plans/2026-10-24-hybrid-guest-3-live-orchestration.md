# Hybrid Guest Live Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved live Canvas/Gradescope/Ed experience using the local store, existing bridge and protected transient endpoints.

**Architecture:** One coordinator owns setup, manual/automatic dispatch and local transactional commits. React renders snapshots/current-run outcomes; no hosted provider or calendar fanout is mounted.

**Tech Stack:** Existing React/TypeScript/Zod, v1 Firefox bridge, native fetch/AbortController and browser store port.

**Spec:** [Approved design](../specs/2026-10-24-hybrid-local-guest-mode-design.md). **Contracts:** [Parent plan](2026-10-24-hybrid-local-guest-mode.md). Requires F1–F4 and S1–S3.

## Global Constraints

- All three sources are required; Canvas/Ed server reads work without Firefox, while Canvas statuses/Gradescope use signed-in provider tabs.
- Guest uses no hosted source `/start`, `/complete`, `/sync`, onboarding-draft, account Sync All or calendar endpoint.
- Run deadline 180 seconds/max 100 dispatched provider reads; lease 30 seconds/renew 5; Canvas batches at most 25; Gradescope one course/batch; Ed one course/request.
- Legacy bridge waits 30 seconds without cancelling upstream. Stop further extension dispatch on timeout and apply at least 60 seconds local retry delay.
- Credentials default to memory; remembering is explicit. Every result must match current dataset/run/connection/request membership before its atomic commit.

## Review Focus

Wrong-but-valid response identities, timeout/late results, reset/disconnect, empty successful courses and old success banners must have explicit current-attempt tests. Direct helpers are reusable; hosted provider orchestration is not.

### U1: Add local request validation and typed bridge/transient clients

**Files:** Create `src/lib/guest/sync/{request-registry,bridge-reader,transient-client}.ts`; test `tests/unit/guest-request-registry.test.ts`, `tests/component/guest-bridge-reader.test.tsx`, `guest-transient-client.test.tsx`. Existing bridge/protocol/manifest files remain unchanged.

**Interfaces:** `createGuestRequestRegistry({now}):GuestRequestRegistry` exposes `register(registration):boolean`, `accept(requestId:string,value:unknown,nowMs:number):GuestValidatedRead|null` and `invalidateRun(runId:string):void`. `GuestValidatedRead` is a closed operation-tagged union of the matching F1 or v1 bridge result plus its immutable registration. `createGuestBridgeReader()` exposes `ping`, `canvas`, `gradescopeDiscover`, `gradescopeSync`, retaining the exact input/return signatures of the existing corresponding helpers. `createGuestTransientClient({fetchImpl}):GuestTransientClient` exposes `bootstrap(input:GuestSessionRequest,signal)`, `endSession(signal)`, and typed `canvasFeed`, `edCourses`, `edLessons` calls using the complete F1 bodies/results, including literal schemaVersion 1. All server requests are POST JSON, same-origin credentials, no-store and AbortSignal aware; the client never reads the HttpOnly capability value.

- [ ] **Step 1 — Write RED identity/client tests.** Pin wrong outer/nested request UUID, duplicate/unrequested Canvas local-course-assignment tuple, unrequested Gradescope course and assignment-parent mismatch, consumed/expired registration and unknown response fields. Assert safe fixed errors, matching request IDs and no secret in URL/error text. Pin GUEST_SESSION_REQUIRED versus ED_AUTH_INVALID handling; neither redirects to `/sign-in` and no source call retries automatically.
  Core assertions for `valid schema does not substitute for request membership`:
  ```ts
  expect(()=>registry.accept(requestId,wrongCourseResult,now)).toThrow();
  expect(acceptedForConsumedRequest).toBeNull();
  expect(hostedFetch).toHaveBeenCalledTimes(0);
  expect(guestRequestUrl).not.toContain(secretMarker);
  ```
- [ ] **Step 2 — Verify RED.** `npm test -- tests/unit/guest-request-registry.test.ts tests/component/guest-bridge-reader.test.tsx tests/component/guest-transient-client.test.tsx` must fail before implementation.
- [ ] **Step 3 — Implement wrappers.** Call `pingKairosExtension`, `syncExtensionBatch`, `discoverGradescopeExtension`, `syncGradescopeExtensionBatch` directly with fresh per-batch IDs. Preserve v1 strict schemas/PONG not-shared compatibility. The coordinator registers F3 storage and then memory before calling a reader. Adapters validate wire schemas; after either transport returns, the coordinator calls registry.accept once for membership/consume, then the store consumes its durable local request with mutations. Neither adapter independently consumes the memory registration. Timed-out/invalid responses never reach merge. The transient client parses F1 response/error schemas and returns fixed code/copy; it does not use hosted fetch adapters.
- [ ] **Step 4 — Verify GREEN.** Repeat new tests plus `npm test -- tests/unit/extension-bridge-timeouts.test.ts tests/component/submission-status-provider.test.tsx tests/component/gradescope-provider.test.tsx` and `npm run typecheck`.
- [ ] **Step 5 — Commit.** Stage U1 files only; commit `feat: add guest request readers and membership validation`.

### U2: Implement current-run coordinator and private credential lifetime

**Files:** Create `src/lib/guest/sync/{coordinator,source-actions}.ts`, `src/lib/guest/credentials.ts`; test `tests/unit/guest-sync-coordinator.test.ts`, `guest-credentials.test.ts`; extend `tests/e2e/guest-concurrency.spec.ts` with the real delayed-coordinator commit case.

**Interfaces:** `createGuestSyncCoordinator({store,bridge,transient,credentials,clock,uuid,pageEpoch})` exposes `run({sources?,automatic?}):Promise<GuestRunReport>`, `stop():void`, `connectCanvas(choice:GuestSecretChoice)`, `connectEd(choice:GuestSecretChoice)`, `connectGradescope()`, `restoreSecret(connectionId:string,choice:GuestSecretChoice)`, `refreshCourses(connectionId:string)` and delegates course selection/disconnect through the store. Setup actions return a fixed-code outcome and connection ID/null, not secrets. `createGuestCredentials(store)` provides get/put/forget/clear keyed by connection ID+generation; remembered values are accessed only through the store's private record.

- [ ] **Step 1 — Write RED current-run tests.** Use an injected deterministic store/clock/reader. Assert feed→status→Gradescope→Ed order, per-course commits, failed siblings retained, successful empty course freshness, later source continuation after ordinary failure, one source attempt marked before its queue, and all outcomes belong to the new run. After a mid-queue rate/run limit, a new explicit run starts with persisted unprocessed members rather than repeatedly starving later courses. Pin busy/expired/early-return outcomes rather than stale success. Defer a result, reset/disconnect/take over the lease, then resolve it and assert discarded/zero resurrection. Timeout must stop extension queuing and keep prior committed successes; 101st operation and reads after 180 seconds must not dispatch.
  Core assertions for `guest coordinator reports this run and preserves queued progress`:
  ```ts
  expect(report.outcomes.every(outcome=>outcome.runId===report.run.runId)).toBe(true);
  expect(dispatchedReads).toHaveLength(100); // no 101st operation
  expect(firstCourseOnRetry).toBe(previouslyUnprocessedCourse);
  expect(afterLateResponse.assignments).toEqual(afterReset.assignments);
  ```
- [ ] **Step 2 — Verify RED.** `npm test -- tests/unit/guest-sync-coordinator.test.ts tests/unit/guest-credentials.test.ts` must fail on the new lifecycle behavior.
- [ ] **Step 3 — Implement orchestration.** Acquire/renew/release only the caller's F3 lease; check current fence before each dispatch/commit. Mark source attempt once, independently of response checkedAt. Generate rows/status external identity from validated DTOs/protocol membership, then merge through F3. Setup without an existing source uses purpose=setup and atomically creates connection/courses only after valid success; failed tests do not change accepted data. New courses start disabled. Canvas connect may commit its valid initial feed; Ed/Gradescope discovery creates unselected courses, then explicit selection precedes assignment reads. Stop invalidates requests immediately, aborts server reads best-effort and never claims extension reads stopped. Memory credential is installed only after accepted connect; remember=true writes the separate IDB credential in that same accepted transaction. No retry on provider/network uncertainty; new user actions get new IDs.
- [ ] **Step 4 — Verify GREEN.** Repeat focused tests and F1/F2 tests. In the native F3 harness add a real delayed response/cross-tab takeover case that calls this coordinator and verifies transactionally rejected old commit/release, not just a fake-port promise.
- [ ] **Step 5 — Commit.** Stage U2 files only; commit `feat: coordinate guest sync with local fences and outcomes`.

### U3: Connect source cards, verification UI and stale-on-open behavior

**Files:** Create `src/features/guest/{guest-sources-provider,guest-sources,guest-source-cards,guest-sync-controls,guest-verification}.tsx`; wire F4 Sources/Upcoming/Assignments pages; test `tests/component/guest-source-cards.test.tsx`, `guest-sync-controls.test.tsx`, `guest-verification.test.tsx`; create `tests/e2e/guest-source-sync.spec.ts` and add it to both project matchers.

**Interfaces:** `GuestSourcesProvider` creates one stable U2 coordinator per hydrated store/page epoch. `useGuestSources()` exposes current report/busy/actions and booleans for secret availability, not raw secrets in snapshots/general health. `GuestVerification({siteKey,onProof,onCancel})` renders a guest-only Turnstile widget using action `guest_sync`; it has no Auth.js/provider-sign-in action. It receives the public site key only.

- [ ] **Step 1 — Write RED interaction tests.** Connect each source, preserve explicit course selection, show a 9/10 Canvas partial alongside Ed success and no account prompt. Separately show updated/failed/pending counts after a queue limit; unprocessed members cannot look successful. Assert no extension still permits feed/Ed, while absent/signed-out provider tabs give specific retained-data outcomes. A GUEST_SESSION_REQUIRED response exposes verification; after the user's fresh proof/continue action, bootstrap and retry with a new registry request, without replaying any possibly dispatched provider read. Assert stale automatic Canvas/Gradescope uses the same lease and runs once, StrictMode does not duplicate starts, manual/busy output is current and completion never calls router.refresh.
  Core assertions for `partial Canvas does not hide successful Ed or require a Kairos account`:
  ```ts
  expect(screen.getByText(/9 of 10/)).toBeVisible();
  expect(screen.getByText(/Ed sync complete/)).toBeVisible();
  expect(screen.queryByText(/sign in to Kairos/i)).not.toBeInTheDocument();
  expect(router.refresh).not.toHaveBeenCalled();
  ```
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/component/guest-source-cards.test.tsx tests/component/guest-sync-controls.test.tsx tests/component/guest-verification.test.tsx`; run `npx playwright test tests/e2e/guest-source-sync.spec.ts --project=chromium --project=firefox` with `page.addInitScript` v1 protocol fixtures and controlled guest Turnstile script.
- [ ] **Step 3 — Implement UX using existing tokens/components.** Show `Saved in this browser`, transient-server disclosure, optional remembered-credential checkbox, local source/course selection and independent per-run counts. Secret forms clear after accepted setup and do not render stored secret values. Automatic checks run after hydration, use the 15-minute rule and share the coordinator; feed/Ed remain manual. Do not mount existing hosted Ed/Gradescope/status providers/cards unchanged. Apply the UI/UX skill during UI implementation and preserve keyboard/focus, 320px layout and existing account defaults.
- [ ] **Step 4 — Verify GREEN.** Repeat tests and browser source-sync checks. In E2E abort any `/api/sources/*`, `/api/settings/onboarding/*`, `/api/sync-all/*` or `/api/calendars*` guest request; only `/api/guest/*` and v1 postMessage fixtures are permitted. Assert zero Auth.js session preparation for ordinary guest tests and persisted results after reload.
- [ ] **Step 5 — Commit.** Stage U3 files only; commit `feat: connect live sources without a Kairos account`.

### U4: Complete guest settings, backup/reset and source deletion flows

**Files:** Create `src/features/guest/{guest-settings,guest-backup-controls}.tsx`; wire guest Settings/source disconnect actions and F4 provider; update `src/app/{privacy,terms,support}/page.tsx` for guest-specific storage/transient-fetch/reset/backup disclosures while preserving hosted statements; test `tests/component/guest-backup-controls.test.tsx`, `guest-settings.test.tsx`, existing `public-pages.test.tsx`, and `tests/e2e/guest-backup.spec.ts` in both projects.

**Interfaces:** Components consume F2 serialize/parse, F3 replaceDataset/clear/disconnect and U2 credential invalidation. They use explicit confirmation state for replacement/deletion; no new server coursework/import endpoint.

- [ ] **Step 1 — Write RED backup/settings tests.** Assert timezone/filter persistence, 10 MiB/unsupported/malformed/reference-invalid import preserves the old dataset, valid replacement remaps connection references/new dataset identity and clears all secrets/pending work, and export structurally excludes private stores. Assert same-source credential re-entry preserves saved rows, forgetting a secret preserves coursework but invalidates pending reads, source disconnect removes only that source after confirmation, and clear guest data leaves account APIs/session intact. If session-end fails offline, local deletion still completes and no hidden account call occurs. Public-page tests must distinguish guest local secrets/transient processing/anonymous admission metadata from hosted encrypted credential persistence, and describe actual browser-loss/support limits without promising immediate physical deletion.
  Core assertions for `backup replacement is atomic and credential-free`:
  ```ts
  expect(JSON.parse(exported).data).not.toHaveProperty("credentials");
  expect(afterInvalidImport).toEqual(beforeImport);
  expect(afterValidImport.datasetId).not.toBe(beforeImport.datasetId);
  expect(afterForget.assignments).toEqual(beforeForget.assignments);
  ```
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/component/guest-backup-controls.test.tsx tests/component/guest-settings.test.tsx tests/component/public-pages.test.tsx` and `npx playwright test tests/e2e/guest-backup.spec.ts --project=chromium --project=firefox`.
- [ ] **Step 3 — Implement controls and disclosures.** Use browser File/Blob/download with local bounded parsing; provide preview counts before confirmed replacement. Clear secrets in memory and the store, invalidate requests before accepting new input, and call guest session-end best-effort without blocking local reset on network. Show that browser data loss has no server restore and that exports contain private coursework. Preserve device-wide theme while keeping guest timezone/source preferences separate. Align guest-enabled Privacy/Terms/Support copy and route links with actual implemented behavior; preserve truthful account-mode disclosures and no-account use, without making legal-compliance guarantees.
- [ ] **Step 4 — Verify GREEN.** Repeat focused checks plus F2/F3 regression tests, `npm run typecheck`, `npm run lint`. Native storage errors must still retain the last accepted dataset rather than showing a successful reset/import.
- [ ] **Step 5 — Commit.** Stage U4 files only; commit `feat: add guest backup and local data controls`.
