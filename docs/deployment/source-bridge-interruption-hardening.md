# Source bridge interruption hardening

Status: locally verified and independently reviewed candidate. No production rollout or extension update has been performed for this increment. Integration requires successful protected CI on the published head; production release remains a separate decision.

## Incident and established boundary

The November 12 UTC source incident had two admitted, unconsumed extension registrations from November 2: Canvas submission status and Gradescope sync. Both retained stale running ownership; Canvas deadlines shares the Canvas owner. Ed and the calendar owners were idle. This establishes unfinished bridge work, without identifying whether a start response was lost, the document disappeared, or completion failed before its claim.

After fresh confirmation that prior attempts had stopped, exact-owner recovery preserved accepted data, owner nonces, cooldowns and bridge evidence. The subsequent normal Sync All at 03:10:39–46 UTC completed all five root steps: Canvas deadlines, 13 Canvas statuses, 49 Gradescope statuses, 71 Ed statuses and all three calendar destinations. The status operations reported zero failures, and all six owners were idle afterward. This does not establish that an older inaccessible Canvas assignment gained access, or close all hosted acceptance conditions.

React unmount alone does not cancel the providers' awaited sync chains. The providers already live in the shared dashboard layout, and an admitted operation can still complete after its component unmounts while the document survives. Hard document destruction removes the page's only completion sender, while work dispatched to another browser tab may continue. A website timeout only removes its response listener; it does not prove cancellation.

## Candidate changes

- Automatic Canvas and Gradescope status checks require a ready extension/provider tab and visible document before server registration. Delayed readiness cannot admit work after its effect is cancelled or the document becomes hidden. Known-unready checks add no visibility or timer retry loop; manual retry stays available.
- Gradescope discovery sends one terminal completion for its registered request when readiness or bridge validation fails. The result retains the exact request ID and uses a fixed supported error category. A failed, invalid or lost completion response never causes an automatic second completion. Accepted connections and courses remain intact on failure.
- Explicit Sync All passes a client-only `deferRefresh` option. Canvas, Gradescope and Ed leave refresh to the coordinator after the source/calendar stages finish. Standalone actions retain their normal refresh behavior. Existing server admission IDs, metadata headers and extension payloads are unchanged.

The source also fixes shared extension-ping error classification for Gradescope, preserving supported unavailable/timeout categories instead of turning them into an unrelated invalid-result error. Error text remains fixed; private bridge or provider messages are not displayed.

## Local verification

Canvas readiness regressions had seven expected failures before the fix; Gradescope's expanded cases had fifteen; three composite cases observed premature refreshes before a later calendar stage completed. The final focused component set passes 133 cases. The ownership integration file passes 73 cases, including three additional checks that known terminal discovery rejection consumes once, preserves accepted course/connection rows and exact nonce/cooldown, permits a fresh start, and rejects duplicate completion. Existing extension-timeout uncertainty tests remain unchanged.

Full local Vitest passes 2,253 tests in 199 passing files, with 46 existing Windows test skips and two skipped files. The six targeted Chromium/Firefox cases pass: the existing complete Sync All flow, hard document loss, and zero automatic starts while tabs are unready followed by a successful explicit manual sync. These use synthetic bridge replies and real local guarded API/D1 paths, with no real provider traffic.

The first browser run passed two Chromium cases, then the new manual-retry test failed because it looked for Sync All on All Assignments, where the control is absent. The test now follows the existing Upcoming navigation and keeps every completion/count/retention assertion; response waits are attached through one awaited operation. No browser timeout or production behavior was changed for this correction. Failed traces and the later six-case result remain separately retained.

Independent ECC/security review found no actionable issue in the bounded production/test diff. Type/lint checks and the full protected CI graph are integration gates. Local test bodies and identifiers are synthetic; private production recovery anchors and credentials are excluded from tracked evidence.

## Remaining limitation

This closes avoidable readiness, discovery-completion and refresh-ordering gaps. It does not provide a page-independent whole-operation acknowledgement, solve every lost start/completion response, or guarantee recovery after a real tab/process crash. The browser test deliberately confirms that hard document loss preserves ownership and saved data. Existing expiry, exact-owner/control/tenant fences, timeout uncertainty and operator-confirmed recovery remain intact; there is no clock-based lock release, cancellation claim, recovery endpoint, schema change or extension permission expansion.

See the [implementation plan](../superpowers/plans/2026-11-11-source-bridge-interruptions.md), [incident recovery procedure](incident-response.md#targeted-uncertain-operation-recovery), and [earlier Sync All release record](sync-all-reliability-2026-10-24.md).
