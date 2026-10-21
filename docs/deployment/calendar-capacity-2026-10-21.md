# Calendar capacity decision — October 21, 2026 UTC

Status: measurements complete; paid-plan decision and hosted recovery pending.

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
