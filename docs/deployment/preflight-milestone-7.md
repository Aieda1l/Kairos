# Milestone 7 production preflight and release proposal

Decision: **INCOMPLETE; production release is not authorized.** Operational preparation on October 14-15 Pacific continues the existing M7 source review at `9401d79`. Commit `32fca25` adds a health-workflow activation guard; **0fa7090** restricts Workers.dev access and enforces live configuration/schema checks. Fresh isolated verification passes **1,472 tests in 149 files**, **54 browser cases**, **30 release simulations**, types, lint (zero errors/six existing warnings), Workers build, dynamic-dashboard and safety checks. A native probe of the compiled Worker rebundled for Miniflare passes nine rejection cases and three health reads with synthetic D1/ASSETS, no credentials and sealed networking. Historical Next-build/base-audit evidence retains its checkpoint attribution; final-published-head CI remains required. See [current readiness](readiness-milestone-7.md).

## Confirmed state

Read-only Cloudflare checks at `2026-10-15T04:37Z`, refreshed at `07:46Z`, establish:

- Production Worker version `ac409786-d3ff-43ce-a35f-ba4a1d370e38` serves 100% of traffic under deployment `d045e02a-3904-4d4c-a93f-856955821bc8`, still the October 11 public-page release.
- The production database has migrations `0001` through `0003`; M7 migrations `0004` through `0007` remain unapplied. Database metadata reports 442,368 bytes.
- `DB` and all required M7 secret binding names exist. Names do not prove values, provider registration, key entropy or successful runtime validation. No secret values were retrieved.
- Canonical app/auth origins are `https://mykairos.me`; `nodejs_compat` is configured, fixture/local-auth bindings are absent, and the custom domain plus Workers.dev/version previews remain attached. The current M6 version has no explicit M7 trusted-ingress selector; verify the uploaded M7 version's effective bindings before any migration or promotion.
- Script-level observability is unconfigured (`null`); Logpush is false and there are no Tail consumers. This snapshot does not complete the stored platform/framework privacy assessment.
- Four unconsumed legacy bridge records remain: one Canvas submission, two Gradescope discovery and one Gradescope sync. Migration `0006` intentionally retains uncertainty for their owners; an expired record is not proof that its browser work stopped. No records were cleared or owners released.
- A current D1 Time Travel bookmark can be retrieved and is retained only in ignored private evidence. No database export or restore was performed.

The operator confirms possession of the original encryption key and sole authority to export/restore the database. This establishes the intended custody/authorization policy. It does not establish backup storage, effective IAM restrictions, historical-copy deletion handling, a successful restoration, or key-retirement compatibility. Keep exact key and recovery material private.

GitHub safeguards are now configured and read back:

- `main` still points to `d586222`; it requires a PR and up-to-date `kairos-feature-ci` from GitHub Actions, including for administrators. Force pushes and deletion are disabled. The sole-owner project does not require an impossible self-approved PR review; independent source-review evidence remains separate.
- The `production` environment requires approval by repository owner `Aieda1l`, disallows administrator bypass and permits only branch `main`. Self-review is allowed so the sole operator can approve a run they dispatch; no additional approver or agent identity is authorized.
- Repository/environment Actions secrets are empty. No deployment credential was created or transferred. Health and maintenance activation variables remain unset.
- [M6 PR #14](https://github.com/Aieda1l/Kairos/pull/14) remains an open draft. [M7 PR #15](https://github.com/Aieda1l/Kairos/pull/15) is a draft stacked on the M6 branch. Neither PR was merged. The feature workflow runs on the published M7 branch; resulting-main CI remains a separate release gate.

Both scheduled and manual health jobs now require opt-in, with a case-sensitive shell guard before checkout and before health/notification work. GitHub's expression comparisons are [case-insensitive](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions), so the job-level filter alone cannot establish exact casing. Independent follow-up review accepted the guard. Local simulations execute actual YAML commands with fetch replaced; they are not a live GitHub approval/unauthorized-ref exercise.

## Capacity observations and unreadable fields

For the completed UTC day October 14, account-wide aggregate metrics and the production Worker subset report 315 Worker requests, zero runtime invocation errors, and 597 subrequests. D1 account totals report 18,543 rows read and 975 rows written. Production CPU quantiles are **29.362 ms P50 and 251.633 ms P99**; GraphQL schema descriptions explicitly identify the raw units as microseconds. These describe the current M6 runtime and a small existing workload, not M7 capacity or HTTP success rates.

The API cannot read account subscriptions/plan or zone Pseudo IPv4 settings (HTTP 403), and no browser session is connected. The operator subsequently confirmed **Workers Free** and **Pseudo IPv4 Off**. Those two fields are operator evidence, distinct from API observations; `default_usage_model=standard` alone would not establish Free versus Paid.

[Cloudflare documents a 10 ms Free CPU limit](https://developers.cloudflare.com/workers/platform/limits/); the observed CPU quantiles exceed that nominal budget and require investigation before launch. [Rollover CPU can allow quantiles above the nominal limit without invocation errors](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), so zero errors does not prove adequate headroom. No plan upgrade or limit increase is authorized. Representative M7 CPU/query/cleanup measurements and a workload-specific decision remain open.

## Release safeguards added after preflight

The scoped independent follow-up review accepted these changes with no remaining findings:

- Every dynamic request reaches the proxy regardless of Host headers. Workers.dev requests permit only exact `GET /api/health` without a query; identity, onboarding, callbacks, fixtures and provider work return a fixed no-store 404. Platform-served static assets may remain public. Canonical/local requests retain their normal policies.
- The baseline CLI reads the approved current 100% Worker version and migrations `0001`-`0003` before any upload. It obtains the authenticated Cloudflare account's Workers subdomain; both upload URLs must match that namespace and the exact version/alias prefixes. Staged probes check both storage health and rejection of application paths.
- Before migration, the exact version's canonical URLs, D1 identity, required secret binding names, release SHA, trusted ingress, fixture/local exclusion, compatibility and disabled script logging must match the approved configuration, and the baseline must remain unchanged.
- After migration, the workflow requires exactly `0001`-`0007`, repeats version/configuration/active-traffic checks, then permits promotion. Unknown local migration files, drift, missing bindings, unexpected logging and partial migration results stop the workflow before its next mutation. Responses and deadlines are bounded; output contains fixed codes rather than raw provider material.

This workflow is deliberately the **initial M7 cutover**. A partial migration is preserved, and a later ordinary dispatch fails its initial `0001`-`0003` prerequisite. An operator must review and explicitly authorize recovery; never reset schema, keys or ownership to make the guard pass. Repeated checks are snapshots, not a transaction with Cloudflare: maintain an exclusive operator release window and stop if another actor changes release state.

## Proposed release sequence

1. Finish effective access/backup/retention controls, framework log privacy and the Free CPU investigation. Preserve the operator-confirmed Pseudo IPv4 Off state and establish remaining trusted-ingress assumptions. Prepare a private retention/restore decision that reapplies prior account deletions after restoration and retains every necessary credential key. A live database restore remains solely operator-authorized and outside ordinary code rollback.
2. Review and integrate M6 through its existing PR with history preserved, then retarget the M7 PR to `main` and review its final diff. Do not dispatch the older M6 deploy workflow. Keep both operational activation variables unset. Require successful feature CI for the exact resulting `main` SHA.
3. Prepare an independently verified M7-compatible recovery artifact/version, record its source/config identity and effective keys, and establish an exclusive controlled release window. Prevent new M6 provider work and establish settlement of prior server/browser activity before cutover; elapsed time alone is insufficient. If settlement or containment cannot be established, stop the release. The current pre-M7 production version is a pre-promotion traffic reference, **not** an acceptable fallback once M7 admission/ownership work is active. Until a compatible fallback exists, recovery planning remains incomplete.
4. Present the resulting SHA, verified compiled artifact identity, actual migration level, compatible fallback, handling of existing bridge uncertainty, required deployment-token scope and operator test sequence for **explicit production approval**. Any delegation of database access to CI must be approved under the operator's sole export/restore policy; no such token has been provisioned.
5. Only after approval, dispatch the guarded manual production workflow on the exact reviewed `main` SHA with `expected_active_version` set to the freshly approved current 100% version. Build before cloud mutation; verify the initial live baseline; upload without changing primary traffic; check immutable-version health/isolation and effective configuration; apply only approved forward migrations `0004`-`0007`; verify the complete migration result and unchanged traffic/configuration; promote only the exact checked version; verify production health. Read back the active version again before hosted acceptance. Stop on any discrepancy. No automatic retry/rollback or destructive schema reversal is proposed.
6. Complete the [hosted acceptance checklist](acceptance-milestone-7.md) against that exact release with the operator's two accounts and actual providers. Verify preserved data, new/returning onboarding, source/calendar behavior, account isolation, Turnstile/budgets/duplicate work and revocation/deletion. Settle legacy work privately before targeted owner recovery; retain uncertain ownership otherwise.
7. Under an approved recovery window, exercise compatible code rollback and forward restoration without reversing schema or retiring needed keys. Activate health and maintenance separately only after their prerequisites and explicit approval; confirm actual success/failure notification delivery and bounded cleanup costs.
8. Complete Mozilla signing/listing and ordinary Firefox installation/update after review. Google branding is operator-confirmed approved; verify any applicable separate calendar/data-access state. Close the final readiness decision only when the required external checks are satisfied. Guest mode stays after M7.

## Evidence and scope

Ignored `artifacts/m7-preflight/` holds sanitized Cloudflare metadata, a private recovery bookmark, test/lint logs, independent health reviews and GitHub configuration inputs. Exact account/database IDs, credentials, user rows and private provider data are excluded from this tracked proposal. Read-only queries fetched migration names and aggregate pending counts only. The existing full source audit remains historical evidence with external coverage gaps; operational snapshots do not silently convert those gaps into passes.

Preparation changed GitHub repository protection/environment settings and published a draft branch/PR. It did **not** upload a Worker, migrate or alter production user data, switch traffic, enable production workflows, rotate keys, export/restore D1, or publish the extension.
