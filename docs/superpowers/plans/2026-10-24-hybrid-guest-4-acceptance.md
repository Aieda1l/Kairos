# Hybrid Guest Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish complete guest behavior, account separation and honest release/capacity evidence before public activation.

**Architecture:** Exercise actual guest store/handlers/coordinator through controlled browsers and sealed native workers, while retaining the existing hosted regression boundary.

**Tech Stack:** Existing Playwright Chromium/Firefox, Vitest, Miniflare/workerd and repository CI/build/safety checks.

**Spec:** [Approved design](../specs/2026-10-24-hybrid-local-guest-mode-design.md). **Contracts and dependency order:** [Parent plan](2026-10-24-hybrid-local-guest-mode.md). Requires Parts 1–3.

## Global Constraints

- Keep base/production guest flag false until an approved concrete activation. No deployment, billing, key rotation or maintenance activation occurs merely because tests pass.
- Native fixture success/Node CPU/elapsed time is not deployed Workers CPU or live-provider evidence.
- Saved coursework is local; only declared anonymous admission metadata enters D1. Existing extension permissions/version remain unchanged.
- Full live source scope includes Canvas/Gradescope/Ed; a partial Canvas item must remain partial rather than being removed from the denominator.

## Review Focus

Use the same browser context to test guest/account switching. Real IndexedDB transactions and actual handlers must prove reset/takeover fencing. Retain first failing traces; do not bypass assertions to produce a green acceptance report.

### A1: Exercise complete flow, lifecycle failures and storage errors

**Files:** Create `tests/e2e/guest-lifecycle.spec.ts`; extend guest-source-sync/storage/concurrency/backup specs and test harness only; update both explicit Playwright matchers.

**Interfaces:** Consume actual F3/U2/U3 behavior; fixtures return only schema-valid v1 protocol and approved guest DTOs. Tests may delay/alter responses at the API/message boundary, never fake store completion or remove final-stage assertions.

- [ ] **Step 1 — Write the missing RED journeys.** Start a no-session browser, connect all sources, select courses, run full sync, verify data/current outcomes, reload and verify persistence. Include one Canvas failed member while Gradescope/Ed succeed. Defer a read across source replacement, reset and import; simulate two-tab contention/takeover; resolve stale responses and assert no resurrection or stale lease release. Inject native IDB write abort and verify old snapshot in every store. Test unavailable/older bridge, empty selected courses, rate limit and overall timeout.
  Core assertions for `complete guest flow survives reload and rejects a late reset result`:
  ```ts
  await expect(page.getByText(/9 of 10/)).toBeVisible();
  await expect(page.getByText(/Ed sync complete/)).toBeVisible();
  expect(hostedSourceRequests).toEqual([]);
  expect(afterLateResponse.datasetId).toBe(afterReset.datasetId);
  ```
- [ ] **Step 2 — Verify RED.** Run `npx playwright test tests/e2e/guest-lifecycle.spec.ts --project=chromium --project=firefox`; record missing behaviors with traces, not a zero-test run.
- [ ] **Step 3 — Fix owning boundaries only.** Route defects to their F/S/U module; preserve membership/freshness/auth checks and source success/partial semantics. Add the focused regression that identifies each actual defect before its minimal fix.
- [ ] **Step 4 — Verify GREEN.** Run all `guest-*.spec.ts` files in both projects, all new guest Vitest files, typecheck and lint. Inspect actual case selection from `npx playwright test --list` so both browsers cover each guest journey.
- [ ] **Step 5 — Commit.** Commit focused fixes plus lifecycle coverage as `test: verify guest sync lifecycle and recovery`.

### A2: Prove same-browser account separation and hosted compatibility

**Files:** Create `tests/e2e/guest-isolation.spec.ts`, `tests/integration/guest-production-boundary.test.ts`; update existing source/tenant/public tests only for intended presentation changes; add to both browser matchers and hosted safety assertions.

**Interfaces:** Reuse existing fixture-user helpers only inside account-isolation tests. Ordinary guest tests must not call `prepareFixtureUser`. Guest data is a separate IndexedDB namespace; account data remains user-scoped D1.

- [ ] **Step 1 — Write RED same-context tests.** Seed a guest dataset, sign into Alice then Bob in that same context, visit guest/hosted views and sign out. Assert each dataset/timezone stays separate and no guest data/secret is uploaded. Delete/reset guest and verify hosted data/session intact; delete the hosted fixture account and verify local guest data intact. Assert signed-in account cookies do not authorize guest reads without capability and guest capability never grants account API access. Guest disabled/default config hides routes/link and rejects API work before upstream fetch.
  Core assertions for `guest/account switching in one browser never transfers data`:
  ```ts
  expect(guestAfterAccountDeletion).toEqual(guestBeforeAccountDeletion);
  expect(accountAfterGuestReset).toEqual(accountBeforeGuestReset);
  expect(guestCapabilityAgainstAccountApi.status).toBe(401);
  expect(disabledGuestUpstreamCalls).toBe(0);
  ```
- [ ] **Step 2 — Verify RED.** Run `npm test -- tests/integration/guest-production-boundary.test.ts` and `npx playwright test tests/e2e/guest-isolation.spec.ts --project=chromium --project=firefox`.
- [ ] **Step 3 — Complete boundaries.** Fix explicit composition/auth/config errors, never add guest exceptions to protected account routes. Ensure production cannot use loopback cookie/test transport/Turnstile fixture bypasses and new guest modules do not import native SQLite or hosted request ownership.
- [ ] **Step 4 — Verify GREEN.** Run the complete repository verification once: `npm test`, `npm run lint`, `npm run typecheck`, `npm run db:verify`, `npm run verify:workerd:abuse`, `node scripts/verify-workerd-calendar-lifetime.mjs`, `node scripts/verify-workerd-turnstile.mjs`, `node scripts/verify-workerd-guest-sources.mjs`, `npm run build:extension`, `npm run test:e2e`, `npm run build`, `npx vinext check`, `npm run build:vinext`, `node scripts/verify-workerd-provider-completion.mjs`, `node scripts/verify-workerd-icloud.mjs`, `node scripts/verify-dynamic-dashboard-build.mjs` and `npm run verify:hosted`. Record actual totals; do not reuse the old 1,776/65 counts after adding tests.
- [ ] **Step 5 — Commit.** Commit separation/regression coverage as `test: verify guest and hosted account separation`.

### A3: Record capacity/privacy/live gates and prepare a reviewable release boundary

**Files:** Complete `docs/deployment/guest-capacity-readiness.md`; create `docs/deployment/guest-acceptance.md`; update `README.md`, `docs/superpowers/ROADMAP.md` and the implementation-plan checkboxes; extend `scripts/verify-production-safety.mjs` and `.github/workflows/milestone-2-ci.yml` for actual new entrypoints where needed. Ignored release/capacity artifacts remain separate from product code.

**Interfaces:** Consume S4 receipts and actual CI source/graph evidence. Acceptance ledger distinguishes automated fixtures, native runtime, comparative parser measurements, isolated hosted CPU and operator live reports. No status is inferred from elapsed time or old release data.

- [ ] **Step 1 — Inventory required evidence.** Ledger requires exact-source guest behavior for normal/adversarial payloads, denied/global/bootstrap D1 costs, physical retention/cleanup policy, all source workflows, fixed diagnostics, default-off behavior and same-browser separation. Map each claim to an actual immutable receipt/source or mark it OPEN. This is documentation/verification work, so do not invent a mirrored status test or force an artificial RED cycle.
- [ ] **Step 2 — Identify unmet gates.** Inspect S4 and A1/A2 outputs and the exact-source CI result. Confirm that native/local elapsed evidence cannot close hosted CPU/live-provider/physical-retention gates, and missing evidence leaves activation incomplete.
- [ ] **Step 3 — Produce honest evidence/runbook.** Populate passed automated evidence only. Describe the remaining isolated hosted CPU/operator live sequence with synthetic credentials/data and log persistence off; keep it as an explicit operator-controlled step if not yet run. Budget defaults are provisional until admitted/denied/bootstrap/cleanup costs fit measured capacity. If they do not, retain flag false and propose concrete measured alternatives; do not silently buy Workers Paid, remove live sources or activate maintenance. Prepared production artifacts require their own exact-source/config/schema/data/isolation/health checks and final deployment approval.
- [ ] **Step 4 — Verify implementation readiness.** Run the native guest check, diff/link checks and a fresh whole-branch review. Repository CI must pass for the exact integrated source before a release is claimed. Product implementation can be marked complete behind the flag while activation remains incomplete; document that distinction clearly.
- [ ] **Step 5 — Commit and hand off.** Commit `docs: record guest implementation and activation evidence`. Present the working guest slices and remaining concrete release gates. Never label the overall public beta or Free CPU headroom complete from the guest source-flow pass.
