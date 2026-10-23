# Ed persistence batching — October 23, 2026 UTC

STATUS: REVIEW CANDIDATE; NOT DEPLOYED

The operator approved batching Ed's database writes and an isolated comparison. This candidate is based on `907d416`, whose application source matches deployed `95b03ec951717154995dedd2ccccdb5e47d77f3c`. The separate calendar-input candidate `ae65f68` is not included. Production remains Worker `837d0679-90e3-46e8-9575-c78453b57902` at 100%.

## Change and compatibility

Hosted Ed persistence now uses ordered chunks of at most 100 assignments. Each chunk atomically counts new external IDs, upserts assignment metadata, and joins submission statuses to those assignments. The complete Ed assignment list is no longer hydrated merely to recover local IDs. Existing prepared-statement helpers retain user/source/owner-nonce/provider-version fences. All metadata/status JSON strings are validated against a 1,000,000-byte UTF-8 bound before the first assignment-data batch; this is a per-string bound, not a combined-batch size claim.

Input order and duplicates retain the old behavior: the last metadata occurrence wins, while the first status at the shared checked-at timestamp wins. Metadata still refreshes when an equal/newer saved status prevents status replacement. Successful empty courses count toward freshness, failed-course data is retained, and all-failed runs preserve prior successful freshness. Atomicity is per chunk; an earlier complete chunk can remain after a later failure. Fetching, timestamps, client recovery state, public result fields, the legacy path and post-source calendar behavior are unchanged.

## Correctness verification

The initial real SQLite hosted suite had four expected call-count failures and nine passing semantic cases against the old implementation. The 42-row old path used 230 service calls; 101 and 201 rows used 525 and 1,025 calls. After implementation, the expanded suite passes 25 cases covering inserts/repeats, chunking, duplicate ordering across a chunk boundary, equal/newer saved statuses, empty/partial/all-failed results, tenant/source isolation, rollback, oversized UTF-8 payload prevalidation, pause/nonce changes and malformed D1 results.

Full local Vitest passed 1,687 tests with 46 existing Windows platform skips. Lint has zero errors and six existing warnings; typecheck and the Workers build passed. Independent review found no correctness issue. The review also confirms fixed active-owner bind counts of 3, 11 and 9 per statement, all below the 100-parameter limit. Native workerd checks passed 17 cases per version, including real session renewal/revocation, origin/auth rejection, tenant isolation, provider pause, retained uncertainty, cooldown, stale prepared-owner fencing and the default source rate limit.

The Next compatibility build and full browser CI are separate release checks. The prior local compatibility attempt encountered the external dependency junction and then the existing Next security-upgrade advisory after compilation; no dependency or configuration workaround is included in this change. This record does not claim a new green compatibility or browser run.

## Hosted measurements

Two independent esbuild bundles use the archived baseline source and candidate source with identical installed NextAuth/Auth.js libraries and probe dependencies. Both call the actual session helper, user-scope validation, keyring parser and public `syncEdConnection`, including provider admission, ownership, credential decryption, Ed response parsing and persistence. Vinext's request shim and unused server-action contexts are supplied by the probe. This measures the authenticated service pipeline plus a synthetic fixture, **not the complete production router or automatic calendar synchronization**.

The immutable service-bound fixture returns 42 existing assignments from one course. Five isolated users contain 210 assignments and 210 status rows. No real Ed request or production database query was made. Separate warm-up/measurement users renew sessions before measurement and remain within the unchanged twelve-operation admission budget. A single additional baseline preflight completed successfully; all 29 sync requests, including 20 measured requests, succeeded with the expected results and required runtime UUIDs.

| Measured quantity | Baseline | Batched candidate |
| --- | ---: | ---: |
| SQL statements per authenticated sync | 232 | 24 |
| D1 binding calls per authenticated sync | 232 | 22 |
| Synthetic provider reads | 1 | 1 |
| CPU p50 | 124.638 ms | 19.625 ms |
| CPU p99 | 149.402 ms | 42.138 ms |
| Median client-observed response time | 7.940 s | 1.077 s |
| Client-observed response range | 7.495–11.133 s | 0.717–1.496 s |

The session-inclusive native counts add two reads to the service-only test counts. Both versions reported zero inserts, 42 metadata updates, 42 status updates, zero failed courses and no error. Assignment identities and semantic fingerprints were preserved, and all five operation owners settled idle.

The exact measurement window is **14:33:40–14:35:15 UTC**. One historical account query recovered ten successful requests and ten fixture subrequests for each exact deployed UUID, with zero invocation errors. Each successful HTTP response's runtime UUID also matched its deployment receipt. Deleted Workers were labeled `__unknown__`; old script-name filtering was not used. CPU microseconds were divided by 1,000. Client wall time is measured at the same local caller for each request and includes network/queue/wait time; it is not CPU time.

These are small controlled synthetic series. They demonstrate a substantial reduction for this workload, but do not establish real-provider latency, full-route performance, a guaranteed percentile, or reliable Free CPU headroom. The candidate median and tail remain above the documented 10 ms Free CPU allowance.

## Plan limits, cleanup and next decision

The operator confirmed Workers Free. The read-only subscription API returned 403, so no billing-plan verification was claimed. No billing setting changed. Cloudflare documents a Free limit of 50 D1 queries per invocation; the 24-statement candidate is below that published limit for this fixture. The 232-call baseline nevertheless completed here, so neither its success nor this experiment proves how that query limit was enforced or explains a historical production failure. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

All three temporary Workers and the new isolated D1 database were deleted. Four absence checks returned 404, and the production release/binding/logging fingerprints match preflight. Logs, traces and Logpush remained disabled. No production code, schema, provider control, key or billing change occurred.

The candidate is suitable for code/release review as a latency improvement; it must not be presented as completing Free-plan capacity acceptance. Existing CI/release checks and a live Ed verification remain necessary before a production outcome can be claimed. Ed's sequential upstream course fetching and the separate client recovery-state behavior are outside this persistence change.

Private detailed evidence remains in ignored `artifacts/ed-batched-persistence/`: source/dependency and bundle manifests, RED/GREEN/full-suite logs, native receipt `local-958bcff679.json`, hosted run `db3f819ef59b`, immutable API/journal receipts, exact-version CPU metrics, client wall analysis, cleanup and final verification.
