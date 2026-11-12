# Isolated guest diagnostic v2 — November 12, 2026

**Result: functional baseline passed; CPU headroom remains OPEN.** The separately approved isolated run completed 13/13 application requests. This is neither a Free-capacity PASS nor a production deployment/activation decision. The [first run](guest-hosted-run-2026-11-12.md), which stopped before dispatch, remains historical evidence.

## Reproducible identity and functional result

| Input | Recorded identity |
| --- | --- |
| Application source | `85ded227d35fc46377cf48326f517e376b1ac435` |
| Driver | `636a5adc7fe062e874c94ba796f1b16c2112023d` |
| Resolved package canonical SHA-256 | `0ad34eacfa00f07c594e74c49503497e958c2bdd733803e7346c6b25424f426b` |
| Integrated source | PR [58](https://github.com/Aieda1l/Kairos/pull/58), merged main `fda5bad`, same tree as driver `636a5ad` |

The saved receipt records `passed / GUEST_DIAGNOSTIC_VALIDATED`, one dispatch attempt, exit 0, and 13 attempted/completed requests. Both complete snapshots contain 22 app tables; all 21 protected count/hash objects are unchanged. Anonymous admissions increase from zero to 28; identified admissions remain zero. Ten durable fixture admissions stay below the fixed caps. The prior-admission preservation check passes, but the hosted before-snapshot contains no admission rows: this adds no nonempty preservation example beyond the separately attributed local/native proof.

Package 1 compatibility, affected checks, required CI and independent review are complete and merged through PR 58. Exact reserved-table handling, literal SQLite-prefix matching, manifest-path checks and receipt input provenance retain their reviewed boundaries. Old H1/H2/native receipts are not relabelled as proof of changed inputs. See the [runbook](guest-hosted-test-package.md) for verification and finite fresh-packet preparation; these identities are evidence, not reusable cloud authorization.

## Observed CPU and memory

The saved schema describes CPU in microseconds. Dividing by 1,000 gives app HTTP 200 cohort P50 **55.689 ms**, P99/maximum observed **500.858 ms**, across **ten records**, versus Cloudflare's [published nominal Workers Free CPU allowance](https://developers.cloudflare.com/workers/platform/limits/) of **10 ms**. Two additional success-status records have HTTP 401 and 403: **12 available app records versus 13 completed driver requests** remains unexplained. Returned cohorts report zero errors and sampleInterval 1; this does not establish error absence for the unmatched request.

These are sampled script/status/HTTP aggregates, without route, per-request trace or cold/warm attribution. Functional success does not establish sustained 10 ms headroom. Fixture substitution and service-binding overhead differ from production provider work. The fixture script separately reports ten records, P50 4.847 ms and maximum 7.460 ms; subtracting fixture CPU from app CPU would not establish attribution. The billing subscription API returned 403; Workers Free is user-attested, not independently verified tier evidence. No billing plan changed, and no upgrade requirement follows from this result.

Maximum observed V8 isolate memory is **52,080,121 bytes**, approximately **49.667 MiB**. This is an observed invocation sample, not all-isolate peak allocation; peak memory remains null. An empty finer-detail query adds no route/startup attribution and does not negate the retained aggregates.

## D1 accounting

Dispatch ran at 14:17:27.277–14:17:48.743 UTC. The selected database window is **[2026-11-12 14:15, 14:20 UTC)**. Saved setup completion around 13:53 and deletion around 14:33 are outside it. Two saved captures agree and report sampleInterval 1.

| Store | Gross rows read / written | Observer rows read / written | Conditional arithmetic residual |
| --- | --- | --- | --- |
| App | 447 / 140 | 255 / 0 | 192 / 140 |
| Fixture | 40 / 10 | 20 / 0 | 20 / 10 |

The observer records two metadata GETs plus 50 SELECTs, 275 total rows read and zero written. The residuals subtract complete observer SQL metadata from the separate gross database totals. They are conditional aggregate arithmetic, **not exact workload billing or per-request attribution**. Complete ingestion and management-GET/internal cost effects are not independently established; stable captures and sampleInterval 1 do not prove completeness. Exact workload billing stays null. Setup, observer, fixture and teardown costs retain separate accounting boundaries; no speculative deduction is made.

## Cleanup and remaining decision

All two owned Workers, two owned databases, the hostname association and both restricted synthetic secret files were removed. A later read-only verification confirmed absence, DNS ENOTFOUND and production health HTTP 200. The saved operator ledger records production unchanged. No real provider calls, production mutations, billing changes or guest activation occurred. Five GraphQL requests were used within the bounded analytics allowance. The independent saved-results review accepts this qualified interpretation without an actionable arithmetic or evidence finding; it did not rerun the workload or attest new live state.

Package 2 now has a passing functional baseline and actual qualified CPU/memory/D1 observations. CPU headroom, the broader failure/denial matrix and operating decision remain open. Local CPU investigation can inform a separately reviewed next measurement packet; this record promises no optimization result or new cloud action. Hosted retention/cadence, real Canvas/Gradescope/Ed and lifecycle acceptance, and a concrete frozen release/activation decision remain open. Completion after closing Kairos remains user-deferred. See [capacity readiness](guest-capacity-readiness.md), [acceptance](guest-acceptance.md) and the [finish plan](../superpowers/plans/2026-11-12-guest-release-finish.md).
