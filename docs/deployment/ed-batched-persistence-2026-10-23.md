# Ed persistence batching — October 23, 2026 UTC

STATUS: DEPLOYED; LIVE ED CONFIRMATION PENDING

The operator approved batching Ed's database writes and an isolated comparison, then explicitly approved continuing with deployment despite the remaining Free CPU limit. [PR #46](https://github.com/Aieda1l/Kairos/pull/46) merged as `6e05463428869b08481dc577c7b8d3915d468018`. That source is deployed as Worker `b8f02ffe-aa73-493f-8c0a-ce23119d7db9` at 100%, deployment `f16b29a0-ebfc-4da7-a2ee-627d317b8924`, promoted at 21:55:06.783 UTC. The separate calendar-input candidate `ae65f68` is not included.

## Change and compatibility

Hosted Ed persistence now uses ordered chunks of at most 100 assignments. Each chunk atomically counts new external IDs, upserts assignment metadata, and joins submission statuses to those assignments. The complete Ed assignment list is no longer hydrated merely to recover local IDs. Existing prepared-statement helpers retain user/source/owner-nonce/provider-version fences. Normalized metadata/status payloads are validated against a 1,000,000-byte UTF-8 bound before the first assignment-data batch, leaving headroom for generated IDs; this is a per-string bound, not a combined-batch size claim.

Input order and duplicates retain the old behavior: the last metadata occurrence wins, while the first status at the shared checked-at timestamp wins. Metadata still refreshes when an equal/newer saved status prevents status replacement. Successful empty courses count toward freshness, failed-course data is retained, and all-failed runs preserve prior successful freshness. Atomicity is per chunk; an earlier complete chunk can remain after a later failure. Fetching, timestamps, client recovery state, public result fields, the legacy path and post-source calendar behavior are unchanged.

## Correctness verification

The initial real SQLite hosted suite had four expected call-count failures and nine passing semantic cases against the old implementation. The 42-row old path used 230 service calls; 101 and 201 rows used 525 and 1,025 calls. After implementation, the expanded suite passes 25 cases covering inserts/repeats, chunking, duplicate ordering across a chunk boundary, equal/newer saved statuses, empty/partial/all-failed results, tenant/source isolation, rollback, oversized UTF-8 payload prevalidation, pause/nonce changes and malformed D1 results.

Full local Vitest passed 1,687 tests with 46 existing Windows platform skips. Lint has zero errors and six existing warnings; typecheck and the Workers build passed. Independent review found no correctness issue. The review also confirms fixed active-owner bind counts of 3, 11 and 9 per statement, all below the 100-parameter limit. Native workerd checks passed 17 cases per version, including real session renewal/revocation, origin/auth rejection, tenant isolation, provider pause, retained uncertainty, cooldown, stale prepared-owner fencing and the default source rate limit.

The prior local compatibility attempt encountered the external dependency junction and then the existing Next security-upgrade advisory after compilation. No dependency or configuration workaround is included. Subsequent [exact-head CI](https://github.com/Aieda1l/Kairos/actions/runs/39973986317) and [exact-main push CI](https://github.com/Aieda1l/Kairos/actions/runs/39975212286) passed all 1,733 tests and 63 browser cases, including compatibility, Workers builds, compiled providers, migrations, lifetime and production-safety checks. The first main attempt was cancelled during slow Ubuntu package downloads; the unchanged retry passed. No test or release gate was weakened.

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

## Production release and limited acceptance

The clean merged archive contains 597 regular tracked files and no private environment file. Its sealed 340-file compiled graph is `918dc6fc66a7edff925f919e82a416f49ecd1fe4bed64cea0e373e496696e020`. The archive repeated twelve compiled provider cases, five iCloud conditional-write cases and calendar/source/bridge lifetime checks with no real provider requests.

The existing schema-7 operator path checked exact CI, source, dependencies, graph, configuration and the seven applied migrations. No migration was needed or run. A paused pre-upload snapshot was preserved and refreshed before any upload; a transient read failure stopped that read-only pass safely. The uploaded version initially returned health 503, and was not promoted until read-only revalidation passed health, preview application isolation, configuration and schema. The same recorded UUID was then promoted and verified active with canonical health passing.

Fresh pre/post release checks retained scoped record counts and provider-control versions: one account, 82 assignments/statuses, three source connections, three calendar connections/credentials and 30 mappings. Sessions were excluded from equality-based retention. This checks scoped identities/counts and controls, not immutable coursework/credential contents. All six provider operation owners were idle; none was recovered or reset in this release.

Eleven anonymous auth/origin/fixture/public checks passed, as did five public pages/listing checks and four served-client hashes against the archive. The [normal production-health run](https://github.com/Aieda1l/Kairos/actions/runs/40030392152) passed. Logging, tracing and Logpush remain off; schema, keys, billing and provider controls are unchanged. The compatible schema-7 fallback is the preceding source `95b03ec951717154995dedd2ccccdb5e47d77f3c` / Worker `837d0679-90e3-46e8-9575-c78453b57902`; no live rollback is claimed for this release.

At 21:56 UTC, the new-release Ed baseline retained three enabled courses, 42 assignments/statuses and idle ownership. Its successful source timestamp was still historical, so it is not a new-code sync confirmation. A read-only observer is waiting for the operator's requested fresh Ed attempt. Live completion/latency and reliable Free CPU headroom remain open. Ed's sequential upstream course fetching and separate client recovery-state behavior are outside this persistence change.

Private detailed evidence remains in ignored `artifacts/ed-batched-persistence/`: source/dependency and bundle manifests, RED/GREEN/full-suite logs, native receipt `local-958bcff679.json`, hosted run `db3f819ef59b`, immutable API/journal receipts, exact-version CPU metrics, client wall analysis, cleanup and final verification.

Release archive, CI, seal, staged/promoted state, data/public/client/health checks and live Ed observation are separately retained in ignored `artifacts/ed-batching-release/`. Later documentation-only commits do not replace the deployed source revision above.
