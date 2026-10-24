# Sync All client recovery and Canvas partial feedback

STATUS: DEPLOYED; NORMAL LIVE SYNC ALL VERIFIED WITH CANVAS PARTIAL

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

During that rollout, no billing, migration, credential, provider-control, recovery or logging change occurred. Workers Free remains selected; this client change provides no new CPU-headroom evidence. Overall beta acceptance and the existing provider/account/capacity assertions remain open.

## Live follow-up and Canvas recovery

The operator subsequently reported "Ed sync complete" and nine of ten Canvas submission statuses updated with the new access-verification guidance. Read-only state at `2026-10-24T08:22:52.639Z` confirms nine updated Canvas statuses and one failure, 47 successful Ed updates and 32 successful Gradescope updates. Each calendar has 17 mappings and a successful outcome. These records span two Sync All admissions about fourteen seconds apart: the calendar completions precede the latest source run, whose calendar step was not claimed. They do not establish one complete sequence. The new access category does not establish a fresh HTTP 401 or prove that the same assignment failed as before.

A later attempt reported Ed complete but both Canvas steps busy. Its Canvas submission request had already been registered at `08:46:01.692Z`, before the normal root admission at `08:46:05.362Z`. The exact owner remained running and that bridge request remained unconsumed; Canvas deadline freshness did not advance. Gradescope, Ed and all three calendars completed successfully during that later root. Browser evidence from the reported page shows an automatic submission start returning 409, root admission returning 200 and the deadline request returning 409, with no completion request. The current page therefore encountered an existing Canvas owner. Its manual submission step was skipped locally and had no root claim.

Both Canvas actions share `source:canvas`. Stale submission status automatically starts a check on dashboard mount, and the server retains ownership while the Firefox extension works. Leaving that page or losing the response/completion can leave the bridge unfinished. The available evidence does not identify why this particular earlier completion was missing. Installed Vinext normally refreshes App Router data through RSC; failed refreshes can fall back to document navigation, but no such failure was observed here and that mechanism is only a hypothesis. No speculative client or ownership-policy change was deployed.

After the operator freshly confirmed all earlier server and browser-extension attempts had stopped, the exact stale Canvas owner was recovered at `2026-10-24T09:00:44.951Z`. The reviewed procedure used the existing SQL fences: pause Canvas control from version 6 to 7, settle only that exact owner to idle, then reopen at version 8. Database staleness was an eligibility guard, not evidence of settlement; the operator's explicit stop confirmation supplied that assertion. Each write had a durable attempt marker and exactly one confirmed change, with no automatic retry.

Full before/after metadata comparison preserved all 89 assignments and submission statuses, three source connections, three calendar connections and their credentials, 51 mappings and 230 bridge-request rows. Accepted source/calendar/submission metadata, the owner nonce and cooldown, all other owners and all other controls were preserved. The unfinished request remains evidence. Recovery made no provider requests or accepted-data deletions and did not deploy an application change. The historical SQL verifier reports twelve cases plus a separate owner/cooldown preservation assertion; syntax, inert-import/SQL equality checks and independent tool review passed. An independent read at `09:02:26.037Z` verified all six owners idle and Canvas enabled at version 8.

## Verified live Sync All and remaining limits

A fresh post-recovery baseline at `2026-10-24T09:02:56.235Z` recorded all three source connections and calendar destinations enabled with idle owners. The operator then reported Ed complete and the expected Canvas 9-of-10 partial, without the earlier busy messages. Read-only verification at `09:28:25.122Z` confirms the normal Sync All issued at `09:27:33.824Z`: all five eligible steps were claimed, each provider's fresh timestamps follow its own claim, source completions precede the calendar claim, and all six owners are idle.

| Step | Claim time (UTC) | Fresh recorded outcome (UTC) |
| --- | --- | --- |
| Canvas deadlines | 09:27:33.920 | 09:27:34.169–34.755; successful |
| Canvas submissions | 09:27:35.418 | 09:27:35.616–36.746; 9 updated, 1 failed, `PARTIAL_SYNC` |
| Gradescope | 09:27:37.635 | 09:27:37.881–38.353; 32 updated, no failures |
| Ed | 09:27:38.669 | 09:27:38.968; 47 updated, no failures |
| Calendar destinations | 09:27:39.778 | Microsoft 09:27:40.350, Google 09:27:42.416, CalDAV 09:27:44.006; each successful with 17 mappings |

There are two retained root admissions, at `09:27:00.770Z` and `09:27:33.824Z`. This conclusion uses the later root's complete claim group and ensuing provider timestamps, not mixed results from the two runs. Independent review confirmed the private/public claim grouping and chronology. A local verifier uniquely matches the later root within its time window and rejects the earlier mixed-run inventory plus missing-claim, running-calendar and stale-source counterfactuals. Raw timestamp projections are retained separately from the observer's assessment summaries.

This closes the planned normal Sync All live-verification step **with Canvas partial**. It is not full success for every provider item: the remaining Canvas access-verification failure retains accepted saved data, and neither the failed assignment's identity nor a new HTTP status is established. The earlier 8-of-9/HTTP 401 observation remains historical. Stored equal start/end timestamps do not measure elapsed runtime or CPU. Calendar update/removal/recreation, other beta acceptance assertions and reliable Workers Free headroom remain open. No application deployment or provider mutation was performed by this read-only verification.

Evidence is retained under ignored `artifacts/sync-all-reliability/`: original/follow-up RED logs, component/full-suite verification, failed browser traces, test-fixture diagnosis and passing browser logs. All provider fixtures and credentials used by automated checks are synthetic. Live normal Sync All verification after rollout must distinguish the expected Canvas access partial from other source/calendar outcomes; it must not weaken or recover a durable owner automatically.

Exact-source archive, CI, staged/promotion, retention, public/client checks and read-only observation receipts are retained in ignored `artifacts/sync-all-feedback-release-v2/`. The earlier local archive, never sealed or uploaded, remains in `artifacts/sync-all-feedback-release/`; it is not release evidence for the new source.

The source/browser follow-up is retained in ignored `artifacts/sync-all-reliability/2026-10-24-live-feedback-followup.md`. Exact-owner recovery anchors, reviewed tool, immutable plan, confirmed mutation receipt and the final temporal-attribution verifier are retained in ignored `artifacts/canvas-autosync-incident-2026-10-24/`. The final raw inventory is `artifacts/sync-all-feedback-release-v2/post-recovery-reported-inventory-1792834105122.json` with its private claim-group companion and a `normal-sync-all-confirmed-*` receipt. Private identifiers, nonces and encrypted payloads must not be copied into public records.
