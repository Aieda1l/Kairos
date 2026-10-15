# Milestone 7 release readiness

STATUS: INCOMPLETE

The reviewed release follow-up is committed at **0fa7090**, continuing the base M7 review at **9401d79**, existing M7 work at 0cccc21 and Milestone 6 tag 6a4f908. The M7 branch is published as draft PR #15, stacked on draft M6 PR #14; GitHub safeguards are configured. Production runtime/data, release credentials and operational activation remain unchanged. External acceptance and the Free CPU investigation remain open. Guest mode is a separate follow-up.

## Verified local work

| Check | Result |
| --- | --- |
| Full Vitest suite | 1,472 tests in 149 files passed |
| Chromium and Firefox | 54 cases passed, including forged settings/Sync All requests |
| Offline deployment workflow | 30 simulations passed; 16 health activation cases also pass |
| Typecheck and lint | Passed; zero lint errors, six existing warnings |
| Next compatibility build | Passed in prior published 32fca25 CI; final published-head CI remains required |
| Workers build and dynamic dashboard verifier | Passed |
| D1 migrations and production safety | Passed locally |
| Native workerd | Fresh compiled preview probe: nine rejected requests and three health reads; prior admission/ownership, six keyring and offline Canvas checks retained |
| Extension lint | Zero errors/warnings/notices; submitted 0.4.0 ZIP hashes unchanged |

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

Independent source reviews accepted the fixes. The audit validates **151 coverage units and 17 candidate records**: 128 covered units, 20 with assessed candidate traces, and three external D1 backup/export/restore blocks. The 17 current-source paths are fixed or refuted; none remains a confirmed current-source finding. Distinct post-wave/final-clean critics found no remaining source assignment. Unmodified validators pass. Overall security/readiness stays INCOMPLETE for external evidence. See [security review](security-review-milestone-7.md).

## Latest operator update

The operator reports Google branding fully approved after review, Mozilla extension review still pending, and two Kairos accounts tested with apparently successful results. Record the account test as an operator-reported smoke pass; the tested revision, individual flows and cross-account assertions were not specified. This closes the reported branding-review wait, without establishing calendar-scope approval or exact-release hosted acceptance.

Operational follow-up: [production preflight and release proposal](preflight-milestone-7.md) records production identity/schema, four unconsumed legacy bridge records, a retrievable recovery bookmark and actual usage. The operator confirms possession of the original encryption key, sole export/restore authority, **Workers Free** and **Pseudo IPv4 Off**; the latter two were unreadable through the CLI and remain attributed to operator evidence. Production CPU quantiles of **29.362 ms P50 / 251.633 ms P99** exceed Free's nominal 10 ms budget despite zero sampled runtime invocation errors. Capacity requires investigation; no paid change is authorized. Effective IAM, historical deletion/restore, platform privacy and the remaining launch gates stay open.

## Remaining gates

1. Establish effective D1 backup/export permissions, historical deletion/retention, safe restore and key-retirement evidence beyond the operator's custody policy. GitHub main/environment protections are configured; verify their enforcement and the exact-main CI/deployment chain. Verify remaining production binding/ingress facts.
2. Complete stored platform/framework log privacy assessment, including vendor database-error logging. Persistent logs, invocation metadata and traces remain disabled.
3. After explicit approval, release the exact reviewed source and perform two-account hosted acceptance: identity/onboarding, sources, all three calendars, challenge/rate/duplicate-work behavior, revocation and deletion preserving the second account.
4. Verify the actual signed Firefox listing/artifact and normal install/update after Mozilla review. Google branding is operator-confirmed approved; establish any applicable separate calendar/data-access state during provider preflight.
5. Investigate observed Free CPU pressure and establish representative M7 headroom, query/cleanup costs and backlog/retention; verify protected health/maintenance activation and success/failure delivery after approval. Earlier email receipt does not verify new workflows.
6. Exercise compatible live rollback/forward restore, preserving additive schema, required keys and unsettled ownership. Reconcile onto reviewed protected main before release.

The [23-condition checklist](acceptance-milestone-7.md) separates local, historical/operator and exact-release evidence. Passing tests do not waive its remaining rows. Production deployment requires explicit approval.

## Execution record

Verification used the previously authorized pinned Linux sandbox: Node 22.23.3, matching Playwright browsers, no external network, empty allowlisted environment, unprivileged execution, read-only original input/toolchain/root, scratch-only writes and bounded resources/time. Next's temporary tooling copy preserved internal links; no application/Next configuration workaround was retained. Reviewers are source-only; ordinary parent test logs are not formal promoted audit execution evidence.

The latest browser run passed all 54 cases after one earlier Firefox page/context closure; the affected test also passed alone, without browser-test/assertion/deadline changes. Six old unit assertions inspected literal matcher-list entries; they now execute Next's actual matcher to preserve route-coverage checks under unconditional admission. The subsequent full suite passes. The 151-unit base audit remains historical; the release delta has a separate accepted source review and current engineering verification.

Ignored artifacts/task7c-6 contains detailed local evidence; audit-pointer.json locates the private full audit and readiness reports. The original checkout, developer database, M6 history and submitted extension packets are preserved.
