# Production monitoring

Kairos's public check is GET https://mykairos.me/api/health. It executes only `SELECT 1 AS ok`, without authentication, session, user, or credential queries. It returns200 `{"status":"ok"}` or503 `{"status":"unavailable"}`, always no-store. Its three-second deadline limits response time; it does not claim to cancel a D1 query. This checks basic storage availability, not provider credentials, user-table quota headroom, full application behavior, or launch readiness.

The standalone `node scripts/check-production-health.mjs` accepts only `https://mykairos.me`, refuses redirects, uses a ten-second total deadline, limits body reading to256 bytes, and accepts only the exact healthy object. Its logs contain fixed code/status and no response body or addressing. A nonzero exit fails the check. No dependency installation or production credential is needed.

`.github/workflows/production-health.yml` schedules it every15 minutes and permits manual runs, with read-only repository permissions and one concurrent check. Both paths require `main` and the repository variable `KAIROS_HEALTH_ENABLED=true`; leave it unset until the M7 health endpoint is deployed and activation is explicitly approved. Merging the workflow alone must not start production checks. GitHub schedules can be delayed; this is a periodic check, not a guaranteed uptime or delivery SLA. Deployment remains manual, preserves remote variables, records the public Git revision as KAIROS_RELEASE_ID, and runs the health smoke afterward. Automation promotion requires the rollback drill and all release gates.

## Operator and delivery evidence

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

The operator reports Workers Free. The current documented limits are100,000 Worker requests/day,10ms CPU/request,128MB memory and50 subrequests/request; network/database waiting is not CPU. D1 Free permits50 queries/Worker invocation,500MB/database and5GB/account; Time Travel retention is7 days. Daily row-read/write allowances must be checked against current pricing/dashboard rather than inferred from successful `SELECT 1`.

Current Free reference thresholds, verified against the linked primary documentation on2026-10-13:

| Metric | Free allowance |70% investigation|90% escalation|
| --- | ---: | ---: | ---: |
| Worker requests, daily account total |100,000|70,000|90,000|
| D1 rows read, daily |5,000,000|3,500,000|4,500,000|
| D1 rows written, daily |100,000|70,000|90,000|
| Database storage |500MB|350MB|450MB|
| Account D1 storage |5GB|3.5GB|4.5GB|
| CPU per request |10ms|7ms|9ms|
| D1 queries per invocation |50|35|45|
| Subrequests per invocation |50|35|45|

These are reference calculations, not current utilization measurements. Verify dashboard units/plan changes before applying them; daily D1 allowances reset at00:00 UTC. Once a Free daily D1 read/write limit is reached, queries may fail until reset or an authorized plan change. Health success does not replace those metrics or a representative workload check.

For each request/read/write/storage daily allowance, calculate70% and90% of the actual plan limit. At70%, identify the source of growth, inspect query/index efficiency and request sizes, reduce optional repeated work through the existing operator controls, and increase review frequency. At90%, pause affected provider work, preserve reads/logout/local disconnect/deletion, inspect retained state and actual usage, and decide an authorized capacity change. Never weaken budgets, clear uncertain ownership, delete user data, or silently upgrade a paid plan to restore headroom.

For CPU/query/subrequest per-invocation limits, inspect real distributions and worst-case accepted workloads. Treat70%/90% headroom as investigation/escalation thresholds, not proof that percentiles guarantee no termination. An exceeded Worker CPU or account limit can terminate execution outside application catch handling; use platform fail-closed behavior and external monitoring. A service/quota failure calls for Retry and operator investigation, not OAuth reconnection.

Free-plan native measurements, actual alert availability, and notification delivery remain required before public-beta readiness. Local tests and workerd compatibility do not establish those facts.

Primary references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Cloudflare alert setup](https://developers.cloudflare.com/notifications/get-started/), [GitHub workflow notification ownership](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

## Admission measurements and release handoff

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
