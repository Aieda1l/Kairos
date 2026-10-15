# Milestone 7 release readiness

STATUS: INCOMPLETE

Local implementation and verification are complete at executable-source checkpoint **9401d79**, based on the existing M7 work at 0cccc21 and Milestone 6 tag 6a4f908. This continuation made local commits only: no production upload, migration, traffic change, workflow activation or publication occurred. External acceptance remains open. Guest mode is a separate follow-up.

## Verified local work

| Check | Result |
| --- | --- |
| Full Vitest suite | 1,433 tests in 148 files passed |
| Chromium and Firefox | 54 cases passed, including forged settings/Sync All requests |
| Offline deployment workflow | 18 simulations passed |
| Typecheck and lint | Passed; zero lint errors, six existing warnings |
| Next compatibility build | Passed with unchanged repository configuration |
| Workers build and dynamic dashboard verifier | Passed |
| D1 migrations and production safety | Passed locally |
| Native workerd | Admission/ownership, six keyring checks and offline Canvas fetch/redirect checks passed |
| Extension lint | Zero errors/warnings/notices; submitted 0.4.0 ZIP hashes unchanged |

Simulations execute actual YAML shell commands and release CLIs with cloud/package commands and fetch mocked. They cover missing/failed/stale/pending CI, non-main dispatch, build/upload/metadata/staged-health failures, migration failure, failed promotion after migration, post-promotion health failure and exact-version promotion. Applied schema survives partial releases; no automatic rollback is invented. Mock cloud state is distinct from the actual local migration-preservation checks.

The optional live-provider probe cannot succeed with external networking disabled; its supported canvas-only mode passed. Vinext's checker exits zero but reports 92% compatibility, including its generic NextAuth warning and partial App Router strict-mode support. It is not a clean compatibility certification; real M7 identity/provider acceptance remains required.

## Reviewed commits

- **28e3e93:** retain saved calendar preferences after sync failure and prevent delayed initial reads from overwriting edits.
- **7738397:** exact-main CI, build before mutation, immutable staged-version health, exact promotion, isolated status authority and ZIP-safe lint.
- **822055b:** local bindings plus actual loopback request/port for every fixture endpoint.
- **907dd59:** split route-guard and optional-setup journeys without dropping assertions.
- **064681a:** reject expired database sessions before OAuth linking. Both provider regressions failed before the fix and pass afterward; valid-session linking remains intact.
- **4530cee:** partial promotion and post-promotion health failure simulations.
- **9401d79:** Sync All origin middleware and a matcher regression covering every non-fixture mutating API namespace.

Independent source reviews accepted the fixes. The audit validates **151 coverage units and 17 candidate records**: 128 covered units, 20 with assessed candidate traces, and three external D1 backup/export/restore blocks. The 17 current-source paths are fixed or refuted; none remains a confirmed current-source finding. Distinct post-wave/final-clean critics found no remaining source assignment. Unmodified validators pass. Overall security/readiness stays INCOMPLETE for external evidence. See [security review](security-review-milestone-7.md).

## Remaining gates

1. Establish actual D1 backup/export permissions, historical deletion/retention, safe restore and key-retirement evidence. Verify production bindings, unsafe flags, ingress, protected-main/environment authority and the exact remote CI/deployment chain.
2. Complete stored platform/framework log privacy assessment, including vendor database-error logging. Persistent logs, invocation metadata and traces remain disabled.
3. After explicit approval, release the exact reviewed source and perform two-account hosted acceptance: identity/onboarding, sources, all three calendars, challenge/rate/duplicate-work behavior, revocation and deletion preserving the second account.
4. Verify the actual signed Firefox listing/artifact and normal install/update. Google/Mozilla outcomes were last reported unresolved; the user will provide updates.
5. Measure actual Free-plan headroom, CPU/errors/query costs and cleanup backlog/retention; verify protected health/maintenance activation and success/failure delivery. Earlier email receipt does not verify new workflows.
6. Exercise compatible live rollback/forward restore, preserving additive schema, required keys and unsettled ownership. Reconcile onto reviewed protected main before release.

The [23-condition checklist](acceptance-milestone-7.md) separates local, historical/operator and exact-release evidence. Passing tests do not waive its remaining rows. Production deployment requires explicit approval.

## Execution record

Verification used the previously authorized pinned Linux sandbox: Node 22.23.3, matching Playwright browsers, no external network, empty allowlisted environment, unprivileged execution, read-only original input/toolchain/root, scratch-only writes and bounded resources/time. Next's temporary tooling copy preserved internal links; no application/Next configuration workaround was retained. Reviewers are source-only; ordinary parent test logs are not formal promoted audit execution evidence.

Ignored artifacts/task7c-6 contains detailed local evidence; audit-pointer.json locates the private full audit and readiness reports. The original checkout, developer database, M6 history and submitted extension packets are preserved.
