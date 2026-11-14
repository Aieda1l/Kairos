# Workers Free guest release decision — November 14, 2026

The user accepted retaining Workers Free and the current implementation, stopping speculative CPU microoptimizations, and progressing the remaining functional release checks with actual CPU-limit error monitoring. Proving that every sampled request stays below 10 ms is no longer a prerequisite for those controlled checks. This is a CPU-risk disposition, not a capacity PASS or approval to deploy, activate guest access or maintenance, change billing, or contact real providers.

Both configured guest defaults remain `false`. This decision changes documentation and release direction only; it changes no code, dependency, configuration, admission limit or production resource. General memory, request and D1 limits, privacy/retention requirements, provider acceptance, exact-candidate verification and final approval remain separate gates.

An above-10-ms CPU observation alone does not veto recommending a monitored Free release once the other checks pass. Carry the unproved headroom and accepted failure risk into the final candidate review. Reproducible sync failures remain functional acceptance failures; the decision does not relabel them as successful or authorize activation.

A credential-free, bounded, read-only public check at `2026-11-14T19:45:50.969Z` returned `/api/health` HTTP 200 with `status:ok` and `/guest` HTTP 404. This is a dated public baseline, not proof of a runtime revision, schema, capacity, deployment or activation.

## Evidence and remaining CPU risk

The [v8 hosted diagnostic](guest-hosted-run-2026-11-14-v8.md) completed 22 physical requests and 13 logical flows, preserved all 21 protected table digests, and reported app CPU P50 of 15.475 ms and P99 of 172.652 ms. Its sampling and attribution limitations remain unchanged. **Workers Free CPU headroom is unproved.** Passing those flows does not guarantee that a future request will avoid termination.

The subsequent private header-snapshot prototype preserved characterized behavior but showed no useful complete-journey wall-time gain. It was rejected; no production or dependency patch was selected. More speculative optimization or another compulsory optimization benchmark is not the next release step. Actual CPU errors or functional failures can justify a targeted investigation and a new workload or operating decision.

Cloudflare documents a 10 ms CPU allowance per Free HTTP request, some flexibility for occasional overruns, and termination when overruns persist. CPU-limit termination returns error 1102 and the `exceededCpu` outcome; 1102 can also represent another resource limit, so inspect the outcome. Waiting for network I/O does not consume active CPU. These facts do not establish headroom for Kairos. See [Cloudflare's CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

For controlled release checks, inspect available CPU/outcome/error-count analytics and dashboard data, including `exceededCpu`, together with real sync failures and stage outcomes. Retain sanitized counts and the source/workload being checked. Do not enable persistent request/body logs or collect credentials, provider content or raw provider errors for this decision. Free daily request and D1 resource caps and the existing shared admission budgets still constrain use; accepting CPU risk does not waive them. Monitoring configuration and successful production operation are not established by this document.

## Can requests be split further?

Separate HTTP invocations can reduce variable computation in each invocation when the work itself can be divided. Cloudflare lists smaller chunks across multiple requests as an option for CPU errors. `await` and `waitUntil()` do not create a new HTTP invocation or reset its CPU allowance; waiting and execution lifetime are different from active CPU. See [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) and [invocation duration](https://developers.cloudflare.com/workers/platform/limits/#duration).

Kairos already separates a bounded raw source relay, parsing in a foreground browser worker, and a separate signed-receipt approval request before accepting normalized data. The [transient client](../../src/lib/guest/sync/transient-client.ts) implements this sequence. The [coordinator](../../src/lib/guest/sync/coordinator.ts) already requests Ed lessons one course at a time rather than combining all selected courses in one server request. Canvas supplies a whole bounded feed document; pagination is not assumed.

Further splitting is a possible targeted response to demonstrated failures, not a selected change. Each extra request repeats framework, authentication/capability and admission checks and consumes request, D1 and shared global budgets. A successful source read already uses two global claims, so the [sixty-claim pool permits at most thirty complete reads per 600 seconds](guest-free-processing.md). Splitting could reduce variable work per invocation while increasing total work and reducing useful throughput. Any redesign must retain the existing deadlines, privacy, receipt validation and stale-result fences. No claim is made here about Service Binding CPU accounting.

## Fresh local retention evidence

Before these documentation edits, `npm run verify:guest-retention` passed locally on clean main `cd23d75873b4309084e2434080095f078ff46170`, with receipt `source.dirty:false`. The native disposable-D1 probe drained 205 expired anonymous rows to zero in three apply invocations and made zero outbound requests. It exercises deletion and preservation checks, not production maintenance.

Ignored local receipt: `artifacts/guest-retention/2026-11-14T19-41-32-603Z-db7d8084-d470-4e4c-a9cb-0904c06671c8-native/receipt.json`; SHA-256 `b86743ff1ded5a682117685d88142c8ab50806b0c15b39fb0c233a5135cce08b`. This is local-only evidence, not a published CI artifact. It does not establish hosted cadence, a physical-retention bound, recovery-history deletion or deployed D1 billing capacity. See the [retention validation boundary](guest-retention-validation.md).

## Next release checks and approvals

1. Prepare the hosted retention/cadence check: verify physical deletion, protected/unexpired preservation, deletion/index cost, backlog catch-up and failure/recovery bounds. Establish a sustainable cadence and published retention promise before treating the privacy gate as closed. Executing hosted checks or activating maintenance requires its own reviewed operator authorization.
2. Separately authorize operator acceptance with real Canvas, Gradescope and Ed accounts and browser/session lifecycle checks. Include partial source results, Firefox/provider-session behavior, memory-only reload, remembering/forgetting, disconnect/reset/import, capability expiry, account separation and report-transition interaction. Use sanitized stage/count results and monitor actual CPU outcomes and functional failures. Fixture success cannot substitute for this acceptance.
3. Freeze the concrete production candidate and retain exact-source CI, build/config/schema compatibility, operational/privacy and resource evidence, rollback target and reviewed approval packet. The CPU-risk decision accompanies that packet without turning unproved headroom into a PASS. Request explicit final deployment/activation approval; keep guest defaults false until the separately approved change. Broader M7 acceptance remains separate.

The [acceptance sequence](guest-acceptance.md#operator-controlled-release-sequence--activation-not-executed) and [capacity record](guest-capacity-readiness.md#remaining-release-gates) retain the detailed evidence requirements. No additional cloud test, new resource, provider traffic, deployment, maintenance activation or billing action is authorized by this documentation update.
