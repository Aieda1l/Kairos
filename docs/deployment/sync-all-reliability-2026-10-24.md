# Sync All client recovery and Canvas partial feedback

STATUS: DEPLOYED; NORMAL LIVE SYNC ALL VERIFICATION PENDING

This October 23–24 UTC continuation follows the deployed Ed persistence change, source `6e05463428869b08481dc577c7b8d3915d468018` / Worker `b8f02ffe-aa73-493f-8c0a-ce23119d7db9`. It changes client feedback and manual Ed recovery rechecks, not durable ownership or provider access policy.

## Canvas diagnosis

A fresh normal Sync All reproduced eight status updates and one failure, with `PARTIAL_SYNC`, no batch error and empty aggregate diagnostic/HTTP arrays. The failed result's enum was `CANVAS_SIGNED_OUT`. The operator opened that specific assignment and observed a blank document with HTTP 401 while other assignment pages loaded.

That establishes an access refusal for that item; it does not identify the underlying Canvas policy or prove a general signed-out session. The extractor's `canvas-html-v1` version also does not prove HTML fallback: that label is used for early API errors. No assignment identifiers, URLs or coursework are retained in this public record.

The partial result remains valid until Canvas permits the item. The application must retain prior accepted status and report the limitation, rather than inventing an update or excluding the failure from the denominator. No extension, protocol, database or permission change is made for this observed 401.

## Client changes

- Ed returns a per-attempt completed/partial/failed/blocked result. Sync All shows success only for the current validated completed outcome, rather than an old provider phase or a fulfilled no-op.
- A new explicit Sync All admission can ask the existing guarded Ed POST to recheck the stale infinite client latch. The server still claims the one-use step and rejects unsettled ownership before provider work. Direct calls, reused runs and finite cooldowns remain blocked. Props, accepted reads, elapsed time and timers cannot settle recovery or launch automatic retries.
- Invalid or contradictory success payloads cannot clear recovery. Known failure results refresh attempt/error/count metadata while retaining accepted successful freshness; blocked presentation matches its returned result.
- Canvas partial counts append fixed guidance from existing validated diagnostic/HTTP categories or local result/batch error enums. Any reported 429 uses bounded cooldown. The sign-in/access category does not invent an HTTP status or assert that every 401/403 means global sign-out. Raw extension messages stay hidden, including extension-detection failures.
- Legacy source phase warnings and calendar retry/uncertainty behavior remain unchanged. Later steps continue after partial/blocked source outcomes.

All response schemas and HTTP contracts remain compatible with the deployed backend. There is no new owner-state endpoint, authentication scope, schema, key, logging or billing change.

## Verification

RED/GREEN component tests reproduce the previous silent skip, stale success, lost failure metadata, malformed completion and blocked-presentation issues. Final Ed/coordinator coverage passes 49 focused cases; Canvas feedback coverage passes 29. A composite regression uses actual controls/Ed/calendar providers with API-boundary responses to verify two manual runs, all three source steps, fresh root/child tickets, and Google/Microsoft/iCloud invocation continuation.

The new browser journey passes in Chromium and Firefox. It uses real local guarded Canvas/Gradescope/Ed/CalDAV fixture paths, a real Canvas partial completion and one synthetic Ed 409 followed by a fresh admitted real Ed POST without reloading. Saved assignments remain visible, the prior Ed success banner is not reused, and final CalDAV reconciliation actually succeeds. Remote Google/Microsoft behavior is outside that browser case; three-provider fan-out is separately covered by composite and existing backend tests.

The first browser run failed because the old test CalDAV transport returned 404 for unsupported REPORT. The fixture now returns 405 at its known calendar, exercising the real client's existing individual-GET fallback. The original failures/traces and diagnosis remain retained. No production CalDAV client or fixture-enablement condition was changed, and success assertions were not removed.

Full local Vitest passes 1,730 tests with 46 existing Windows skips. Types, lint, Workers build, dynamic-dashboard and hosted-safety checks pass. Independent source review found no blocking issue; run IDs remain in a provider-lifetime set, a bounded-practical-use memory tradeoff.

Merged-main CI initially exposed a pre-existing privacy-test flake: a random correlation UUID contained the fixture course ID's digits, and the assertion searched the entire serialized response for that substring. [PR #49](https://github.com/Aieda1l/Kairos/pull/49), test commit `863f94e`, reproduces that collision with a registered deterministic UUID and compares the complete anonymous completion structure. The UUID spy is restored immediately after registration. Unexpected private fields still fail the assertion. Deterministic RED, seven focused GREEN cases, the full local suite and independent review passed. This repair changes no production privacy behavior.

## Verified rollout

The [Sync All change](https://github.com/Aieda1l/Kairos/pull/48) and test correction are deployed from merged source `316e2c97f55c3611e58733163172c11831ba2117`. [Exact-main push CI](https://github.com/Aieda1l/Kairos/actions/runs/40061552619) passed 1,776 unit tests, 65 browser cases, twelve compiled provider cases, five compiled iCloud cases and both native calendar/source-bridge lifetime checks.

The clean archive contains 602 tracked regular files and no private environment files. Its 340-file distribution graph is sealed as `2cb913a60d77897b97973fae867cc765ade8df3a43cee55d255bb12f0635a7a4`; the archived runtime repeated all twelve provider and five iCloud cases plus lifetime verification with zero real provider requests. Staged schema-7, configuration, required secret-binding names, disabled logging, isolation and health checks passed. Worker `19e46851-918f-4c72-9993-2aecdc0c80a1` was promoted at `2026-10-24T04:23:10.126Z`, deployment `bb139677-1b53-4ee7-9f97-6f15b75ddb88`, at 100%, and active configuration and canonical health were verified again.

Before manual activity, read-only post-deployment comparisons preserved all 84 assignments and submission statuses, three source connections, three calendar connections and credentials, 36 calendar mappings, per-account/source/calendar count metadata and all nine abuse-control versions. All six owners were idle. Eleven anonymous health/auth/origin/fixture checks, five public policy/support pages and the published Firefox 0.4.0 listing passed. Five served client files matched the exact sealed build bytes and hashes, including the new Canvas guidance and Ed provider/coordinator code. The [post-release GitHub production health check](https://github.com/Aieda1l/Kairos/actions/runs/40062282297) also passed.

No billing, migration, credential, provider-control, recovery or logging change occurred. Workers Free remains selected; this client change provides no new CPU-headroom evidence. Overall beta acceptance and the existing provider/account/capacity assertions remain open.

## Live verification boundary

A read-only baseline at `2026-10-24T04:23:48.441Z` records all three source connections and all three calendar destinations enabled with idle owners. One normal authenticated Sync All has been requested after a full Firefox reload. Its fresh source outcomes, all five root-step claims and each calendar completion remain pending. The earlier Canvas 8-of-9 access partial is expected unless upstream access changes; prior successful provider metadata is not fresh evidence for this release.

Evidence is retained under ignored `artifacts/sync-all-reliability/`: original/follow-up RED logs, component/full-suite verification, failed browser traces, test-fixture diagnosis and passing browser logs. All provider fixtures and credentials used by automated checks are synthetic. Live normal Sync All verification after rollout must distinguish the expected Canvas access partial from other source/calendar outcomes; it must not weaken or recover a durable owner automatically.

Exact-source archive, CI, staged/promotion, retention, public/client checks and read-only observation receipts are retained in ignored `artifacts/sync-all-feedback-release-v2/`. The earlier local archive, never sealed or uploaded, remains in `artifacts/sync-all-feedback-release/`; it is not release evidence for the new source.
