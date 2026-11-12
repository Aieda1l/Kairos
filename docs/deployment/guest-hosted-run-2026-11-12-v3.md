# Isolated guest response CPU diagnostic v3 — November 12, 2026

**Functional baseline passed; Free CPU headroom is not established.** The separately approved 13-request packet completed 13/13 requests. Package 1 remains complete; package 2 capacity and the operating decision remain OPEN. This result neither chooses a paid plan nor establishes a causal CPU improvement/regression against [v2](guest-hosted-run-2026-11-12-v2.md).

## Input identity and functional result

| Input | Recorded identity |
| --- | --- |
| Application revision | `43986463764dc301f1c267e8f8e352da8b85f5df` |
| Driver | `29c114b094a6813635b6512ee40e3d445352d288` |
| Merged main | `4c73ba4b7d14e2b75bbc74d8dbd8ba32d6c885e9` |
| Resolved package canonical SHA-256 | `3a58b377cf5e4e4974e18e5eba6a761190660602459e9397274fd05baee7bb78` |

All 21 protected application table digests are preserved. Anonymous admissions increase by 28; identified admissions stay zero. Ten fixture admissions match the fixed baseline. Prior-admission preservation passes against an empty hosted before-snapshot; this adds no nonempty preservation example beyond the separately attributed local/native proof. The [response validation increment](guest-response-validation.md) retains its own code, local and build evidence; historical receipts are not relabelled as proof of changed inputs.

## Sampled CPU and memory

The first returned app HTTP 200 cohort contains **11 records**, P50 **98.428 ms**, P99/maximum observed **426.396 ms**, versus the [published nominal Workers Free allowance](https://developers.cloudflare.com/workers/platform/limits/) of **10 ms**. CPU schema units are microseconds, converted to milliseconds by dividing by 1,000. Returned cohorts have sampleInterval 1 and report zero errors.

There are 13 returned app records, but their statuses are 11 HTTP 200, one 403 and one 404. The driver expects 11 HTTP 200, one 401 and one 403. The missing 401 and additional 404 remain unexplained; equal totals do not establish complete workload attribution. A later query after Worker deletion returned no app or fixture cohorts. It does not zero the retained first observations or prove stable/complete ingestion.

Maximum observed V8 isolate memory is **52,604,409 bytes**, approximately **50.167 MiB**. This is an observed sample, not global peak allocation; peak memory remains null. The fixture's ten-record first cohort separately reports P50 3.215 ms and maximum 5.412 ms. Fixture CPU cannot be subtracted from app CPU as an attribution method.

These are sampled script/status/HTTP aggregates, with no per-request trace, route or cold/warm attribution. The v2 cohorts/population differ, so comparing the two distributions establishes no causal improvement or regression from the response change. Fixture substitution/service-binding overhead retains its production-comparability limit. Free is user-attested; billing API access returned 403. Functional completion does not establish sustained nominal Free headroom, and this result makes no paid-plan mandate.

## D1 accounting and ingestion limits

Dispatch ran at **20:48:22.804–20:48:43.593 UTC**, inside the selected **[20:45,20:50 UTC)** window. The operator record confirms setup before the window and no subsequent operator target SQL other than the fixed observer SELECTs inside it.

| Store | Latest gross rows read / written | Observer rows read / written | Conditional arithmetic residual |
| --- | --- | --- | --- |
| App | 447 / 140 | 255 / 0 | 192 / 140 |
| Fixture | 40 / 10 | 20 / 0 | 20 / 10 |

The observer records two metadata GETs and 50 SELECTs, 275 rows read and zero written. The first D1 capture was incomplete: fixture gross reads were 12, below observer reads of 20, with only one recorded write. Its app gross reads were 446. Preserve that capture; do not derive net billing from it or clamp a negative residual to zero. The latest capture reports sampleInterval 1 and the gross totals above, but no independent ingestion watermark or management/internal contribution accounting is established. The residuals remain conditional aggregate arithmetic, not exact workload billing or per-request costs. Exact workload billing stays null. Five GraphQL requests were used in total.

## Cleanup and remaining decision

Both owned Workers, both databases, the hostname association and both restricted synthetic secret files were confirmed absent. Production baseline remained unchanged and health returned HTTP 200. Authoritative DNS returned ENOTFOUND at cleanup while the default recursive resolver still held a positive cache entry. A later default-resolver read at 20:59:32 UTC also returned ENOTFOUND. The cached answer was not a remaining owned association; no claim is made about every resolver worldwide.

No production deployment/mutation, real provider call, billing/paid-plan change, logging activation or public guest activation occurred. The saved record is a completed bounded diagnostic, not permission to reuse its identities or rerun it. Any new cloud packet requires its own fresh finite review and authorization.

After reviewing the result, the user selected **Workers Free as the guest v1 release target**. Next compare browser-side parsing with chunked server work while preserving existing data limits, safe errors and sync protections. A concrete processing design and operating envelope remain to be settled; no smaller feature limit or paid upgrade is assumed. The broader bounded failure/denial matrix, hosted retention/cadence, real guest-provider/lifecycle acceptance and frozen release/activation remain open. Completion after closing Kairos stays deferred; no new feature or gate is added by this result. See [capacity readiness](guest-capacity-readiness.md), [acceptance](guest-acceptance.md) and the [finish plan](../superpowers/plans/2026-11-12-guest-release-finish.md).
