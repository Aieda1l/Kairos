# Guest hosted-test package implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reviewed offline Free-compatible diagnostic package and local-native proof before any hosted action.

**Status:** H1 and H2 implementation, scoped fix/portability reviews and final whole-branch review are accepted for offline preparation. Current formal native evidence measures `c4505d8`; later status changes are documentation only. Protected new-branch CI/integration remain required. Cloud actions and release gates are not approved by this status.

**Architecture:** Two Workers and two disposable D1 databases. A hermetic original build is copied by parsed module inventory; first-import prelude routes inspected HTTP paths through private immutable fixtures with atomic counters. An explicit bounded driver and count/hash-only observations preserve null/unmeasured hosted fields.

**Tech Stack:** Existing Node22, Git/Vite/Vinext, pinned Wrangler/Miniflare/workerd, D1, Vitest; no dependency upgrades.

**Spec:** [hosted package design](../specs/2026-11-04-guest-hosted-test-package-design.md), [approved hybrid product design](../specs/2026-10-24-hybrid-local-guest-mode-design.md), [operator sequence](../../deployment/guest-acceptance.md).

## Global Constraints

- Production/base guestfalse; no product source, production config, migrations, dependency-lock, maintenance/billing/key-account change or provider traffic.
- No Cloudflare API/provision/upload in builder/tests/local proof. No private env/auth-profile values read or copied. Preserve all prior ignored evidence/junctions and D:usercheckout.
- This is trusted-code fixture substitution, not platform egress isolation. Stronger hosted/security/activation gates remain open.
- Actual compiled default routes/modules stay byte-identical. No factory shortcut, rebundling fallback, framework-symbol manufacture, mutable current-env pointer or request-level env.DB monkeypatch.
- Hermetic Git export and allowlisted child env; explicit force-local/dotenv/process-env/telemetry controls from spec; emitted env material fails.
- Exact proposed nonprod hostname; no workers.dev rewrite or forged ingress. Private fixture has no public/control surface. Unknown traffic never falls back.
- Secret names only; fixed diagnostics and count/hash-only receipts. Hosted unsupported/unmeasured metrics null, never fabricated zeros/peaks/per-request attribution.
- Limits64apprequests/6concurrent/20secondrequest/5minute dispatch/128fixture admissions, no retry or driver redirects. Fresh separate app/fixture D1.
- Artifacts written only under fresh owned output paths; no destructive cleanup or traversal of unrelated paths/junctions.

## Review Focus

1. Ambient environment or emitted dev-vars entering copied modules/config: poison-sentinel build tests and exact output inventory.
2. Early alias capture or unknown outbound path bypassing private fixture: module-order/native capture, redirect and fail-closed tests; capability inventory limitations explicit.
3. Counter/context races under six requests: atomic SQL and interleaved native requests, no mutable global dispatch state.
4. False success after timeout/drift/protected mutation or publication failure: negative behavioral tests and incomplete/sanitized receipts.
5. A template mistaken for approved deployment: unresolved/production/mismatched identities reject operator-ready mode; no implicit hosted requests or metric claims.

### Task 1: Hermetic package and private fixture runtime

**Owned files:** create `scripts/prepare-guest-hosted-package.mjs`, `scripts/lib/guest-hosted-build.mjs`, `scripts/lib/guest-hosted-package.mjs`, optional corresponding `.d.mts` declarations, `scripts/guest-hosted/candidate-entry.mjs`, `scripts/guest-hosted/prelude.mjs`, `scripts/guest-hosted/fixture-worker.mjs`, `scripts/guest-hosted/control-schema.sql`, `scripts/guest-hosted/manifest.schema.json`, `tests/integration/guest-hosted-package.test.ts`. Generated per-component configs come from the explicit package schema; separate template files are optional only if clearer. No other tracked ownership.

**Interfaces:**
- `buildGuestHostedApplication({applicationRevision,outputRoot})` returns a hermetic build receipt/path with source/config/lock/toolchain/env-key and module/asset inventories. Verify full commit and ownership; never accept stale dist as fresh input.
- `prepareGuestHostedPackage({buildReceipt,inventory,outputRoot})` returns `{manifestPath,packageDigest,deployable:false}` for offline templates. Inventory freezes run/scenario, proposed host/resource names, exact methods/paths/upstreams, binding/secret-name allowlists and fixed caps.
- `verifyGuestHostedPackage({manifestPath,inventory,mode})` verifies all file/config/source hashes and identities. `mode:'offline'` retains unresolved template state; `mode:'operator-ready'` rejects unresolved/production/drift and still does not authorize cloud action.
- Fixture protocol and manifest version1 are produced here and consumed unchanged by Task2. Read exact required synthetic app env names from current GuestServerBindings/runtime, not guessed names. Fixture counters use separate D1 and immutable run identity.

- [x] **Step 1:** Write meaningful contract tests then record RED: unsafe/missing identity, source/module/config drift, path/symlink escape, env poison/unsupported emitted file, unknown route/destination or missing binding, counter exhaustion/store failure and atomic concurrent cap. Tests inspect outcomes/state, not source spelling.
- [x] **Step 2:** Implement hermetic source export/build, strict inventories and prepared-only manifest/config generation. Verify app modules remain byte-identical; known computed framework edges have explicit reviewed exact provenance and limitations. Reject unsupported graph instead of bypassing it. No ambient keys, E2E flags or real auth configuration.
- [x] **Step 3:** Implement first-import prelude, narrow authenticated ingress and private immutable fixtures. Preserve actual request/context/bindings and abort/body/redirect semantics. Asset fallback, if required, is a declared private rejecting service with zero calls proved; no UI surface. No public fixture control/reset.
- [x] **Step 4:** Focused GREEN and lint/types. Native minimal ordering/alias/default-route smoke and counter proof on a fresh hermetic graph; no source-secret/factory shortcuts. It may use an ignored proof harness, but record source/input/config hashes and a reproducible command for Task2. No hosted requests.
- [x] **Step 5:** Self-review, owned commits and task-1-report.md with raw exits/identities/limits; independent spec/quality/security review before Task2 consumes the contract. Report blocking runtime/module uncertainty rather than silently weakening the design.

### Task 2: Bounded driver, native package proof and operator handoff

**Owned files:** create `scripts/run-guest-hosted-diagnostic.mjs`, `scripts/lib/guest-hosted-diagnostic.mjs`, optional `.d.mts`, `scripts/verify-workerd-guest-hosted-package.mjs`, `scripts/guest-hosted/analytics-requests.graphql`, `tests/integration/guest-hosted-diagnostic.test.ts`, `docs/deployment/guest-hosted-test-package.md`; modify `package.json` only for preparation/local-proof aliases. Root owns existing release status docs. H1 contract edits return to H1 owner/review.

**Interfaces:** `runGuestHostedDiagnostic({verifiedPackage,targetOrigin,workload,request,observations}) -> DiagnosticReceipt`. Request/observation adapters are explicit; no default cloud credentials or deployment adapter. Local proof supplies native adapters and outbound seals. An explicit later hosted mode requires resolved reviewed inventory/operator authorization; preparation/local mode cannot invoke it. Observation uses quiescent all-table hashes/counts plus durable fixture admissions; no rows/credential fields.

- [x] **Step 1:** RED behavioral tests for total/concurrent/deadline caps including failed attempts, redirect/host drift, invalid/unfinished counters, protected-table mutation, sanitized credential-free results, missing authorization/identity and unsupported-metric null reasons.
- [x] **Step 2:** Implement bounded no-retry driver and exact receipt schemas. Add read-only platform request templates/settings/unit checks; preserve aggregate/raw/sampled units and unavailable attribution. No account query runs in preparation. Separate fixture/setup/observer costs.
- [x] **Step 3:** Implement reproducible native proof loading the exact package as multi-module Workers with all real migrations, cf:false/telemetry off/rejecting sinks. Exercise four actual routes, origin/capability/allowlist denial and six interleaved near-cap reads, durable counts and protected-table preservation. Verify missing binding/unknown destination/alias paths cannot use native fallback. Proof-only inspection modules are excluded from upload inventory.
- [x] **Step 4:** Run focused GREEN/lint/types and one final exact-source native package proof after source settles; retain UTF8 command/exit/receipt/hash evidence. No unchanged broad browser loop. Document finite operator command/resource/traffic/teardown plan, unresolved fields, separate creation/binding/upload approval and every open release limitation.
- [ ] **Step 5:** Self-review/commit, independent task review then whole-new-branch review. Root follows existing reviewed-PR/normal-protection integration workflow, without bypass or production action. Final hosted action needs a concrete verified artifact/inventory and operator approval.

## Controller decisions

Free preference chooses a preparation diagnostic rather than paid platform egress. The weaker measurement boundary stays explicit and cannot close stronger release gates; a mistaken choice costs rework, not a production exposure, because no hosted action occurs now. Use two Workers/two D1 and operator snapshots rather than a third control service. Prefer preserved modules/first prelude over lexical rebundling. Require clean export/build to address discovered dotenv/dev-vars behavior. Unavailable exact per-request/peak/billing fields stay null. These decisions refine local preparation under the user's go-ahead; they are not operator approval of cloud resources or public activation.
