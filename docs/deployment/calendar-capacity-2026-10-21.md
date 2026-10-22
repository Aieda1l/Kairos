# Calendar capacity decision — October 21, 2026 UTC

Status: the user selected Workers Free. Separate per-destination invocations are deployed; Google, Microsoft and iCloud syncs are succeeding. Reliable CPU headroom remains unestablished. The paid-plan proposal below is historical and is superseded by [the Free-plan design](free-calendar-invocations-2026-10-21.md). No billing change is authorized or enabled by this record.

## October 22 measurements

On source `caa736d` / Worker `7c208a5e-e6c4-4004-8494-9fb23cb120cf`, the new iCloud calendar initial-sync window (07:16:55–07:17:10 UTC) and repeat-sync window (14:36:31–14:36:40 UTC) each contain one successful invocation, zero errors and 17 reported subrequests. CPU P50/P99 were 141.991 ms and 77.704 ms respectively. The authenticated GraphQL schema identifies `cpuTimeP50`/`cpuTimeP99` as microseconds; these values are converted to milliseconds. Narrow aggregate windows align with the recorded sync times but are not route-level traces. The operator confirms successful repeat sync without extra copies, and live metadata retains 16 distinct iCloud mappings with an idle owner.

These successful requests exceed the documented [10 ms Free CPU allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Cloudflare describes limited isolate flexibility for occasional overruns, so success does not establish sustainable headroom. No plan change follows from these samples.

A sealed local profile of the actual compiled application ran an initial conditional-write confirmation case and ten warm repeat syncs with synthetic D1/session/Apple data and zero real provider requests. Every warm pass returned 18 unchanged events, no creates or updates, and an idle owner; 19 unmapped synthetic legacy events remained intact. Across 224 active samples, event reads and guarded database/transport work are useful targets; the profile does not establish hosted CPU savings. A further shape comparison ran ten warm repeats each with zero, one and sixteen eligible events. Those unchanged passes used 1/2/17 external calls and 19/20/35 SQL statements respectively, created or updated no events, retained all 19 unmapped synthetic events and settled every owner. The fixed request overhead is material, so smaller chunks alone are not yet a demonstrated solution. The existing repeat path still performs one calendar validation plus one GET for each managed event. Evaluate bounded read batching and smaller resumable work units while retaining tenant scope, exact resource identity, admission and owner fences, conditional writes and uncertainty settlement. Measure any change on the hosted runtime before claiming reliable Free capacity.

Ignored receipts and profiles are in `artifacts/icloud-connect-incident/`: `success-metrics.json`, `metric-units.json`, `profile-dense/summary.json`, `profile-matrix.json` and the sealed fixture reports. No production writes, stored request logs, credentials or private coursework were used in the profile.

## Bounded iCloud read batching, October 22

The operator approved replacing individual managed-event checks with bounded CalDAV `calendar-multiget` reads. The candidate requests only ETags for saved, eligible resources in the same calendar, at most 32 per REPORT. A single remaining resource keeps its ordinary GET because XML adds work without reducing calls. Batches start lazily during reconciliation; their results and failures are shared only within that invocation. Individual PUTs, DELETEs, deterministic IDs, conditional-write confirmation and fresh transport/database ownership fences remain in place.

The parser validates DAV namespaces, exact requested URLs, unique and complete responses, resource/property status and ETags. Request and streamed response bodies are limited to 64 KiB; entity declarations and malformed XML are rejected. Only an explicit resource-level 404 means absence. A property-level 404, omitted response or foreign resource cannot cause a replacement create. Resource-level authentication and throttling errors retain their existing meaning, including stopping later batches. Only explicit HTTP 405/501 responses permit the existing GET fallback, remembered for this client invocation.

A paired sealed replay of the archived deployed build and candidate uses 79 synthetic assignments and ten warm repeats for each shape:

| Eligible mapped events | Before: external / SQL | Candidate: external / SQL |
| --- | ---: | ---: |
| 0 | 1 / 19 | 1 / 19 |
| 1 | 2 / 20 | 2 / 20 |
| 16 | 17 / 35 | 2 / 20 |

Every repeat made zero calendar writes, retained 19 unmapped synthetic events and settled its owner idle. The compiled conditional-write fixture also completes an 18-event repeat with two external calls and 20 SQL statements, while accepted/absent write confirmation and persistent uncertainty retain their expected outcomes. These are measured request counts and diagnostic local profiles, not hosted CPU savings or proof of reliable Free headroom. Thirty-six new unit/integration cases cover batching, malformed/partial responses, resource boundaries, throttling, provider pause, concurrent edits and singleton reads. Full local verification passes 1,646 tests with 46 platform skips. Exact-head/main CI and hosted confirmation are still required before treating this candidate as deployed or capacity acceptance as complete.

Ignored paired replay/profile receipts are under `artifacts/icloud-read-batching/`. All traffic is sealed to synthetic provider fixtures; there are zero real provider requests and production database writes.

## Findings

The old 50-SQL-statement probe is a conservative optimization regression bound, not the observed account limit. A temporary isolated Worker bound only to `kairos-preview` completed 5, 25, 51 and 120 sequential `SELECT 1 AS ok` queries in separate invocations. The Worker was deleted afterward. No production bindings, user data or provider credentials were used. Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests) distinguish 50 external requests from 1,000 internal-service requests on Free; the [D1 limits table](https://developers.cloudflare.com/d1/platform/limits/) still states 50 queries and links back to Workers limits. The live measurement, rather than the conflicting SQL table alone, informs this decision.

A local workerd replay of the compiled application at `d091b5e779dafc75885d6348b7a6ef4330e21588` used 66 synthetic assignments and the October 19 aggregate recovery shapes. All external traffic was intercepted by local provider fixtures. It measured complete HTTP route execution, including authentication, admission, ownership/control checks, token refresh and persistence:

| Invocation | SQL statements | External requests | Accepted result |
| --- | ---: | ---: | --- |
| Google initial recovery | 111 | 29 | 13 creates, 3 updates, 8 removals |
| Microsoft initial recovery | 83 | 31 | 6 creates, 10 unchanged, 7 removals |
| Combined initial calendar sync | 192 | 60 | Both destinations complete; all owners idle |
| Combined repeat | 76 | 36 | 32 unchanged, no creates or removals; all owners idle |

These are exact synthetic execution counts, not live calendar acceptance. The combined initial request exceeds Free's published external-request allowance. Individually completing recovery would temporarily reduce subsequent combined work, but does not bound future combined creates, updates, removals or source-triggered fanout. A separate temporary same-account Worker egress probe returned an unavailable fixture before any successful outbound iteration and did not establish an observed external-request ceiling. Both temporary Workers were removed.

Read-only production snapshot at `2026-10-21T06:01:29Z`:

- Google control disabled, version 3; Microsoft control disabled, version 1.
- Both calendar owners idle. Google connection disabled with 11 mappings; Microsoft connection enabled with 17 mappings.
- Prior 24 hours: 438 Worker invocations, zero recorded errors, CPU P50 19.907 ms and P99 167.148 ms. Calendar work remains paused, so these aggregates do not establish calendar-specific CPU headroom. No production rows, provider controls, keys or remote calendars/events were changed.

## Proposed recovery

Use Workers Paid rather than redesigning sync into multiple resumable HTTP invocations for this release. [Current pricing](https://developers.cloudflare.com/workers/platform/pricing/) has a $5 monthly subscription minimum plus applicable usage charges. The user agreed to consider Paid after measurements; this is not approval to change billing.

Proposed production limits:

```json
{"limits":{"cpu_ms":1000,"subrequests":100}}
```

The 100-request cap provides space for the measured 60-request initial fanout while retaining a finite bound. The 1,000 ms CPU cap is a proposed ceiling, not a promise of measured calendar CPU or a monthly spending cap. Existing per-user/provider admission budgets remain authoritative. SQL persistence, tenant fences, fresh per-request transport ownership checks, cooldowns and uncertainty recovery remain unchanged.

The current compiled Workers build passed. Wrangler accepted these limits and the existing module graph in a deployment dry run. No production upload, plan change, migration or traffic change was performed.

After explicit billing approval and activation:

1. Confirm the effective Workers plan, current release, seven migrations, bindings/key access and idle calendar owners. Re-run aggregate usage before reopening.
2. Apply the reviewed resource limits while preserving the known-good code, bindings, remote secrets and database. Verify public health and signed-out protection.
3. Reopen Microsoft by an exact control-version update, then verify its initial sync and repeat behavior under an authorized account. Record only counts/outcomes.
4. Reopen Google by an exact control-version update and obtain fresh consent through the product. Preserve the selected existing calendar and all 11 recovered mappings.
5. Verify combined Sync All, due-date updates, event-delete/recreate, reconnect adoption and cross-user isolation. Capture actual calendar CPU/error outcomes and maintain a compatible recovery version. If either owner becomes uncertain, stop provider work and reconcile outcomes; do not clear ownership by elapsed time.
6. Revisit batching or resumable sync if legitimate beta workloads approach the configured caps. A paid plan does not make work unbounded or complete Milestone 7 acceptance by itself.

## Local evidence

Ignored diagnostic artifacts are under `artifacts/calendar-capacity/` in the `fix/calendar-capacity` worktree: `platform-probe.json`, `external-probe.json`, `production-readonly.json`, `workload-replay.json`, `workload-replay.log` and `dry-run.log`. The replay generator and generated fixture runner remain local diagnostic tools; they do not change the deployed application or its verification gates.
