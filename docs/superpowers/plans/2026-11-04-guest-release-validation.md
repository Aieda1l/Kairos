# Guest release validation preparation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and execute reproducible local-native anonymous-retention validation while retaining the remaining hosted release gates.

**Status:** Local validation and independent task/whole-branch review accepted. The measured native source is `e69a9fa`; its recorded retention-probe/helper/configuration/migration/package inputs remain unchanged. Subsequent fixture-startup test and documentation changes have separate evidence. This does not close hosted capacity, sustained retention, live-provider or activation gates.

**Architecture:** Exercise the existing `maintainAbuseState` helper through an injected adapter against fresh disposable local D1 containing every real migration. Use synthetic fixtures and full-table preservation snapshots; save only counts, timings and source/schema hashes. This implements the already specified cleanup-preparation portion of the operator sequence, independently of the not-yet-prepared hosted capacity harness.

**Tech Stack:** Existing Node 22, Miniflare/workerd, D1, Vitest; no new dependencies.

**Spec:** [approved hybrid design](../specs/2026-10-24-hybrid-local-guest-mode-design.md), especially first-release/activation boundaries; [operator release sequence](../../deployment/guest-acceptance.md), steps 1–7, especially step 4.

## Global Constraints

- Base and production `KAIROS_GUEST_ENABLED` remain `false`.
- No production mutation, remote D1 call, provisioning/upload, maintenance activation, billing/key change or real-provider traffic.
- No coursework/credentials/cookies/capabilities/raw provider errors in fixtures, receipts or logs.
- Reuse actual cleanup and migrations; do not change retention policy, helper SQL, account behavior or release protections.
- Batch size is 100; the helper has independent bounds for all four cleanup tables. Prove rate-row bounds without claiming a total-table bound of 100.
- Logical one-hour eligibility does not establish physical retention, a sustainable hosted cadence, recovery-history erasure, billed D1 cost or hosted CPU/memory.
- Preserve prior feature worktree evidence and the unrelated D: checkout. Work from new branch based on merged main.

## Review Focus

1. Accidental remote execution: no maintenance CLI/Cloudflare API client, remote binding, real environment credential or network fallthrough.
2. False deletion acceptance: assert actual expired row absence and exact recent/account/control/protected content preservation after dry-run and every apply.
3. Misstated bounds: backlog exceeds one batch, mixed eligible/ineligible rows, per-table caps, finite repeat drain and idempotent final apply.
4. Misleading receipts: source/config/schema/helper hashes, actual numeric counts and honest local-only evidence; failed assertions must not emit a success receipt.
5. Operational cleanup: dispose only the in-memory/temp database owned by this run, including failure paths; never delete or traverse unrelated artifacts/junctions.

### Task 1: Disposable native retention proof

**Files:**
- Create `scripts/verify-workerd-guest-retention.mjs` (standalone local-only entry).
- Create `scripts/lib/guest-retention-probe.mjs` only if needed for independently testable probe/report logic.
- Create `tests/integration/guest-retention-probe.test.ts` (focused behavioral contracts).
- Modify `package.json` only to add `verify:guest-retention` for the new script.
- Create `docs/deployment/guest-retention-validation.md` (actual command, evidence and limits).
- Root subsequently updates current CI/release status in existing deployment docs; worker does not own those files.

**Consumes:** Actual `maintainAbuseState(db,{batchSize:100,apply:boolean})` from `scripts/lib/abuse-maintenance.mjs`; actual migrations and local D1. Existing local-native snapshot/identity patterns may be reused read-only, without importing a runner with execution side effects.

**Produces:** `node scripts/verify-workerd-guest-retention.mjs` / `npm run verify:guest-retention`, which needs no Cloudflare credentials, uses no remote binding, and writes a count/hash-only UTF-8 receipt under ignored `artifacts/guest-retention/<UTC>-native/receipt.json`. It exits nonzero with a fixed diagnostic on failure and cannot emit success after an assertion failure.

- [x] **Step 1:** Add meaningful failing tests for the new probe's safety/receipt/preservation contracts. Include controlled wrong deletion/preservation or exceeded-bound evidence and reject it, rather than asserting function spelling. Record expected RED before implementation.
- [x] **Step 2:** Implement isolated native D1 setup with all real migrations and no outbound internet. Seed more than 100 expired null-user rate rows plus unexpired anonymous, account-associated and protected/control sentinels. Protected fixtures must survive unless explicitly documented as eligible cleanup fixtures; do not imply the helper preserves all expired account rows by policy.
- [x] **Step 3:** Run the real helper dry-run and prove unchanged full snapshots. Apply once and prove at most 100 eligible rate deletions, exact expected table differences and all preservation checks. Repeat with a finite maximum until the finite synthetic backlog drains, verify actual absence, then prove an idempotent final apply. Record per-invocation and other-table counts separately. Use database time for eligibility; do not race the cutoff boundary.
- [x] **Step 4:** Verify focused GREEN plus lint/types appropriate to added files; run the actual standalone native probe once and retain receipt/log/exit evidence and hashes. A source change requires affected rechecking, not a repeated broad suite for cosmetic evidence.
- [x] **Step 5:** Document actual results and explicit limits. Self-review and commit only owned files. Independent task review must accept spec and quality; root reconciles automatic main CI and remaining hosted gates before completion.

## Controller ruling and external boundary

Retention preparation is independently useful while hosted fixture-egress portability remains under research; it does not skip or close operator steps 2–3. The Free target remains the default; no paid product is selected or enabled. A hosted candidate must be concrete and separately reviewed before any provisioning/upload. Public activation remains a separate reviewed release decision under the approved design.
