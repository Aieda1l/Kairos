# Hybrid guest implementation and activation evidence

Guest implementation and its independent reviews are accepted behind the
default-off flag. Exact-source CI and public activation remain separate gates.
**Guest activation and overall public beta acceptance remain
incomplete.** No deployment, remote migration, billing change, new key, cleanup
activation or real provider check was performed for this record.

The [approved design](../superpowers/specs/2026-10-24-hybrid-local-guest-mode-design.md)
and [implementation plan](../superpowers/plans/2026-10-24-hybrid-local-guest-mode.md)
retain the full Canvas, Gradescope and Ed first-release scope. Calendar writes,
cold-start offline/PWA, cross-device sync and account transfer remain deferred.
Hosted M7 acceptance remains governed by [current readiness](readiness-milestone-7.md).

## November 1 current final-fix evidence

The current runtime commit is `2688f9b053c5d4adcf7b27f7384b3510c2f1ea57`; the final test refinement is `2277c14a76f52b82c76511dcee63e750df116a18`. Browser persistence is requested once per document StorageManager after an accepted, still-owned user save or manual result; automatic checks and retired/cancelled owners cannot prompt. Requests remain best-effort and do not block accepted saves. These M1 changes invalidate transfer of the older `db8c0c0` native receipt. They are not a proven fix for historical Firefox click, close or network delays.

The actual standard full browser run on this commit **failed: 141 passed, two Firefox failures** (15.3 minutes, exit 1). Complete UTF-8 logs/exit metadata and unique failure traces are retained under `artifacts/final-fix/local-settled-full*`; stdout/stderr SHA-256 values are `624cd233a76f8ba1f47bc64c285d38c6ceda47284012113e4aef39c25611da35` / `210ef5e2a8c06a66358d618c9e69ce5e3d9890a211cafe5052a324557c8e2914`.

- The Bob-isolation phase exceeded its existing 30-second bound: fixture/settings calls took about 15.16 seconds, the assignments navigation 7.30 seconds, and the final guest-settings navigation had about 7.44 seconds before expiry. Its document returned HTTP 200 while development-module requests remained incomplete. This does not establish an IndexedDB fault or a 30-second navigation timeout.
- Guest views failed the initial five-second URL assertion after clicking “Try without an account.” The guest-upcoming RSC response returned HTTP 200 in 3.35 seconds, but the URL remained `/`. The failure preceded guest storage/save checks. The cause is not established.

All modified lifecycle and optional-onboarding cases passed in this full run, including both engines' exact Resume response/state checks. Earlier focused coverage was 21/22 followed by the corrected journey passing 2/2; these are separate captures, not a single 22/22 run. Named workflow phases retain 30-second bounds and five-second assertions. Their derived overall budgets are genuine timing relaxations, not performance evidence. Terminal peer cleanup is owned by the supplied context fixture after every assertion; disposal errors still fail the test. No further timeout increase or lucky full-suite rerun followed the two failures.

Fresh Next and Vinext builds passed. The clean-source native receipt `artifacts/guest-source-capacity/2026-11-01T12-06-43-463Z-native/receipt.json` has SHA-256 `9dea53f1f70eeee38b6d71a86bdf346a7cfba9d73d1f2ef0d75b7fe355176971`: **81/81 checks, five phases, all 120 input hashes matching**, measured on clean `2688f9b`. The input `dist/server/index.js` hash is `7751b9d3189a1a218271ca7b03d1bbe744e747b8e78cf368d9417993619229ef`; the separately rebundled probe hash is `bb87284ae17764e49465d81c1168bd7582eb6c4b10aca0868188811eb26931c1`. Compiled wrong-origin denial retained its strict private/no-store envelope and made zero D1/account/upstream calls. Sealed provider and iCloud probes, dynamic-route and production-safety checks passed; no real provider requests were made.

Full Vitest on the M1 runtime passed 2,130 tests in 194 files, with 46 existing test skips and two skipped files. Subsequent fixture-only corrections passed all 49 focused persistence/provider/control cases. Final typecheck and affected-file lint passed; full lint retained seven existing warnings. Required `next-env.d.ts` bytes were restored. `artifacts/final-fix/local-verification-manifest.json` records command exits and raw-log hashes. These ignored local artifacts are not published CI evidence.

The last full-suite result remains **141/143, exit 1**. A subsequent test-only refinement at `2277c14` passed all **four affected cases in Chromium and Firefox** with successful traces retained: isolation separates both Alice and Bob account work from their guest-return checks into eight 30-second steps, while keeping the existing 180-second outer ceiling, 30-second actions/navigation and five-second assertions. Guest entry registers target-URL navigation completion before the original link click, then retains the five-second URL assertion and all later checks. Every original action, assertion, context, request seal and ordering remains. The split permits each former account/return composite to span two bounded steps within the unchanged overall ceiling; the URL assertion now checks completed navigation. Neither change establishes a performance fix or the cause of the earlier delays.

`artifacts/final-fix/local-changed-list` exit 0 enumerates exactly four cases. `local-changed-focused` exit 0 records 4/4 in 2.6 minutes; stdout/stderr SHA-256 values are `51b0824ee29a533ac44d99278c7e53a892bf7bdfc425f63651abeb8c3807994b` / `1f2c419686f3f9bf7f8b30558ce8626c293647341526813b4c61f53a9b4a8535`. Successful traces are under `local-changed-focused-results`; isolation phase durations range from 0.422–9.433 seconds in Chromium and 0.782–2.007 seconds in Firefox. Affected typecheck/lint passed and required next-env bytes were restored. `local-changed-identity.json` confirms 120 matching native input hashes, no source/configuration changes and a read-only full server rebundle matching `bb87284ae17764e49465d81c1168bd7582eb6c4b10aca0868188811eb26931c1`. The native receipt remains measured at clean `2688f9b`; it was not rerun or relabeled.

The last full 141/143 result followed by affected 4/4 provides passing coverage of **all 143 distinct cases across separate runs**, with two overlapping Chromium successes. It is **not one passing full suite on the final test commit**; no further full run was performed for a cosmetic green result. The independent scoped I1–I4/M1–M4 re-review accepted all eight findings with no new Critical/Important breakage. **Exact-source Linux CI is still required before release**, and it and every external activation gate remain **OPEN**, with guest default-off. Earlier captures below are historical. The first failed full-browser run's raw log/traces were lost; that exception remains explicit. Later unique captures are retained. Passing local probes establish neither hosted capacity nor real-provider acceptance.

### Independent review acceptance

The whole-branch review covered `ce844f8..ce9b683` and required four Important and four Minor corrections. Its single scoped re-review covered `ce9b683..008a60e` and found I1–I4/M1–M4 **ADDRESSED**, with no new Critical/Important breakage. Full review reports and evidence remain in the local SDD workspace. This accepts implementation behind the disabled flag; it does not authorize integration, claim a final aggregate browser pass, or close release gates.

The Canvas marker-count limitation is fixed. Prior registry-lifetime, verification, focus and hydration observations are resolved with their recorded evidence. Native cancellation observation remains limited to timed rejection plus separately tested cleanup attempts. Existing lint/build/runtime diagnostics and historical click/close/network causes remain qualified; the upload canary covers non-guest API bodies, not every URL or non-API body. These retained limits are nonblocking for the scoped implementation verdict, not stronger production guarantees.

## October 29 historical final-review fix evidence

The runtime fix commit is `db8c0c09aed11ba5181210f6e6b4d517cb8db977`. The A2/A3 receipts and suites below remain historical and do not transfer to this changed source. The scoped controller re-review, exact-source Linux CI and all external activation gates remain **OPEN**. Guest remains default-off.

The fresh clean-source local native receipt `artifacts/guest-source-capacity/2026-10-29T21-45-38-209Z-native/receipt.json` has SHA-256 `ad112a7977e73bfbf7465ea7b9419f0affd6c2b2fdf2a9eb1fe10d637c5218f8`: 81/81 checks in five phases; all 120 recorded input hashes match. Its input `dist/server/index.js` SHA-256 is `87de1eeef90a857f9f91044a6080bb929a25a5b40b158e9f8eb4a07e7d5de67f`; the separately rebundled probe SHA-256 is `946fa8d211c7c6bf083e0932d54a33a46ab5984ce4a93de165236d278cf4069d`. The actual compiled wrong-origin guest request returned the strict private/no-store envelope with zero D1/account statements and zero fixture upstream requests. This is sealed synthetic local evidence, not hosted capacity, physical retention, or live-provider acceptance.

Final-source Vitest passed 193 files and 2,121 tests (two files and 46 tests skipped); `artifacts/final-fix/unit-final.stdout.log` SHA-256 `440bde67fddc9eed45f02c768fe67d649a8e33a4820f3ca4fbbfa52963bc6a6b`. Typecheck, lint (seven reviewed warnings), Next/Vinext builds, compiled provider and iCloud checks, dynamic-route and production safety checks passed locally. The targeted two-browser stop and cross-tab dialog suite passed 16 cases. A later full diagnostic run passed 143 cases but lacked complete raw capture. The final captured standard full browser run **failed**: 141 passed, two Firefox failures. Guest/account isolation exhausted the overall 30-second test budget during a hosted assignments navigation; optional onboarding timed out its five-second heading assertion while a settings request lacked a completed response. Their causes remain unproven; traces and the full logs are under `artifacts/final-fix/browser-settled-results` and `browser-settled.stdout.log` / `browser-settled.stderr.log` (SHA-256 `f23d5e8a0b2a279785119508de6631504bbe3b4ed881e8e7df555664ed6fc199` / `09dcc250600c63c1107bd2a0364a74036ec7777f2680096673e37fd7fc25ccf5`). An earlier full run's complete log and traces were overwritten and are unavailable; its failure counts and diagnoses are recorded in the local fix report, not reconstructed. At that point no test timeout or product deadline had been increased.

A subsequent test-only commit `3495428` gave the same-context isolation journey a 90-second overall budget while retaining 30-second navigation/action caps and five-second assertions; it also added a Continue-response prerequisite. The focused two-browser run passed four cases. The next captured full browser run, on `3495428`, still **failed** with 141 passed and two Firefox failures: the isolation journey reached its overall 90-second budget during its final guest navigation, and optional onboarding did not show the Firefox step within the existing five-second assertion. Captured stdout/stderr SHA-256 values are `8194f097f14438a116edcd7598b35e0b5a129df1f23046397d08e3b68b8e3d6b` / `af079f6936eb7f6c0bae42f3400b4b24709d30ac30c5817029c94ca9d427f89d`, with unique traces under `artifacts/final-fix/browser-accepted-results`. The focused isolation run passed in 12.7 seconds, but its success trace was not retained. The cause of the full-run delay is not established. No product or provider deadline changed.

The Continue operation sends multiple onboarding PATCHes. Test-only commit `6990ba4` corrects the response predicate to require the actual `visit` command for the Firefox step, rather than the earlier draft-save PATCH. Its two-browser focused recheck passed, but **no full browser suite has been run on that final test-only commit**. The native receipt and compiled build measured clean runtime commit `db8c0c0`; later commits `99c0ce1`, `3495428`, and `6990ba4` changed documentation or tests only. All 120 native input hashes were rechecked after the test changes. Scoped review and all external gates remain OPEN.

Test-only commit `44b562b` replaces the single 90-second isolation ceiling with six sequential 30-second workflow steps and a derived 180-second outer ceiling, keeping the original same page/context, actions, assertions, request seal and order. This is a real total timing relaxation, not evidence of normal user latency or a performance fix. The focused traced run passed both browsers; phase durations ranged from 0.911 to 10.035 seconds in Chromium and 1.194 to 2.089 seconds in Firefox. A subsequent captured standard full browser run on `44b562b` **failed** with 141 passed and two Firefox failures: the cross-tab assignments/reset and optional-onboarding journeys each exhausted their 30-second overall test budget. The isolation journey passed in both browsers. Full stdout/stderr SHA-256: `51e1e17b65bd61b20ed903d102452a692ef84dd5e3cfebeb63bc47971da1e009` / `aff6ee22af6fef69d80c983558a26a305e32f7c0081e902e096b6c7fd016319b`; traces are under `artifacts/final-fix/browser-phase-full-results`. These failures remain open and their causes are not established. Scoped re-review has not yet occurred.

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

Controller A3 task review, whole-branch review and the scoped fix re-review are
accepted for implementation behind the disabled flag. The reviews triaged the
retained observations in the ignored SDD
`progress.md`: conservative Canvas `BEGIN:VEVENT` substring false positives,
native cancellation observation coverage, script/render/network/auth/eval/color/
build/compatibility/strict-mode/lint diagnostics, and the narrower upload detector.
The U1 registry-lifetime observation has reviewed per-run ownership evidence;
A1 fixed delayed verification revival, one-time disconnect focus and post-reset
hydration. Preserve those dispositions and their failure traces; do not silently
drop them or infer a release approval from implementation review.

## Operator-controlled release sequence — not executed

1. Freeze the reviewed revision and retain the observation dispositions. Obtain
   exact-source Linux CI and retain receipt hashes.
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
| Controller task, whole-branch and scoped fix reviews | **ACCEPTED behind disabled flag** |
| Exact integrated-source Linux CI | **OPEN** |
| Hosted CPU / shared-isolate memory / deployed D1 billing capacity | **OPEN** |
| Cleanup capacity, physical retention bound and live deletion evidence | **OPEN** |
| Real Canvas, Gradescope, Ed operator acceptance and ingress review | **OPEN** |
| Exact production candidate checks and final deployment/activation approval | **OPEN** |

See [capacity evidence and its measurement limits](guest-capacity-readiness.md)
for native D1 accounting and the historical published Free-plan constraints.
