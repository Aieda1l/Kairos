# Milestone 7 release readiness

STATUS: INCOMPLETE

The reviewed release follow-up continues the base M7 review at **9401d79** and Milestone 6 tag 6a4f908. Engineering implementation is complete. M6 PR #14 is merged with history preserved as `4eb597e`; M7 PR #15 now targets protected `main`, with final integration/CI tracked there. The [engineering closeout and release boundary](closeout-milestone-7.md) records updated Mozilla disclosures, a locally verified recovery candidate and representative cleanup costs. No production upload, remote migration or traffic/operational activation occurred. Hosted acceptance, external security controls and Free CPU headroom remain open. Guest mode is a separate follow-up.

## Verified local work

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

## Latest operator update

The operator reports Google branding fully approved after review and two Kairos accounts tested with apparently successful results. Mozilla has published signed 0.4.0, independently checked against the reviewed packet, and the operator confirms normal store installation, native consent and Canvas/Gradescope reads. The onboarding source links the verified listing. A fresh public API check confirms the operator's description/privacy-link/homepage update and a support link to the homepage. The dedicated privacy-policy API field remains null, without reopening the functional public-disclosure task. Criterion 8 is satisfied by signed installability; an actual version upgrade is a follow-up for the next legitimate release. See [publication evidence](firefox-0.4.0-publication.md). The account smoke has no specified revision/per-flow assertions and does not establish exact-release hosted acceptance.

Operational follow-up: [production preflight and release proposal](preflight-milestone-7.md) records production identity/schema, four unconsumed legacy bridge records, a retrievable recovery bookmark and actual usage. The operator confirms possession of the original encryption key, sole export/restore authority, **Workers Free** and **Pseudo IPv4 Off**; the latter two were unreadable through the CLI and remain attributed to operator evidence. Production CPU quantiles of **29.362 ms P50 / 251.633 ms P99** exceed Free's nominal 10 ms budget despite zero sampled runtime invocation errors. Capacity requires investigation; no paid change is authorized. Effective IAM, historical deletion/restore, platform privacy and the remaining launch gates stay open.

## Remaining gates

1. Preserve the verified single-administrator and operator-attested no-D1-token/no-external-copy access model, original keys and reviewed deletion-safe recovery policy. Source-policy coverage is closed; a database restore remains a separate owner-only operation, not a prerequisite for ordinary code rollback. Verify the final exact-main CI/deployment chain and staged effective binding/ingress facts.
2. Complete stored platform/framework log privacy assessment, including vendor database-error logging. Persistent logs, invocation metadata and traces remain disabled.
3. After explicit approval, release the exact reviewed source and perform two-account hosted acceptance: identity/onboarding, sources, all three calendars, challenge/rate/duplicate-work behavior, revocation and deletion preserving the second account.
4. Release the reviewed public-policy corrections with M7 and confirm listing/website consistency. AMO disclosure and signed installation are verified; testing the next legitimate version upgrade is an extension follow-up, not an added criterion-8 blocker. Google branding is operator-confirmed approved; verify actual public calendar consent during hosted acceptance.
5. Investigate observed Free CPU pressure and establish representative M7 headroom, query/cleanup costs and backlog/retention; verify protected health/maintenance activation and success/failure delivery after approval. Earlier email receipt does not verify new workflows.
6. Exercise compatible live code rollback/forward restoration, preserving additive schema, required keys and unsettled ownership. The 4167dc2 recovery candidate is built and locally verified, but has not been uploaded or hosted-proven. Source integration and exact-main CI must precede release approval.

The [23-condition checklist](acceptance-milestone-7.md) separates local, historical/operator and exact-release evidence. Passing tests do not waive its remaining rows. Production deployment requires explicit approval.

## Execution record

Verification used the previously authorized pinned Linux sandbox: Node 22.23.3, matching Playwright browsers, no external network, empty allowlisted environment, unprivileged execution, read-only original input/toolchain/root, scratch-only writes and bounded resources/time. Next's temporary tooling copy preserved internal links; no application/Next configuration workaround was retained. Reviewers are source-only; ordinary parent test logs are not formal promoted audit execution evidence.

The publication/CPU local run initially exposed stale review-pending assertions in both projects, replaced by the exact published-link check. The next local full run passed 53/54, with an unchanged Firefox Canvas-replacement journey reaching its 30-second deadline during final rendering. It and an earlier empty-account navigation timeout passed individually unchanged; no assertions or deadlines were weakened. Exact-head 72a5b2a CI then passed all 54 cases. Both outcomes remain evidence. Six old unit assertions now execute Next's actual matcher rather than inspecting literal matcher-list entries. The 151-unit base audit remains historical; scoped follow-up reviews do not reissue it.

The publication/CPU continuation extends the real first-run browser journey to check the exact Mozilla install URL and safe new-tab attributes. A stale component assertion expecting review-pending copy was updated to assert the neutral optional state for an absent listing. Timezone regressions reproduce repeated native formatter construction before the cache and verify preserved errors/aliases plus eviction. The [local benchmark](monitoring.md#admission-measurements-and-release-handoff) supports the helper optimization, without closing production CPU headroom.

Ignored artifacts/task7c-6 contains detailed local evidence; audit-pointer.json locates the private full audit and readiness reports. The original checkout, developer database, M6 history and submitted extension packets are preserved.
