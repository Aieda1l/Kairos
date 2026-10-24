# Sync All recovery feedback implementation plan

> **For agentic workers:** Use test-driven development and verification-before-completion. Keep explicit file ownership for independent Ed, Canvas and browser work.

**Goal:** Make Sync All report current source outcomes and recheck recovered Ed work through the guarded API, while explaining the remaining Canvas access partial.

**Architecture:** Client-only explicit Ed outcomes and safe Canvas partial guidance; preserve backend authority and existing admission/ownership contracts.

**Spec:** [Sync All recovery and partial-result feedback](../specs/2026-10-23-sync-all-recovery-feedback-design.md).

## Constraints and review focus

- A client timer/refresh/GET is not uncertainty-settlement evidence.
- Rechecks require a new explicit admission; direct/replayed/cooldown attempts remain protected.
- Current success cannot be inferred from old provider phase or malformed response.
- Preserve valid failure metadata, accepted data, and later-source/calendar continuation.
- Show fixed diagnostic guidance, never raw messages or private identifiers.
- Keep the observed Canvas 401 as an access limitation, not a fabricated update.

## Tasks

- [x] Reproduce Canvas partial and identify the safe error category; operator document check reports 401 for one item while others load.
- [x] Add RED/GREEN Ed current-attempt and recovery-latch tests; implement explicit outcomes and authoritative POST recheck.
- [x] Add RED/GREEN Canvas partial/429/privacy tests; append safe guidance without changing API schemas or stored results.
- [x] Independently review source/component changes; fix invalid-result and lost-failure-metadata findings.
- [x] Add all-three-destination composite coverage and real browser pipeline regression; correct only the test fixture's unsupported REPORT status.
- [x] Finish integrated tests, types, lint and Workers/static safety checks on the final file set.
- [x] Publish the reviewable change and complete exact-source repository CI (PRs #48/#49; resulting-main run 40061552619).
- [x] Use existing rollout gates, verify the deployed build and preserve accepted data and all server protections.
- [x] Investigate the later Canvas busy report and recover the exact stopped bridge owner with existing fences; preserve all 89 assignments/statuses and 230 bridge requests.
- [x] Verify one normal live Sync All outcome, preserving the known Canvas access partial; the 09:27:33.824 UTC run has all five claims, matching fresh provider timestamps and all six owners idle.

## Evidence locations

Ignored `artifacts/sync-all-reliability/` contains RED/GREEN logs, preserved first browser failures, fixture diagnosis and the passing Chromium/Firefox run. The browser case uses one actual fixture CalDAV destination; composite/component/backend tests cover three-provider fan-out. No real provider credentials or private assignment details belong in these records.

The [release record](../../deployment/sync-all-reliability-2026-10-24.md) records the operator's assignment-specific Canvas 401 and the limits of that diagnosis. The expected access partial is retained; no unsupported status is fabricated.

The release record also documents the deterministic RED/GREEN repair for a pre-existing UUID-substring privacy-test flake. Exact-source CI, archive/runtime, staged/promoted configuration and health, data retention and public/client receipts are in ignored `artifacts/sync-all-feedback-release-v2/`.

The latest Canvas partial is 9 of 10. Earlier source/calendar outcomes spanned different admissions and were rejected as single-run evidence. The post-recovery run issued at 09:27:33.824 UTC is uniquely matched to all five claims and ensuing source/calendar completions; independent review and local missing-claim/running-owner/stale-source checks passed. This completes this plan's live sequence check with Canvas partial, while the unresolved access item, remaining calendar lifecycle assertions and Workers Free headroom stay open. Recovery and final attribution receipts are retained under ignored `artifacts/canvas-autosync-incident-2026-10-24/` and `artifacts/sync-all-feedback-release-v2/`.
