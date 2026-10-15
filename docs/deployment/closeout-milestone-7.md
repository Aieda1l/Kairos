# Milestone 7 engineering closeout and release boundary

**Release acceptance is incomplete; a production sign-in defect is being repaired.** The approved [23 release criteria](../superpowers/specs/2026-10-06-public-beta-readiness-design.md#18-release-acceptance) include real hosted accounts, operational health, a production rollback and a final readiness go.

## Approved rollout and authentication repair, October 15

The operator explicitly approved the controlled rollout and confirmed prior M6 operations stopped and settled. PR #15 merged as `ead1ad29867caedc8be3ac08755d3545b19d3fd3`; its exact-main CI [passed](https://github.com/Aieda1l/Kairos/actions/runs/38791442235): 1,475 tests, 54 browser cases and the release/build checks. Migrations 0004–0007 were applied forward. Worker `1cdf69a7-a2db-4322-a4a1-557ca0c3cf94` was promoted, rolled back to compatible `ef7d30fc-56d0-44e0-a70b-8640106422b3`, then restored at 100% in deployment `04127153-95e0-4a05-8737-7b4256b02437`. Schema, effective bindings, preview isolation and canonical health were rechecked. An initial immediate canonical 404 is retained; subsequent checks passed without corrective mutation. Authenticated/provider behavior during rollback remains unverified.

Two legacy Canvas/Gradescope uncertain owners were recovered with exact-owner CAS after settlement, with provider controls paused and restored. All four legacy request records remain. No database export/restore, key retirement, API-token creation or paid-plan change occurred. Health monitoring was activated; the [synthetic notification failure](https://github.com/Aieda1l/Kairos/actions/runs/38797919565) ran as intended, but the [normal GitHub check](https://github.com/Aieda1l/Kairos/actions/runs/38798523603) received HTTP 403. Local canonical health remains 200. Notification receipt and the remote 403 require follow-up. Maintenance remains disabled without delegated credentials.

The operator then reported verification overlapping both identity buttons and `AUTH_CHALLENGE_UNAVAILABLE` after solving it. Native workerd reproduces two errors missed by mocked transports: calling `deps.fetchImpl` gives an incorrect receiver, and `redirect: "error"` is unsupported. The repair detaches fetch and uses manual redirects; every non-success response still fails closed. Compact widget dimensions reserve visible space above each button, including at 320px width. The new native CI probe covers both providers' success, rejection, hostname/action mismatch, upstream failure and redirects with no external requests. Before/after evidence: native cases failed before repair and all 12 pass afterward; both layout browser cases failed before reservation and all 24 sign-in browser cases now pass. Focused auth tests (95), project typecheck and scoped lint pass; independent source-only review accepts the delta. Protected exact-main CI and deployment of the repair, followed by real sign-in, remain required.

The sections below retain the earlier pre-release preparation as historical evidence; their approval-pending and undeployed descriptions are superseded by this rollout record.

## October 15 continuation

- M6 PR #14 merged with history preserved as `4eb597ea0a90555b09cec22564e2c8be4ca2bc17`. M7 PR #15 now targets protected `main`; its final source integration and resulting-main CI are recorded in that PR. Deployment is manual. Health and maintenance activation variables remain disabled/unset.
- Exact-source CI for `72a5b2a` passed 1,475 tests in 149 files, all 54 browser cases, native admission/ownership, migrations, Next/Workers builds, types/lint and safety checks. The current continuation changes disclosures and acceptance records, with focused public-page checks; final integrated CI remains required. Historical local Firefox timeouts are retained in readiness rather than relabeled as local passes.
- At 18:13 UTC, Mozilla's public API confirmed the updated description and full HTTPS privacy-policy link, homepage and support URL. The support URL points to the homepage. The separate privacy-policy field is null; the operator could not find that editor field. Public disclosure is checked by content and accessibility, not a particular Developer Hub layout. The signed 0.4.0 payload and ordinary Firefox installation/native consent/reads remain verified as attributed in the [publication record](firefox-0.4.0-publication.md).
- Acceptance criterion 8 requires a Mozilla-signed, installable release. It is satisfied. An actual version-to-version upgrade cannot be exercised with only one public version; retain it for the next legitimate extension release, rather than treating it as an additional M7 launch blocker.
- Public-page source now reflects saved setup/drafts, conditional Turnstile, actual bounded maintenance/retained ownership and confirmed contact delivery. Anonymous production checks at 18:31 UTC return 200 for home/privacy/support/security; the deployed M6 privacy/support copy still contains older unsigned/prepared wording. Reconcile those pages by releasing the reviewed source, not by claiming the website already changed.

## Prepared compatible recovery candidate

A disposable checkout of `4167dc2cc99e2dccc34b0b46cb754c485d2e7442` was built in the sealed Linux sandbox using the locked local dependencies. Its source tree is `245a7384fea760acb41df58f4e574b9559afe266`; migration, keyring and ownership source is unchanged through candidate `72a5b2a`.

| Evidence | Result |
| --- | --- |
| Workers build | Passed |
| Compiled native preview admission | Nine fixed rejections and three health reads passed |
| Migration preservation | Tenant FKs, existing/empty-user cutover, submission preferences and reapplication passed |
| Native keyring | Six checks passed |
| Independent native admission/ownership | Passed; six accepted/34 rejected in contention probe, no external requests |
| Compiled graph | 335 files, 3,746,883 bytes; manifest graph SHA-256 `5336efca8588adce77ee90c91b241a53a330851a982e6ddb964388e22926040d` |
| Retained local archive | SHA-256 `eddc256c76a74dddbff095100f1ecc8a55c4b133f68e5221c62687c072d21585` |

The archive and per-file manifest are private ignored artifacts under `artifacts/m7-closeout/`. This is a locally verified recovery **candidate**, not a deployed/hosted-proven fallback. Effective production bindings and required keys must be checked after an approved staged upload. This candidate predates the timezone optimization, so it does not establish CPU headroom. Never fall back to the current pre-M7 runtime after M7 ownership/admission work begins. No schema reversal, ownership release, key retirement or database restore is part of ordinary code rollback.

## Representative maintenance measurements

The actual `maintainAbuseState` helper ran against native local D1 with three bounded synthetic profiles, batches 1/25/100, dry runs and applies. Each profile included unexpired rows and an unconsumed legacy bridge. Retained profiles had running/uncertain owners; each run had two child steps. Every ownership/cooldown value, future row and legacy bridge was preserved.

The following batch-100 sweeps follow earlier batch-1 and batch-25 applies in the same fresh profile:

| Initial expired rows per category | Held owners | Deleted parents: rate/run/OAuth/bridge | Rows read | Rows written |
| --- | ---: | --- | ---: | ---: |
| 1,000 | 0 | 100 / 100 / 100 / 100 | 5,349 | 600 |
| 1,000 | 900 | 100 / 74 / 74 / 74 | 9,968 | 470 |
| 10,000 | 9,000 | 100 / 100 / 100 / 100 | 77,349 | 600 |

These counts cover four maintenance statements only. They exclude setup, EXPLAIN, validation, control/authentication/application work and production CPU. Dry batch-1 reads are 2,011 / 7,411 / 74,011 respectively, with zero writes. Query plans use expiry/ownership indexes; tied rate-event expiry values also require a temporary ordering tree. A parent-delete bound is not a read bound. If the largest observed sweep repeated hourly unchanged, arithmetic alone gives 1,856,376 reads/day before application work; this is not a production forecast. Compare real workload/backlog metrics against [current D1 allowances](https://developers.cloudflare.com/d1/platform/pricing/) before activation. Do not delete uncertain owners to reduce cost.

## Actual production controls and remaining actions

After the existing CLI authentication refreshed, read-only checks at 18:24 UTC confirmed the same production version `ac409786-d3ff-43ce-a35f-ba4a1d370e38` at 100%, deployment `d045e02a-3904-4d4c-a93f-856955821bc8`, migrations 0001–0003 and four unconsumed legacy bridge rows. The database reports 466,944 bytes; the metadata SELECT reports zero writes. All required secret binding **names** exist. Script observability is unconfigured, Logpush is false and no Tail consumers are attached. No secret values were fetched.

Account-member metadata at 18:28 UTC reports one accepted Super Administrator. Token inventory is unreadable through the CLI (403), but the operator subsequently explicitly confirms **no D1-access API tokens** and **no external database backups/exports**. That operator evidence closes the inventory questions without claiming API visibility. The operator retains the original key and sole export/restore authority; D1 Time Travel is the recovery source. Historical-deletion handling and an actual restoration remain separate evidence. No export or restore was performed. A fresh recovery bookmark is retained privately.

The analytics refresh returned a rate-budget error, including one reduced query after the documented wait. The earlier observed 29.362 ms P50 / 251.633 ms P99 remains historical M6 evidence; no new CPU measurement or M7 Free-headroom pass is claimed.

The original three external-policy audit assignments are now independently closed against these attributed facts and the owner-only deletion/restore/key policy. The frozen-base ledger is 131 covered plus 20 assessed candidate traces, zero blocked; unchanged coverage/findings validators pass. Original records remain archived, the original source ref is retained, and later deltas are separately reviewed. The production-readiness validator still returns INCOMPLETE because live release acceptance is not complete. This does not claim an actual database restore.

To finish release acceptance:

1. Preserve the recorded single-administrator/no-D1-token/no-external-export model, operator-only export/restore authority, original key and reviewed deletion-safe recovery policy. Keep log persistence disabled; its framework/platform review remains separate. A database restore is not required for the code-rollback acceptance test and remains a separately approved owner-only operation.
2. Establish an exclusive cutover window and settle/contain old M6 server/browser work; preserve the four legacy requests and uncertain ownership unless targeted recovery is separately justified.
3. Obtain explicit approval for the concrete reviewed production release, including additive migrations 0004–0007, staged candidate/fallback checks, traffic promotion and the controlled operator acceptance sequence. General instructions to finish M7 do not replace the earlier explicit production-approval requirement.
4. Verify actual identity/onboarding/source/calendar/account-isolation/revocation/deletion behavior, real challenge/budget behavior, M7 CPU/query headroom and compatible code rollback/forward restoration. Activate new health/maintenance separately only after prerequisites and approval; verify delivery and costs.
5. Complete the final security/readiness decision before broad public promotion. Guest mode remains after M7.
