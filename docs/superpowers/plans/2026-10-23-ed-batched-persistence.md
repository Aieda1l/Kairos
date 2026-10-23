# Ed batched persistence implementation plan

> **For agentic workers:** Use superpowers:test-driven-development and verification-before-completion; execute tasks in the existing isolated worktree with explicit file ownership.

**Goal:** Replace Ed's per-assignment database round trips with bounded, fenced metadata/status batches.

**Architecture:** Reuse `prepareCountNew`, `prepareUpsertMany` and `prepareExternalCompletion`, preserving input order and the existing provider service boundary.

**Tech Stack:** TypeScript, D1/SQLite, Vitest, esbuild and workerd.

**Spec:** [Hosted Ed persistence batching](../specs/2026-10-23-ed-batched-persistence-design.md).

## Constraints and review focus

- No production deployment or dependency upgrade belongs to this step.
- Preserve duplicate ordering, stale-status metadata refresh, empty/partial results, tenant/source scope and ownership fences.
- Bound chunks to 100 rows and validate all UTF-8 strings before assignment data writes.
- Keep metadata and statuses atomic within each chunk; do not promise full-operation rollback.
- Keep the legacy path, fetching behavior and public response contract unchanged.

## Implementation and evidence

- [x] Add real hosted SQLite tests; verify only the call-count assertions fail against the old implementation. The initial run had four expected bound failures and nine passing semantic cases.
- [x] Replace hosted per-item persistence with ordered three-statement batches and result validation.
- [x] Add failure, payload and fencing cases. Targeted suite: 25 passed.
- [x] Run full tests, lint, typecheck and relevant builds; document any existing compatibility-tooling gate.
- [x] Complete independent correctness review.
- [x] Build independent baseline/candidate source bundles; verify native authentication, admission, data and count equivalence with synthetic fixtures.
- [x] Review and run isolated hosted measurement, collect exact-version/time metrics once available, and verify cleanup and unchanged production configuration.
- [x] Document the result and retain a reviewable local candidate; make no production capacity claim without the measurements.

## Result

See [Ed persistence batching](../../deployment/ed-batched-persistence-2026-10-23.md). The 42-assignment authenticated service path reduced binding calls from 232 to 22 and median hosted CPU from 124.638 to 19.625 ms, with ten attributed successful samples per version. Median synthetic response time fell from 7.940 to 1.077 seconds. Data/fences were preserved, all four temporary resources removed and production unchanged. This is a latency candidate, not demonstrated 10 ms Free capacity or a production deployment.

## Authorized deployment continuation

The operator subsequently approved merging and deploying despite the remaining Free CPU limit. PR #46 merged as `6e05463428869b08481dc577c7b8d3915d468018`; exact-main CI, clean archive/runtime gates, staged checks and promotion passed. Worker `b8f02ffe-aa73-493f-8c0a-ce23119d7db9` is active at 100%, with protected counts/controls retained and public/client/health checks passing. No migration or billing/key/logging change occurred. The operator confirms faster successful Ed sync; fresh read-only verification records 43 updated statuses, zero failed courses and idle ownership. This closes basic live Ed confirmation, not quantified live latency or Free-capacity acceptance.
