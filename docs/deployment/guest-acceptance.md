# Hybrid guest implementation and activation evidence

Guest implementation is present behind the default-off flag. Local acceptance
has passing evidence; controller task/whole-branch review and public activation
are separate gates. **Guest activation and overall public beta acceptance remain
incomplete.** No deployment, remote migration, billing change, new key, cleanup
activation or real provider check was performed for this record.

The [approved design](../superpowers/specs/2026-10-24-hybrid-local-guest-mode-design.md)
and [implementation plan](../superpowers/plans/2026-10-24-hybrid-local-guest-mode.md)
retain the full Canvas, Gradescope and Ed first-release scope. Calendar writes,
cold-start offline/PWA, cross-device sync and account transfer remain deferred.
Hosted M7 acceptance remains governed by [current readiness](readiness-milestone-7.md).

## October 29 final-review fix evidence

The runtime fix commit is `db8c0c09aed11ba5181210f6e6b4d517cb8db977`. The A2/A3 receipts and suites below remain historical and do not transfer to this changed source. The scoped controller re-review, exact-source Linux CI and all external activation gates remain **OPEN**. Guest remains default-off.

The fresh clean-source local native receipt `artifacts/guest-source-capacity/2026-10-29T21-45-38-209Z-native/receipt.json` has SHA-256 `ad112a7977e73bfbf7465ea7b9419f0affd6c2b2fdf2a9eb1fe10d637c5218f8`: 81/81 checks in five phases; all 120 recorded input hashes match. Its input `dist/server/index.js` SHA-256 is `87de1eeef90a857f9f91044a6080bb929a25a5b40b158e9f8eb4a07e7d5de67f`; the separately rebundled probe SHA-256 is `946fa8d211c7c6bf083e0932d54a33a46ab5984ce4a93de165236d278cf4069d`. The actual compiled wrong-origin guest request returned the strict private/no-store envelope with zero D1/account statements and zero fixture upstream requests. This is sealed synthetic local evidence, not hosted capacity, physical retention, or live-provider acceptance.

Final-source Vitest passed 193 files and 2,121 tests (two files and 46 tests skipped); `artifacts/final-fix/unit-final.stdout.log` SHA-256 `440bde67fddc9eed45f02c768fe67d649a8e33a4820f3ca4fbbfa52963bc6a6b`. Typecheck, lint (seven reviewed warnings), Next/Vinext builds, compiled provider and iCloud checks, dynamic-route and production safety checks passed locally. The targeted two-browser stop and cross-tab dialog suite passed 16 cases. A later full diagnostic run passed 143 cases but lacked complete raw capture. The final captured standard full browser run **failed**: 141 passed, two Firefox failures. Guest/account isolation exhausted the overall 30-second test budget during a hosted assignments navigation; optional onboarding timed out its five-second heading assertion while a settings request lacked a completed response. Their causes remain unproven; traces and the full logs are under `artifacts/final-fix/browser-settled-results` and `browser-settled.stdout.log` / `browser-settled.stderr.log` (SHA-256 `f23d5e8a0b2a279785119508de6631504bbe3b4ed881e8e7df555664ed6fc199` / `09dcc250600c63c1107bd2a0364a74036ec7777f2680096673e37fd7fc25ccf5`). An earlier full run's complete log and traces were overwritten and are unavailable; its failure counts and diagnoses are recorded in the local fix report, not reconstructed. No test timeout or product deadline was increased.

## Evidence identities

Evidence below was inspected on October 28, 2026. Artifact paths are repository
relative and **ignored/local**, not published CI artifacts. Retain/export these
receipts with their hashes when preparing a release; a path alone is not durable
evidence. SHA-256 identifies the exact saved bytes, including failed historical
attempts retained separately in the implementation reports.

| Evidence | Measured source / identity | Result and qualification |
| --- | --- | --- |
| Final A2 native receipt: `artifacts/guest-source-capacity/2026-10-28T21-50-19-698Z-native/receipt.json` | Clean `4c4a3a14793a4e2236f17bc959202e7cf0f50390`; receipt SHA-256 `c38c838955101de39b1b8dce329837b061157e39ed21d9dd0545e3485c437667` | 79 checks, five phases passed; actual compiled default guest routes plus adversarial/admission fixtures |
| Fresh A3 native receipt: `artifacts/guest-source-capacity/2026-10-28T21-56-23-135Z-native/receipt.json` | Clean `c0f8763e3284da851db6b798b00f1c2684684104`; receipt SHA-256 `2000272773f97efa26316beb05ff48178c041c4070c94cf8b731acfb169f4e1a` | 79/79 passed; all 119 recorded input hashes match measured files; zero external/sink/unexpected requests and account SQL/protected write statements |
| A2 full Vitest: `artifacts/a2/full-vitest-fixed.log` | SHA-256 `24f0769c0b43c84e6cc05eecac9192eabbf9afcf772cbe1638fa1ef4196041e6` | 193 files passed, two skipped; 2,105 tests passed, 46 existing skips (2,151 total) |
| A2 standard browser: `artifacts/a2/full-browser.log` | SHA-256 `5d9ec376166cb4ca95d430d7b4deb185975a1ac11b4c9144cde693040729b815` | Actual `npm run test:e2e`, 127 passed, 7.1 minutes; Windows startup 240 seconds, non-Windows 60 seconds; test/assertion limits unchanged |
| S4 parser receipt: `artifacts/guest-source-capacity/2026-10-26T07-30-17-685Z-node/receipt.json` | Precommit/dirty S4 source `edff16636f91e3a570698e6714b5796d28705aa2`; SHA-256 `500ad0436b32119813e9a4f8cb6f064ae05ba30ab051b5f884cbf81d9f49b1ec` | Four fixtures, 20 recorded samples plus warmups; comparative Node process CPU/RSS only, no admission/D1 or hosted capacity acceptance |

Full A2 suites preceded its runner-only compiled measurement repair; the repaired
runner then passed against clean `4c4a3a1` and clean `c0f8763`. The only tracked
change between those refs was acceptance-plan checkboxes. A3 changes documentation
only. Neither historical suite is presented as a newly executed Linux CI run on
the final documentation commit.

The native compiled probe's rebundled SHA-256 is
`68696ef543f552c23a935677f4a7a1016a7070cca9e0e1249e6027d86c312776`.
Its input `dist/server/index.js` SHA-256 is
`99468495c078f8859517c2aa98524342d58462942467309778314e008934f5ff`;
these identify different artifacts. Source tree identities at `c0f8763` are
`src` = `d6c9b5b74020e3b0c6fae829d1b5b4ecac0836cc`,
`scripts` = `2f264254d36e03204492d9c0969e455c5d4b1d41`,
`tests` = `3c6e6f165804f0882cf4cd08ad16c625239a0b6f`, and
`migrations` = `7216d0c1c01df6e5eae918f73340b63cd3d7df6b`.
Documentation-only descendants retain those trees; a changed runtime, fixture,
dependency, configuration or build requires checking input hashes and rerunning
the affected evidence rather than transferring acceptance by branch name.

## Local behavior ledger

Each PASS is limited to the automated boundary named here. The tests are source
links; the saved full-suite logs above and native receipt are execution evidence.

| Claim | Status / actual evidence | Limit |
| --- | --- | --- |
| No-account local views, assignments/calendar filtering, backup/import/reset | PASS: [views](../../tests/e2e/guest-views.spec.ts), [backup](../../tests/e2e/guest-backup.spec.ts), [storage](../../tests/e2e/guest-storage.spec.ts), [schema](../../tests/unit/guest-schema.test.ts), [backup schema](../../tests/unit/guest-backup.test.ts) | Synthetic local data; no cold-start offline or hosted acceptance claim |
| Memory-only credentials by default; explicit remembered storage and forgetting | PASS: [credentials](../../tests/unit/guest-credentials.test.ts), [source cards](../../tests/component/guest-source-cards.test.tsx), [backup controls](../../tests/component/guest-backup-controls.test.tsx) | Backup excludes secrets, capability, lease and pending requests; remembered device storage remains sensitive |
| All four sync stages, discovery/selection/re-entry, current partial outcome and persistence | PASS: [source sync](../../tests/e2e/guest-source-sync.spec.ts), [lifecycle](../../tests/e2e/guest-lifecycle.spec.ts), [coordinator](../../tests/unit/guest-sync-coordinator.test.ts) | Canvas feed/status, Gradescope and Ed fixture flows; Canvas 9/10 remains partial, not all-success; live checks OPEN |
| Bounds, fixed diagnostics, normal/empty/partial/adversarial source results and one whole-operation deadline | PASS: [Canvas](../../tests/unit/guest-canvas.test.ts), [Ed](../../tests/unit/guest-ed.test.ts), [source API](../../tests/integration/guest-source-api.test.ts), five-phase native receipt | Tiny fixture ingress buffers request bodies; slow request-input deadline belongs to focused source-API tests. Native stall proves timed rejection, not independently observed cancellation cleanup |
| Real IndexedDB atomic rejection, reset/import/source replacement fences, two-tab lease takeover and late-response discard | PASS: [storage](../../tests/e2e/guest-storage.spec.ts), [concurrency](../../tests/e2e/guest-concurrency.spec.ts), [lifecycle](../../tests/e2e/guest-lifecycle.spec.ts), [provider](../../tests/component/guest-provider.test.tsx) | Native browser fixtures; A1's 60 distinct cases passed across 26 earlier storage/concurrency and 34 final UI cases, not one 60-case invocation; A2 subsequently passed full standard suite |
| Default-off entry/transport, strict capability/Origin/Host, local-only fixture/cookie isolation | PASS: [production boundary](../../tests/integration/guest-production-boundary.test.ts), [session](../../tests/integration/guest-session-api.test.ts), [fixture boundary](../../tests/integration/guest-test-fixture-boundary.test.ts), native receipt | Undefined/false/nonexact flags reject before D1/fetch; base/production [config](../../wrangler.jsonc) remains `false` |
| Same-browser guest/Alice/Bob separation; reset/deletion and capability non-substitution | PASS: [isolation](../../tests/e2e/guest-isolation.spec.ts), [no account writes](../../tests/integration/guest-no-account-writes.test.ts), compiled native snapshots | Browser upload canaries cover non-guest API request bodies only; URLs and non-API uploads are outside that assertion. No actual leak identified; universal upload absence is not inferred from that detector |
| Actual compiled guest bootstrap/Canvas/Ed route composition without identity/calendar credential bindings | PASS: native compiled phase; [runner](../../scripts/verify-workerd-guest-sources.mjs) | Four observed fixture calls: one challenge, three provider reads; ten anonymous admission rows, 21 protected tables unchanged, zero account SQL/protected writes; Gradescope/status use browser bridge tests |
| Distributed/session denial and bootstrap costs | PASS locally: native contention and distributed phases; [admission](../../tests/unit/guest-admission.test.ts) | 40 reads admit 30/deny ten; 64 distributed reads admit 60/deny four. Later global denial adds two anonymous events, five SQL statements, zero upstream calls. Native D1 counters are not billed production rows |

A2 also passed local lint (seven existing warnings), types, migration parity,
native abuse/calendar-lifetime/Turnstile, extension build, Next build, vinext
compatibility/Workers build, compiled provider/iCloud, dynamic build, credential
and manifest checks, and production safety. Separate `.log`/`.exit` files remain
under `artifacts/a2`. Build/runtime output contains retained diagnostics and is
not pristine. Earlier standard 60-second startup failures, startup-only
180-second diagnostics, the first focused Chromium 30-second timeout, initial
safety-fixture failure and initial compiled-counter failures remain failures in
their saved records; the final passing commands do not relabel them.

A3's fresh native check, production safety, changed-document local links,
unchanged native-input hash audit and Git diff check passed. UTF-8 logs and
numeric exits are retained under `artifacts/a3`; only documentation changed, so
unchanged A2 broad suites were not repeated. Git LF/CRLF notices remain visible.

## CI and review boundary

The [Feature CI workflow](../../.github/workflows/milestone-2-ci.yml) uses Ubuntu
and Node 22. Its graph runs Vitest/lint/types, migrations, native abuse/lifetime/
Turnstile, extension and both browser projects, Next/vinext builds, then sealed
guest, compiled provider/iCloud, dynamic-build/safety and credential/manifest
checks. The guest check is after the Workers build. Existing
[production safety](../../scripts/verify-production-safety.mjs) enforces default-off
configuration, disallows guest ownership imports and requires this check/order.
No new A3 runtime entrypoint needs an additional guard.

This branch has no matching push trigger; a PR targeting `main` or authorized
manual dispatch is needed. No external CI was triggered or inspected for a final
guest revision during this task. The old deployed 1,776/65 result in README is a
different release. **Exact integrated-source Linux CI is OPEN.** Record the run
URL, tested head/merge SHA, complete job conclusions, totals and retained native
receipt before claiming release CI. Reconcile the final merge/main SHA as well.

Controller A3 task review is approved; the fresh whole-branch review remains **OPEN** here.
The final reviewer must triage every retained observation in the ignored SDD
`progress.md`: conservative Canvas `BEGIN:VEVENT` substring false positives,
native cancellation observation coverage, script/render/network/auth/eval/color/
build/compatibility/strict-mode/lint diagnostics, and the narrower upload detector.
The U1 registry-lifetime observation has reviewed per-run ownership evidence;
A1 fixed delayed verification revival, one-time disconnect focus and post-reset
hydration. Preserve those dispositions and their failure traces; do not silently
drop them or describe final review as passed from task approvals.

## Operator-controlled release sequence — not executed

1. Finish controller reviews, triage retained observations and freeze the
   reviewed revision. Obtain exact-source Linux CI and retain receipt hashes.
   A local pass allows implementation handoff behind the flag, not activation.
2. Prepare an isolated hosted candidate with synthetic data/credentials, fresh
   disposable D1, explicit ingress/origin, separate guest HMAC/challenge config,
   no production/account credentials and no fixture bypass in the candidate app.
   A separately reviewed hosted measurement harness must route the real compiled
   handlers' upstreams through sealed service-bound fixtures with outbound denial,
   following the native harness boundary; that hosted artifact is not prepared
   or measured by A3. Never send synthetic credentials to real providers. Keep
   production guest false and log/trace persistence off. Record source, build,
   dependency, config and schema hashes, isolation checks and health results.
   Provision/upload only through a separately authorized operator action.
3. Measure hosted per-request Worker CPU and shared-isolate peak memory for
   admitted near-cap success, parse failure, redirect, bootstrap/challenge failure,
   capability/origin rejection, session/network/global denial and six concurrent
   near-cap reads. Measure actual D1 billed reads/writes, attempted statements,
   earlier charges on denial, bootstrap churn and daily projected traffic.
   Retain sanitized count/metric receipts; exclude credential/body/error logs.
4. In disposable D1, test the existing bounded cleanup with expired anonymous
   rows, dry-run then explicit apply, and verify physical absence while preserving
   unexpired/control/protected records. Measure deletion/index cost, backlog,
   outage catch-up and a sustainable cadence. Publish a maximum retention bound
   including scheduler failures and recovery. Admission eligibility is one hour;
   existing hourly workflow/batch 100 is gated configuration, not proof of active
   or sufficient deletion. Account for distributed bootstrap churn as well as
   source reads: bootstrap has no global cap. Activation
   of maintenance requires a separate reviewed operator decision.
5. Compare admitted, denied, bootstrap and cleanup costs with verified plan
   allowances and actual baseline usage. Budgets (per 600 seconds: bootstrap/
   network ten, reads/session 30, reads/network 60, reads/global 60) are
   **provisional**. If capacity fails, keep guest false and measure proposed lower
   admission/concurrency budgets, smaller bounded requests/outputs or parser work
   reduction while retaining all three sources. A budget/workload revision needs
   review and new evidence; Workers Paid is an explicit operator choice, never
   an automatic purchase or an assumed gate closure.
6. Separately authorize operator live checks using controlled provider test
   accounts/coursework, with persistence off and redacted count-only reporting.
   Verify real Canvas feed/status (including accessible versus partial members),
   Gradescope discovery/read through Firefox/provider login, and Ed selection/read.
   Include memory-only reload/re-entry, explicit remembering/forgetting, source
   replacement, disconnect/reset/import, capability expiry and same-browser account
   separation. Record actual browser/extension versions and per-stage outcomes;
   synthetic hosted capacity results cannot substitute for this live report.
7. Prepare the concrete production artifact and operator review: exact source/CI,
   build/config/schema and migration compatibility, data/isolation/health checks,
   capacity and physical-retention evidence, rollback target and policy/disclosure
   consistency. Request final deployment/activation approval for that artifact.
   Keep guest false until approval and all release gates close; verify staged and
   post-deployment health/disabled behavior before any separately approved flag
   change. Do not infer broader M7 acceptance or calendar lifecycle completion.

| Remaining gate | Status |
| --- | --- |
| Controller task and whole-branch review | **OPEN** |
| Exact integrated-source Linux CI | **OPEN** |
| Hosted CPU / shared-isolate memory / deployed D1 billing capacity | **OPEN** |
| Cleanup capacity, physical retention bound and live deletion evidence | **OPEN** |
| Real Canvas, Gradescope, Ed operator acceptance and ingress review | **OPEN** |
| Exact production candidate checks and final deployment/activation approval | **OPEN** |

See [capacity evidence and its measurement limits](guest-capacity-readiness.md)
for native D1 accounting and the historical published Free-plan constraints.
