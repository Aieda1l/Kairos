# Source bridge interruption hardening plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent tasks below. Root coordinates browser processes and integration.

**Goal:** Close demonstrated avoidable registration/completion gaps and preserve source continuation safety during coordinated sync.

**Architecture:** Keep the existing start/complete protocol, server ownership, rate/admission, expiry and exact nonce/control fences. Gate only automatic registration on a fresh ready extension/tab and visible document. Complete an already-registered Gradescope discovery once on known bridge failures. Add a client-only `deferRefresh?:boolean` option so explicit Sync All has one final coordinator refresh after its source/calendar stages.

**Tech stack:** React/TypeScript, existing Zod protocol, Vitest/component tests, Playwright synthetic local D1/bridge fixtures.

**Authority:** User approved the next planned sync-interruption hardening step. Existing source-service behavior and incident-response settlement requirements remain binding. This bugfix increment changes no backend/API/schema or extension distribution.

## Evidence and constraints

The November incident had simultaneous admitted but unconsumed Canvas submission and Gradescope sync requests, both with stale running owners. That establishes missing completion, not its cause. React unmount does not cancel their async closures; the providers already sit in the shared dashboard layout. Hard document destruction loses the page's only completion sender while extension fetches may continue. Website timeout removes a listener and does not cancel extension work.

Concrete source gaps are independently visible: automatic starts register before readiness detection; Gradescope discovery's catch never completes a registration; per-provider refreshes occur during explicit Sync All despite the coordinator's final refresh. These are separate preventable paths. Do not claim the refresh gap caused the live incident.

- No release of ownership based on clock, reload, timeout, tab disappearance or guessed cancellation.
- No automatic retry, beacon/keepalive settlement claim, new API, provider credentials, real provider traffic, production writes or deployment.
- Preserve standalone/manual sync behavior, fixed error presentation and saved successful data.
- Preserve StrictMode single automatic attempt and checks after async readiness: an unmounted/disabled or newly hidden document must not admit work.
- A known-unready automatic check consumes no server start. Do not install visibility/timer retry loops.
- Discovery completion is attempted once, including failure. A failed/lost completion is not retried automatically. Timeout still reaches the existing uncertain-owner path.
- `deferRefresh` is client-only; existing admission IDs/calendar headers and extension payloads are unchanged. Direct provider calls still refresh normally.
- Hard document loss and lost start responses remain conservative recovery cases until a separately designed page-independent terminal acknowledgement exists. This increment does not promise crash-proof sync.

## Tasks

### 1. Canvas automatic readiness

Owner: root. Files: src/features/submission-status/submission-status-provider.tsx; tests/component/submission-status-provider.test.tsx.

- [ ] Baseline focused tests; add RED cases for pending/missing extension/tab, hidden page, and unmount/disable before delayed ping.
- [ ] Gate automatic start on readiness and current effect/document eligibility; keep manual zero-assignment behavior and existing post-registration checks.
- [ ] Verify same-document unmount after admission still completes; no cancellation cleanup.

### 2. Gradescope readiness and terminal discovery failure

Owner: dedicated worker. Files: src/features/gradescope/gradescope-provider.tsx; tests/component/gradescope-provider.test.tsx.

- [ ] RED cases for automatic unready/hidden/cancelled preflight and discovery failure after accepted start.
- [ ] Mirror automatic readiness gating; normalize ping errors into fixed supported extension categories.
- [ ] Retain exact registered request ID; send one validated terminal discovery error result for bridge failures before completion. No duplicate completion on a failed completion response. Preserve accepted courses/connection on failure; timeout remains uncertain through existing backend behavior.
- [ ] Focused tests GREEN. Worker leaves commit and broad checks to root.

### 3. Coordinated refresh ordering

Owner: root. Files: src/lib/sync-all/types.ts; src/features/sync/connected-source-sync-controls.tsx; Canvas/Gradescope/Ed providers and relevant component tests.

- [ ] Add RED composite assertion that actual providers never refresh while a later coordinated stage is pending, and coordinator refreshes once after all stages finish.
- [ ] Add `deferRefresh?:boolean` and pass true from the coordinator; provider sync paths suppress refresh only for that option. No other action (connect/discovery/selection) changes.
- [ ] Check success/partial/failure branches, standalone refresh, existing tickets/headers and continued calendar execution.

### 4. Browser interruption boundary

Owner: dedicated test worker. File: tests/e2e/sync-all-recovery.spec.ts only.

- [ ] Add local signed-in fixture case with both automatic bridge messages held, real guarded starts admitted, then destroy/reload document. Verify no completion, exact operations remain blocked, saved data retained. This is characterization of the conservative boundary, not a successful cancellation test.
- [ ] Add known-unready automatic case requiring zero start requests; retain explicit manual functionality when relevant.
- [ ] Root runs the affected suite once in Chromium/Firefox with synthetic transport only. Do not change global browser timeouts or weaken assertions.

### 5. Integration and review

- [ ] Root reviews all diffs and targeted evidence; runs full relevant tests, types/lint and browser checks. Restore exact next-env.d.ts bytes if type tooling changes them.
- [ ] Independent ECC/security-focused review checks error completion, uncertainty retention, no new auth bypass or unsafe retry, and precise claims.
- [ ] Publish a reviewable PR after validation. Follow the user's ECC-before-merge preference and required CI gates; production deployment remains separate.
