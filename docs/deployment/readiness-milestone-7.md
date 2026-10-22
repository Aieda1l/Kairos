# Milestone 7 release readiness

STATUS: INCOMPLETE

Milestone 7 is deployed. Source `7c81b9496f05863b7394b37aeab80b7247b95ecb` ([PR #34](https://github.com/Aieda1l/Kairos/pull/34)) is deployed as Worker `119dd545-d984-4ce8-9cf9-5d950d0ef8fa` at 100%, deployment `fee6419a-3bf0-40dc-b9f6-31edc466f566`. [Exact-main CI](https://github.com/Aieda1l/Kairos/actions/runs/39727248519) passed 1,621 tests and 63 browser cases. The clean 339-file archive passed 12 compiled provider/session cases and native provider/bridge lifetime checks; its graph is `4637c95214ac5f37ff7732fc9dc7eb1df665a2052ac676bb6ff093b5a1c9e677`. Staged/promoted schema-7, configuration, binding names, logging-off, isolation and health checks passed, followed by all 11 public smokes and served-client hash verification. No schema, key, logging or billing change was made.

The reconnect repair enables an inactive iCloud destination only after fresh credentials validate writable access to its saved calendar. The earlier operation is still uncertain and the disconnected metadata is still absent: preparation is not live recovery. The private preservation tool passed 22 planner/SQL cases, eight complete private-input/REST-adapter flows and four native workerd/D1 transaction cases, including rollback and replay rejection. The shared read-only parser/checker passed 20 cases including private PowerShell handoff and truncated-XML rejection; the latter was reproduced before adding XML validation. It is ready to restore inactive metadata from a fresh Apple inventory while preserving every remote event; fresh authorization in Kairos and a hosted sync remain required. No iCloud event deletion or owner recovery has occurred. Duplicate cleanup is a separate explicit choice. See the [recovery record](icloud-recovery-2026-10-22.md). Broad beta acceptance remains incomplete; Guest mode follows M7.

Calendar destinations now use separate invocations on Workers Free; no paid plan was enabled. A live synthetic 77-assignment replay passed with 29 Google / 45 Microsoft external requests on first sync and 18 each on repeat. Both provider controls are open. The operator confirms Google reconnect and sync now work. Read-only production verification at 22:29 UTC on `6db7487` records successful Google and Microsoft syncs, one credential and 17 mappings each, and idle owners. The [Google reconnect follow-up](google-calendar-rejection-2026-10-21.md#production-acceptance-confirmed) is resolved for that basic flow; current iCloud and remaining provider/two-account assertions stay open. These results do not establish representative Free CPU headroom.

The [stored-log privacy assessment](log-privacy-2026-10-21.md) is complete. All 36 targeted privacy tests pass and the local/live probes distinguish application redaction from platform behavior. Operator-supplied stored records expose synthetic uncaught exception/D1 table text and request paths. The result requires production persistence to remain disabled; the temporary Worker/database are deleted and verified absent. No production logging change was made.

## Historical reviewed baseline

The following engineering baseline is verified at published source `72a5b2a`, including [successful exact-head CI](https://github.com/Aieda1l/Kairos/actions/runs/38710892824). Final disclosure/integration changes receive their own CI; this baseline does not waive resulting-main verification.

| Check | Result |
| --- | --- |
| Full Vitest suite | 1,475 tests in 149 files passed |
| Chromium and Firefox | Exact 72a5b2a CI passed 54 cases; local 53/54 timeout and unchanged isolated pass remain attributed |
| Offline deployment workflow | 30 simulations passed; 16 health activation cases also pass |
| Typecheck and lint | Passed; zero lint errors, six existing warnings |
| Next compatibility build | Exact 72a5b2a CI passed; feature CI repeats this build for each published head |
| Workers build and dynamic dashboard verifier | Passed |
| D1 migrations and production safety | Passed locally |
| Native workerd | Fresh compiled preview probe: nine rejected requests and three health reads; prior admission/ownership, six keyring and offline Canvas checks retained |
| Extension lint | Zero errors/warnings/notices; submitted 0.4.0 ZIP hashes unchanged |
| Published Firefox 0.4.0 | Signed artifact matches reviewed payloads; ordinary install/native consent/source reads operator-confirmed |
| Timezone diagnostic | Identical native workerd outputs, bounded 128-zone cache; 86.072 to 13.303 ms median local repeated-helper wall time |

Simulations execute actual YAML shell commands and release CLIs with cloud/package commands and fetch mocked. They cover missing/failed/stale/pending CI, non-main dispatch, build/upload/metadata/staged-health/isolation failures, wrong bindings/release/secret configuration, logging, migration failure, between-phase traffic/schema/configuration drift, failed promotion after migration, post-promotion health failure and exact-version promotion. Applied schema survives partial releases; no automatic rollback is invented. Mock cloud state is distinct from the actual local migration-preservation checks. The native preview probe rebundles the compiled Worker for Miniflare with synthetic D1 and an ASSETS stub; it does not establish actual Cloudflare ingress/configuration or provider acceptance.

The optional live-provider probe cannot succeed with external networking disabled; its supported canvas-only mode passed. Vinext's checker exits zero but reports 92% compatibility, including its generic NextAuth warning and partial App Router strict-mode support. It is not a clean compatibility certification; real M7 identity/provider acceptance remains required.

## Reviewed commits

- **28e3e93:** retain saved calendar preferences after sync failure and prevent delayed initial reads from overwriting edits.
- **7738397:** exact-main CI, build before mutation, immutable staged-version health, exact promotion, isolated status authority and ZIP-safe lint.
- **822055b:** local bindings plus actual loopback request/port for every fixture endpoint.
- **907dd59:** split route-guard and optional-setup journeys without dropping assertions.
- **064681a:** reject expired database sessions before OAuth linking. Both provider regressions failed before the fix and pass afterward; valid-session linking remains intact.
- **4530cee:** partial promotion and post-promotion health failure simulations.
- **9401d79:** Sync All origin middleware and a matcher regression covering every non-fixture mutating API namespace.
- **32fca25:** health checks require explicit activation, with exact-value shell checks before work.
- **0fa7090:** URL-authoritative Workers.dev health-only admission, account-bound preview URLs and live baseline/configuration/migration checks before successive release mutations. Independent scoped follow-up review accepted the changes without remaining findings.
- **55afdb9:** bounded reuse of successful timezone validation, regression coverage and native local correctness/performance replay. Production CPU headroom remains open.

Independent source reviews accepted the fixes. The frozen-base audit now validates **151 terminal coverage units and 17 records**: 131 covered units, 20 assessed candidate traces and zero blocked units. The three former D1 policy blocks were closed using attributed owner access/copy/key facts and the reviewed owner-only restore/deletion policy, with distinct assessor, post-wave and final-clean reviews. Original reports/assignments are archived; unchanged Linux validators pass. The frozen source/report ref remains `0cc3e3d` (application checkpoint 9401d79); later release/cache/disclosure reviews remain separately attributed. All 17 records are fixed/refuted; no unresolved Critical/Important source finding is asserted. This is not a live restore or production-readiness go. See [security review](security-review-milestone-7.md).

## Historical publication and access evidence

The operator reports Google branding fully approved after review and two Kairos accounts tested with apparently successful results. Mozilla has published signed 0.4.0, independently checked against the reviewed packet, and the operator confirms normal store installation, native consent and Canvas/Gradescope reads. The onboarding source links the verified listing. A fresh public API check confirms the operator's description/privacy-link/homepage update and a support link to the homepage. The dedicated privacy-policy API field remains null, without reopening the functional public-disclosure task. Criterion 8 is satisfied by signed installability; an actual version upgrade is a follow-up for the next legitimate release. See [publication evidence](firefox-0.4.0-publication.md). The account smoke has no specified revision/per-flow assertions and does not establish exact-release hosted acceptance.

Historical preflight: [production preflight and release proposal](preflight-milestone-7.md) records the earlier identity/schema, four legacy bridge records, recovery bookmark and sampled usage. The operator confirms possession of the original encryption key, sole export/restore authority, Workers Free and Pseudo IPv4 Off. Its CPU quantiles (29.362 ms P50 / 251.633 ms P99) predate subsequent optimization/split releases and do not measure current headroom. The former combined-request overflow was addressed by separate calendar invocations; current representative CPU, query/cleanup cost and backlog measurements remain open. No paid change was made.

## Remaining gates

1. Preserve the stored-log assessment's keep-disabled decision. Any future persistence proposal must filter platform metadata and uncaught framework/vendor errors, then repeat stored-record canaries; this is a condition on enabling logs, not an unfinished inspection.
2. Complete exact-release hosted acceptance with two independent accounts: public signup, non-UW identity, onboarding/returning routing, source fields/status, all three calendars, admission/duplicate-work behavior and cross-account isolation. Google reconnect/sync and Microsoft sync are confirmed for one account on `6db7487`; current iCloud and the remaining second-account/provider assertions stay open.
3. Verify real provider revocation, local disconnect and account deletion using a disposable account while preserving the second account. Existing primary data must not be deleted to simulate this gate.
4. Review final deployed website/listing/policy consistency. Signed Firefox 0.4.0 installation, AMO disclosures, contact delivery and operator-reported Google branding approval are recorded; a version upgrade belongs to the next legitimate extension release.
5. Establish representative current-release Free CPU headroom and intended maintenance activation/notification. The [October 21 continuation](hosted-acceptance-2026-10-21.md) records aggregate CPU pressure, a read-only cleanup/backlog measurement and operator-confirmed delivery of the new health workflow's failure notification followed by a successful normal run. Health notification delivery is closed; maintenance is separate.
6. Preserve the single-administrator/key/recovery model. Live compatible code rollback and forward restoration already passed schema/configuration/health checks on October 15; authenticated/provider behavior during rollback remains unverified. Final security/readiness review consumes these remaining operational facts before any broad beta go.

The [23-condition checklist](acceptance-milestone-7.md) separates source tests, historical/operator reports and exact-release evidence. The approved M7 deployment has happened; passing release CI does not close the remaining acceptance rows.

## Execution record

Verification used the previously authorized pinned Linux sandbox: Node 22.23.3, matching Playwright browsers, no external network, empty allowlisted environment, unprivileged execution, read-only original input/toolchain/root, scratch-only writes and bounded resources/time. Next's temporary tooling copy preserved internal links; no application/Next configuration workaround was retained. Reviewers are source-only; ordinary parent test logs are not formal promoted audit execution evidence.

The publication/CPU local run initially exposed stale review-pending assertions in both projects, replaced by the exact published-link check. The next local full run passed 53/54, with an unchanged Firefox Canvas-replacement journey reaching its 30-second deadline during final rendering. It and an earlier empty-account navigation timeout passed individually unchanged; no assertions or deadlines were weakened. Exact-head 72a5b2a CI then passed all 54 cases. Both outcomes remain evidence. Six old unit assertions now execute Next's actual matcher rather than inspecting literal matcher-list entries. The 151-unit base audit remains historical; scoped follow-up reviews do not reissue it.

The publication/CPU continuation extends the real first-run browser journey to check the exact Mozilla install URL and safe new-tab attributes. A stale component assertion expecting review-pending copy was updated to assert the neutral optional state for an absent listing. Timezone regressions reproduce repeated native formatter construction before the cache and verify preserved errors/aliases plus eviction. The [local benchmark](monitoring.md#admission-measurements-and-release-handoff) supports the helper optimization, without closing production CPU headroom.

Ignored artifacts/task7c-6 contains detailed local evidence; audit-pointer.json locates the private full audit and readiness reports. The original checkout, developer database, M6 history and submitted extension packets are preserved.
