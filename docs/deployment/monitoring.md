# Production monitoring

Current October 21 status: M7 application source `f33c240` is deployed; the [normal main health workflow](https://github.com/Aieda1l/Kairos/actions/runs/39656590873) passes with monitoring enabled. The [stored-log assessment](log-privacy-2026-10-21.md) found raw synthetic exception/D1 text and request paths in Cloudflare's persisted platform envelope; production persistence remains disabled. Calendar destinations run separately on Workers Free. Representative CPU headroom and delivery of the new workflow's failure notification remain open.

Kairos's public check is GET https://mykairos.me/api/health. It executes only `SELECT 1 AS ok`, without authentication, session, user, or credential queries. It returns200 `{"status":"ok"}` or503 `{"status":"unavailable"}`, always no-store. Its three-second deadline limits response time; it does not claim to cancel a D1 query. This checks basic storage availability, not provider credentials, user-table quota headroom, full application behavior, or launch readiness.

The standalone `node scripts/check-production-health.mjs` accepts only `https://mykairos.me`, refuses redirects, uses a ten-second total deadline, limits body reading to256 bytes, and accepts only the exact healthy object. It identifies itself as Kairos-Health and retries once only after HTTP 403 with Cloudflare's `cf-mitigated: challenge` header. Both requests share the same deadline. A second challenge, ordinary HTTP error, invalid payload or timeout fails the check. Its logs contain fixed code/status and no response body or addressing. A nonzero exit fails the check. No dependency installation or production credential is needed.

`.github/workflows/production-health.yml` schedules it every15 minutes and permits manual runs, with read-only repository permissions and one concurrent check. Both paths require `main` and the repository variable `KAIROS_HEALTH_ENABLED=true`. Deployment and activation were approved and completed; a fresh installation must leave the variable unset until those prerequisites are met. GitHub schedules can be delayed; this is a periodic check, not a guaranteed uptime or delivery SLA. Deployment remains manual, preserves remote variables, records the public Git revision as KAIROS_RELEASE_ID, and runs the health smoke afterward. Automation promotion requires the rollback drill and all release gates.

## Operator and delivery evidence

### October 20 health-check repair

A bounded [GitHub-runner diagnostic](https://github.com/Aieda1l/Kairos/actions/runs/39482186591) reproduced HTTP 403 with a Cloudflare challenge for the default Node User-Agent. A subsequent identified request returned HTTP 200, but the [normal workflow after integration](https://github.com/Aieda1l/Kairos/actions/runs/39484561530) still failed with 403. The initial User-Agent-only change was insufficient; the first comparison did not isolate the header as the cause.

### October 21 UTC transient challenge recovery

Further [fresh-runner diagnostics](https://github.com/Aieda1l/Kairos/actions/runs/39550624320) confirmed the first request receives HTTP 403 with `cf-mitigated: challenge`, while subsequent identified requests return the exact healthy response. The checker now cancels that challenge body and makes at most one identical recheck within its original total deadline. It does not solve challenges, send credentials, change edge rules, retry ordinary errors or accept a challenge as healthy. The particular Cloudflare rule remains inaccessible to the current API credentials.

The actual checker passed on [three separate fresh GitHub runners](https://github.com/Aieda1l/Kairos/actions/runs/39550807707). Regression tests cover recovery, two challenges, ordinary HTTP failures, invalid retry payloads and the shared timeout. The temporary diagnostic workflow is removed from the final change. The [normal main workflow after release](https://github.com/Aieda1l/Kairos/actions/runs/39645991114) also passed on `5547ff1`; an ongoing challenge that blocks both attempts remains an alert requiring edge investigation.

The monitored destination is the operator's Cloudflare account inbox previously selected for support@mykairos.me/security@mykairos.me. Both separate inbound alias tests arrived (operator confirmation). This does not prove Cloudflare alert or GitHub workflow notification delivery. Do not publish the private destination address or account identifiers.

In Cloudflare, use **Alerts → Overview** to inspect available types and destinations, then **Test** to confirm arrival. Product/plan-specific usage alerts may be unavailable; record exactly what the account offers. A Workers Free plan and a domain Free plan are distinct. In GitHub **Settings → Notifications → System → Actions**, enable email and failed-workflow notifications. Confirm the recipient is monitored. Scheduled notifications follow the workflow creator, cron editor, or re-enabler; repository watching alone is insufficient proof.

After this workflow is available, run it manually with `exercise_failure=true`. Expect a failed job with HEALTH_NOTIFICATION_TEST and verify actual delivery to the monitored recipient. Run again with the defaultfalse after the health endpoint is deployed to confirm success. Record run links and delivery outcomes without inbox/account details. The synthetic failure does not alter the Worker or database. Avoid repeatedly running failure exercises after delivery is confirmed.

| Evidence as of2026-10-13 | Status |
| --- | --- |
| Workers plan | Free, operator reported; actual dashboard capacity measurements pending |
| Support/security forwarding | Both actual messages arrived |
| Cloudflare notification delivery | Operator confirms working |
| Specific Workers/D1 usage alert types | Not specified |
| Existing GitHub failure notifications | Operator confirms working |
| Production health endpoint/cron activation | Pending reviewed release; source files alone are not operational evidence |
| Complete stored-log/framework privacy | Not verified; persistence remains off |

The operator confirmed on2026-10-13 that **both alerts/email notifications work**. Cloudflare and GitHub notification delivery/configuration are operator-confirmed working. This does not establish activation or delivery from the new unpublished health workflow; its post-release exercise remains a separate check.

## Daily capacity review

Review Cloudflare **Workers & Pages → kairos-production → Metrics** for requests, CPU distributions, error/invocation outcomes, and subrequests. Review **D1 → production database → Metrics/Analytics** for rows read/written and storage. Use the dashboard's actual daily UTC windows and account-wide totals. Record sanitized aggregate measurements and timestamp; never export user tables for capacity measurement.

The operator reports Workers Free. The Workers limits distinguish 50 external subrequests from 1,000 internal Cloudflare-service subrequests per invocation; network/database waiting is not CPU. D1's limits page still lists 50 Free queries per invocation, while an isolated live account probe completed 120. This documented discrepancy is recorded in the [capacity investigation](calendar-capacity-2026-10-21.md); do not treat a synthetic 50-statement bound as proof of a platform failure. Daily row-read/write allowances must be checked against current pricing/dashboard rather than inferred from successful `SELECT 1`.

Free reference thresholds, originally verified against the linked primary documentation on2026-10-13 (not current utilization measurements):

| Metric | Free allowance |70% investigation|90% escalation|
| --- | ---: | ---: | ---: |
| Worker requests, daily account total |100,000|70,000|90,000|
| D1 rows read, daily |5,000,000|3,500,000|4,500,000|
| D1 rows written, daily |100,000|70,000|90,000|
| Database storage |500MB|350MB|450MB|
| Account D1 storage |5GB|3.5GB|4.5GB|
| CPU per request |10ms|7ms|9ms|
| External subrequests per invocation |50|35|45|

These are reference calculations, not current utilization measurements. Verify dashboard units/plan changes before applying them; daily D1 allowances reset at00:00 UTC. Once a Free daily D1 read/write limit is reached, queries may fail until reset or an authorized plan change. Health success does not replace those metrics or a representative workload check.

For each request/read/write/storage daily allowance, calculate70% and90% of the actual plan limit. At70%, identify the source of growth, inspect query/index efficiency and request sizes, reduce optional repeated work through the existing operator controls, and increase review frequency. At90%, pause affected provider work, preserve reads/logout/local disconnect/deletion, inspect retained state and actual usage, and decide an authorized capacity change. Never weaken budgets, clear uncertain ownership, delete user data, or silently upgrade a paid plan to restore headroom.

For CPU/query/subrequest per-invocation limits, inspect real distributions and worst-case accepted workloads. Treat70%/90% headroom as investigation/escalation thresholds, not proof that percentiles guarantee no termination. An exceeded Worker CPU or account limit can terminate execution outside application catch handling; use platform fail-closed behavior and external monitoring. A service/quota failure calls for Retry and operator investigation, not OAuth reconnection.

Representative Free CPU measurements, actual alert availability, and new-workflow notification delivery remain required before public-beta readiness. Local tests and workerd compatibility do not establish those facts.

Primary references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Cloudflare alert setup](https://developers.cloudflare.com/notifications/get-started/), [GitHub workflow notification ownership](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

## Admission measurements and release handoff

The [October 21 capacity investigation](calendar-capacity-2026-10-21.md) supersedes interpreting the synthetic 50-statement ceiling as the actual account limit. An isolated non-production Worker completed 120 D1 queries. The earlier compiled 66-assignment recovery replay identified 60 external requests for a combined initial calendar sync versus Free's published 50-request allowance. The subsequent [separate-invocation release](free-calendar-invocations-2026-10-21.md) superseded its paid-plan proposal. The latest 77-assignment live synthetic replay passes first-sync invocations with 29 Google / 45 Microsoft external requests and repeats with 18 each. Real Microsoft reconnect/sync is confirmed; Google reconnect and representative Free CPU headroom remain open. No paid plan was enabled.

The October 15 provider follow-up uses a conservative synthetic ceiling of 50 D1 statements per compiled request. Current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) still list 50 queries for Free, whereas the [Workers subrequest changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) distinguishes 50 external requests from 1,000 internal-service requests. Treat the probe as a conservative regression bound, not proof of the exact platform termination cause. The repaired 21-assignment Gradescope completion uses 17 statements instead of 120. A 17-event unchanged Microsoft reconciliation uses 40 instead of 78. The first Google reconciliation of 11 recovered, hashless mappings updates those existing events in 46 statements with no creates. These are separate synthetic invocations; they do not prove larger imports, full source/calendar fanout, changed-event worst cases or Cloudflare CPU headroom. That Google case approached the harness's artificial 50-statement bound; the current split-workload evidence is recorded above.

Every provider HTTP request retains a fresh ownership/control read; no validation result or in-flight read is shared. The hosted factory identifies its adapters in a private WeakSet only after wiring every client request through ownedFetch, avoiding an extra adapter-level query. Custom adapters retain the boundary check. Destination mappings are read once within the calendar owner. Successful updates that retain an already-saved remote event ID batch only their local metadata in chunks of 100; new or changed IDs still save immediately. SQL tenant/destination/owner/control fences, transport settlement and request budgets remain intact. If a completion batch fails, existing IDs are retained and the owner becomes uncertain. Paused/error, delayed-snapshot, post-construction revocation, cross-tenant/destination and atomic-failure regressions cover these boundaries.

The October 15 Free CPU investigation identified repeated native timezone validation in synthetic dashboard rendering. The bounded successful-zone cache retains at most 128 public identifiers per isolate; invalid inputs are never retained, and aliases/error behavior are preserved. Run `node scripts/benchmark-timezone-validation.mjs` locally with the locked dependencies to replay two native workerd variants, correctness/DST/alias/invalid and 160-zone holdouts, warmup and four alternating measurement pairs. It writes a synthetic result under `artifacts/benchmarks/`, without production credentials or provider requests.

For 500 format/classify pairs, the recorded median local wall time was **86.072 ms before / 13.303 ms after (6.47x)**, with identical outputs and 1,000 versus zero warm native validator constructions. The frozen baseline is the validator behavior at `4167dc2`. This is a repeated-helper diagnostic, not a full dashboard benchmark or Cloudflare CPU accounting. Cold starts, real M7 workloads and production Free headroom remain open; the earlier live CPU observations are unchanged.

`npm run verify:workerd:abuse` runs two independent native workerd services against a fresh shared synthetic D1 database. Forty concurrent Sync All admissions produce exactly six accepted and 34 rate-limited responses; another actor remains independent, and a controlled expired window admits again. The same command runs the native ownership probes, including held requests, stale continuations, interruption/restart, uncertainty and absence of competing remote writes. It does not access production or establish live provider correctness.

The controlled admission-only snapshot on October 14, 2026 measured:

| Outcome | D1 statements | Rows read | Rows written |
| --- | ---: | ---: | ---: |
| Accepted Sync All budget claim | 1 | 2 | 5 |
| Rejected claim plus retry-window lookup | 2 | 8 | 0 |

These are local D1 metadata from one synthetic window, including index accounting; they exclude control lookups, authentication, operation ownership, source imports, calendar writes, cleanup and dashboard queries. Rejection also consumes reads, and costs depend on retained history and indexes. Neither this table nor local request latency estimates production CPU, daily headroom or a safe user count. Current primary documentation was checked again on October 14: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 row allowances/accounting](https://developers.cloudflare.com/d1/platform/pricing/).

Before release, record actual UTC daily account totals, representative accepted/rejected invocation metadata, CPU/error distributions, current alert types and storage headroom through authorized platform metrics. Keep measurements aggregate. Existing notification delivery is operator-confirmed; activation and delivery for the new workflows remain separate evidence. If admission/control storage is unavailable, expect a safe service-unavailable response and no provider start. Shared-network sign-in attempts deliberately share their provider/network budget; show retry guidance rather than ask users to recreate provider credentials. Authenticated reads and logout do not require a Turnstile challenge.

Feature CI covers the Milestone 7 branch and requires the native probe. Production configuration and runtime reject known public Turnstile test keys and fixture/loopback promotion; the controlled browser transport requires explicit HTTP loopback fixture bindings and still exercises server token, hostname and action checks. See [Cloudflare's separate test-key guidance](https://developers.cloudflare.com/turnstile/troubleshooting/testing/). Browser fixtures do not satisfy production authorization or hosted acceptance.

Cleanup uses `scripts/lib/abuse-maintenance.mjs`: four D1 statements per dry-run/apply sweep and a validated batch size from one to 100 **per category** (rate events, runs, OAuth and settled bridge metadata). Thus at most 400 parent rows are selected/deleted; run-step FK cascades and index changes add writes. The expiry indexes are `abuse_rate_events_purge_idx`, `sync_all_runs_expiry_idx`, `oauth_requests_expiry_idx` and `sync_requests_expiry_idx`. The ownership primary key supports correlated owner checks. Active/uncertain owners and unconsumed/legacy bridge rows are retained. See [safe cleanup and recovery](incident-response.md#expired-state-maintenance).

The batch bound limits selected/deleted rows, not every row scanned. Retained expired metadata, ownership filtering and ordering can increase reads even when fewer rows are removed. Cleanup cost remains an explicit measurement gate before activation: capture query plans and D1 rows-read/written metadata in an isolated representative backlog (including retained owners), then compare authorized live aggregate metrics. Never extrapolate the admission-only table to cleanup or erase unresolved ownership to improve measurements. Existing bounded-maintenance integration tests prove deletion/retention semantics, not production quota headroom.

The October 15 [closeout measurement](closeout-milestone-7.md#representative-maintenance-measurements) now supplies that local representative-backlog evidence. With initially 1,000 expired rows/category, a batch-100 sweep reads 5,349 rows without held owners, or 9,968 with 900 retained owners. With initially 10,000 rows/category and 9,000 held owners it reads 77,349 rows and writes 600, deleting 400 parents plus child-step rows. All owner states/cooldowns, future records and legacy unconsumed bridges survive. Four actual maintenance statements are measured; setup, EXPLAIN and checks are excluded. Smaller batches do not eliminate scan cost: the last profile's batch-1 dry run reads 74,011 rows. Expiry/ownership indexes are used, but tied rate-event expiry also needs temporary ordering. This completes the local measurement task; actual backlog/cost/headroom and approved activation remain operational gates.
