# Isolated guest diagnostic v8 — functional pass, Free CPU headroom open

The browser-parser/two-call candidate completed **22/22 physical requests and 13 logical flows**. All 21 protected app-table count/hash pairs were unchanged; 37 anonymous admissions and ten fixture operations were recorded. No identified admissions appeared. All four bounded metric captures completed, followed by confirmed cleanup and unchanged healthy production.

**Workers Free CPU headroom remains open.** The app's script/status cohort reports **15.475 ms P50 and 172.652 ms P99**, above the [published 10 ms Free allowance](https://developers.cloudflare.com/workers/platform/limits/). Request success does not establish dependable CPU allowance compliance: Cloudflare documents limited isolate flexibility for occasional overruns. The user retained Free as the target; no billing setting changed.

## Evidence identities

| Identity | Value |
|---|---|
| Run | `h1-free-browser-20261114-v8` |
| Application | `0a2e7a8af076380052cded94b940f1566341f113` |
| Committed driver | `71edbb5a5c85fa6b0f51f784247fd52c04540173` |
| Merged implementation | `3471ce894a9511290c9fb878674d3d19c8f1ea76` ([PR 62](https://github.com/Aieda1l/Kairos/pull/62)) |
| Offline package digest | `9465ae20ed3622a19f8bb1011dbb8699f765d953cddd06cdd3cd084a9e9af5b0` |
| Resolved package digest | `b0483bfcd1bdb0279fcdcdd120c31716ac8beb880f4c4ccab29dec856d8f62fb` |
| Reviewed operator packet | `d3953bf54a97a5f8f610700b8973098b3ecde527cf9299ec9d4dadc6ee68c6f9` |
| Hosted receipt SHA-256 | `a9e05e6caa5be2ef5acd2a330558e2788dd08655362b3b680d83d0efd2426d15` |

The actual receipt is retained locally at `artifacts/guest-hosted/hosted-free-browser-20261114-v8/receipt.json`; the reviewed operator inputs, attempt journal, cleanup records and qualified analysis are retained under the implementation's ignored evidence directory. The receipt separately identifies retained application/parser provenance and Node-simulated client projection. Normalized client output is not a fabricated HTTP response. Earlier local/native proofs and v3 observations retain their own identities.

Required implementation CI on exact main passed [run 43529467294](https://github.com/Aieda1l/Kairos/actions/runs/43529467294), following PR CI with 2,388 unit tests, 167 browser cases, both builds, 120 parser parity checks and 80 production worker-asset cases. This cloud diagnostic does not replace browser or real-provider acceptance.

## Workload and observation

The fixed window was **07:10–07:15 UTC on November 14, 2026**. Dispatch completed at **07:10:02.946–07:10:17.788 UTC**. The one scheduled metric capture began at window-end plus 120 seconds. No workload, mutation or analytics request was retried to obtain a preferred result.

The successful wire-v2 baseline returned 20 HTTP 200 responses plus the intended one 401 and one 403. Nine successful source reads each used a raw relay and a receipt approval call. Smoke and near-cap reads retained the existing source limits, parser/approval correlation and complete-result checks. The fixture served ten calls; the app recorded 37 new null-user admission rows and protected account-table digests stayed unchanged. Prior anonymous rows were preserved.

The independent read-only observer performed two metadata GETs and 50 SELECTs, reading **264 app rows and 20 fixture rows**, with **zero rows written**. Full protected-table count/hash comparisons passed. Raw row bodies, source content, capabilities, receipts and API credentials were excluded from evidence outputs.

## Qualified platform measurements

CPU fields were verified as microseconds and converted by dividing by 1,000. Memory fields are observed V8 isolate usage in bytes; values below use 1,048,576 bytes per MiB.

| Script/status cohort | Requests | Platform errors | CPU P50 | CPU P99 | Observed V8 P99 |
|---|---:|---:|---:|---:|---:|
| App / success | 22 | 0 | 15.475 ms | 172.652 ms | 35.268 MiB |
| Fixture / success | 10 | 0 | 2.976 ms | 4.884 ms | 23.583 MiB |

Platform invocation `success` includes the handled HTTP 401/403 cases; it does not mean every HTTP response was 2xx. Platform counts match the fixed workload, but sampling interval was not selected and complete ingestion is not independently established. These are mixed baseline script/status distributions, not route, individual request or cold/warm attribution. Quantiles are neither averaged nor subtracted. Fixture CPU is not subtracted from app CPU.

Observed memory is **not peak allocation**. Per-request CPU, route costs, peak memory, exact workload billing and complete ingestion remain null with reasons. The older v3 test used a different physical request mix and separate source/operator identities; this result does not establish a causal improvement or regression against its 13-request distribution.

Date-scoped D1 aggregates for the fresh databases include setup, fixture, observer and possible management effects:

| Database | Gross rows read | Gross rows written | Read queries | Write queries |
|---|---:|---:|---:|---:|
| App | 1,039 | 292 | 94 | 71 |
| Fixture | 41 | 19 | 4 | 18 |

These are not exact per-workload billing. Setup and observer metadata are recorded separately; there is no supported subtraction that accounts for every engine, management and interval effect. Net workload billing remains unmeasured. Daily Free capacity and a sustainable retention cadence are not established by one bounded baseline.

## Preparation corrections and cleanup

Earlier v4–v7 attempts stopped before diagnostic traffic and were consumed and cleaned. Their failures remain retained; they are not relabelled as successful measurements. Corrections addressed the script-level settings endpoint, the provider's declared nullable configuration after an acknowledged disable, opaque domain IDs, and immediate read-after-write readiness. V8 waited before checking the association, and its first readiness check passed. Bounded pending checks and absolute deadlines were reviewed and tested locally.

Both Workers' public ingress and disabled logging state were verified before traffic. The private fixture substitution remains trusted code rather than a platform egress sandbox. Only synthetic credentials/data were installed; API credentials stayed local and the observer used its separate read-only credential.

The exact temporary hostname association, both Workers, both databases and both restricted synthetic-secret files were removed and absence was confirmed. Production remained at the expected 100% active version and health returned HTTP 200. Authoritative/default DNS observations are retained with cache qualifications; they do not establish every resolver's state. No production deployment, real-provider action, guest activation, retention schedule or billing change occurred. This packet is **consumed and cleaned**, not permission to replay its names or traffic.

## Next work

Keep the existing data/source limits and Workers Free target. Assess the local profiles and compare complete guest journeys before selecting another optimization; local JS profiles are diagnostic evidence, not hosted CPU measurements. Further cloud tests require their own bounded authorization. Hosted retention/cadence, real-provider guest acceptance and the frozen deployment/activation decision remain the later release gates. A separately reviewed guest-off deployment can deliver merged UI fixes, including collapsible Upcoming sections, without enabling guest access.

A subsequent sealed local workerd profile captured six synthetic journeys, with sparse framework, native and crypto samples. A controlled high-reuse HMAC prototype saved about 12.7 microseconds per operation in local wall time, but did not establish a material whole-journey or hosted CPU benefit. No production key cache was added. Those private local reports retain their instrumentation and lifetime/rotation limitations; the remaining bottleneck is not yet attributed.
