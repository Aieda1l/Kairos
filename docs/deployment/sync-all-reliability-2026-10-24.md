# Sync All client recovery and Canvas partial feedback

STATUS: REVIEW CANDIDATE; NOT DEPLOYED

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

Full local Vitest passes 1,730 tests with 46 existing Windows skips. Types, lint, Workers build, dynamic-dashboard and hosted-safety checks pass. Independent source review found no blocking issue; run IDs remain in a provider-lifetime set, a bounded-practical-use memory tradeoff. Repository CI and release verification are still required before deployment is claimed.

Evidence is retained under ignored `artifacts/sync-all-reliability/`: original/follow-up RED logs, component/full-suite verification, failed browser traces, test-fixture diagnosis and passing browser logs. All provider fixtures and credentials used by automated checks are synthetic. Live normal Sync All verification after rollout must distinguish the expected Canvas access partial from other source/calendar outcomes; it must not weaken or recover a durable owner automatically.
