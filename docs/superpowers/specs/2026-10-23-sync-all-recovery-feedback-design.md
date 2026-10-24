# Sync All recovery and partial-result feedback

The operator approved diagnosing the last Canvas 8-of-9 result, fixing stale client recovery state that can skip Ed, and verifying the complete Sync All flow. Keep durable server ownership, one-use admissions, cooldowns and retained data authoritative.

## Evidence and scope

A fresh normal Canvas completion reproduced eight updates and one failure with no aggregate diagnostic/HTTP detail. The validated failed result was `CANVAS_SIGNED_OUT`, with no batch error. The operator then observed HTTP 401 and a blank document for that particular assignment while other assignment pages loaded. This establishes an item-specific access refusal, not its underlying enrollment/publishing/authentication policy and not general Canvas sign-out. Keep the partial result and saved data; do not invent a status or omit the failure to make the count succeed. No extension or protocol change is necessary for the observed access refusal.

Separately, Ed's client stores `Infinity` after recovery-required and silently returns from `syncNow`. Router refresh and accepted connection reads have no durable-owner evidence and cannot settle that latch. Sync All previously treated every resolved `Promise<void>` as completion and could use old provider success state.

## Implementation

Ed returns a current-attempt outcome: completed, partial, failed or blocked. Only a valid completed result produces the root success notice. Invalid or contradictory success payloads cannot clear recovery; known failed results update attempt/error/count metadata without discarding accepted successful freshness. A blocked return updates its visible recovery message as well as its result.

A fresh explicit Sync All admission may recheck Ed through the existing authenticated guarded POST despite the stale infinite client latch. The client retains attempted run IDs so old runs do not authorize that recheck. Finite cooldowns and direct calls remain blocked; no timer, props update, connection GET or automatic retry clears uncertainty. The server still claims the one-use step, acquires only an idle exact provider owner and rejects uncertain/stale-running work before provider transport. No backend/API/schema or recovery-policy change is made.

Canvas partial feedback keeps the existing updated/failed count semantics and appends fixed guidance selected from validated diagnostics, HTTP categories or local protocol error enums. It prioritizes any 429 for bounded cooldown. Access/session errors use access guidance without claiming a precise status absent from the response. Raw extension/server messages, identifiers, coursework and URLs are never reflected. Older API responses remain compatible; no new completion response field is introduced.

Legacy source/calendar phase warnings and calendar uncertainty blocking remain intact. Layout, styles, credentials, provider controls, keys, logging and billing are unchanged. The test-only CalDAV fixture will explicitly return method-not-supported for REPORT so the real client's existing GET fallback is exercised; production transport selection remains unchanged.

## Verification and rollout

Use RED/GREEN component tests for current-attempt outcomes, new admitted rechecks, retained uncertainty/cooldowns, invalid result handling, safe failure metadata, privacy and partial continuation. Verify actual controls/Ed/calendar providers invoke Google, Microsoft and iCloud tickets in composite tests. Browser coverage uses the existing real local Canvas/Gradescope/Ed/CalDAV fixtures and a single synthetic Ed 409 response, followed by a fresh real guarded Ed POST without reload. It does not simulate actual backend uncertainty settlement or remote Google/Microsoft behavior.

Run the full suite, types, lint, Workers build and existing release checks. Rollout uses the normal exact-source CI/archive/staged/promotion gates with no schema, key, billing or owner metadata change. A normal live Sync All can retain the known Canvas access partial while confirming Ed and other destinations continue; a 401 is not closed as a repaired upstream permission.
