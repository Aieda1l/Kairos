# iCloud mapping recovery — October 22 UTC

Status: in progress. This follows the [October 21 hosted acceptance](hosted-acceptance-2026-10-21.md). iCloud recovery and duplicate cleanup are distinct: restoring the connection must not silently delete existing remote events.

## Confirmed inventory

At 00:05 UTC, the private Apple checker completed three PROPFIND requests and one REPORT, all returning 207. The selected writable Kairos calendar returned 32 response records: one calendar-level metadata record and 31 events. All 31 carry Kairos's generator/UID markers. There were no unclassified resources or non-Kairos events. The initial checker had incorrectly required every record to be an event; excluding the metadata record resolved the observed boundary failure. Earlier XML-attribute and duration fixes were independently reproduced interoperability defects, not the cause established by this live response.

Twelve of the 17 eligible assignments have exact remote matches: three have one copy and nine have multiple copies, totaling 21 matching event resources. Five eligible assignments have no exact match. Ten other events do not exactly match the current projections; that alone does not authorize deleting them. The operator had disconnected iCloud, so its connection, credential and local mappings are absent. The unchanged `calendar:caldav` owner remains uncertain. No provider or database writes were made by the checker.

The checker was verified against 18 offline response cases and an actual PowerShell-to-Node private-input/session handoff. Once fetched, the bounded response was kept only in memory for local reinspection. Reports contain counts/fingerprints only. The session expired at 00:20 UTC during the usage-limit pause; its raw response and credentials were not saved. Recovery therefore requires a fresh authenticated inventory, not reliance on the old counts.

## Reconnect defect and repair

Inspection of the inactive-destination recovery path found that accepted iCloud credentials inherited `enabled=false` from the recovered connection. A regression test reproduced that result before the repair. Accepted fresh credentials now set `enabled=true` after validating access to the same saved calendar, in the existing atomic connection/credential transaction. Rejected authorization leaves the inactive destination, missing credential and saved mappings unchanged. Provider validation still consists of read-only discovery; no calendar or event is created during reconnection.

Local verification: 1,575 tests passed with 46 Windows skips (1,621 total), typecheck and scoped lint passed. Required CI, clean release-artifact verification and controlled deployment follow; this record does not yet claim a deployed reconnect fix.

## Recovery sequence

The operator confirmed prior iCloud work stopped. The latest instruction is to proceed; the earlier choice between reset and preservation did not explicitly authorize remote deletion. Continue with a preservation plan: validate the current exact owner/control and account, obtain a fresh complete inventory, and prepare inactive metadata plus unambiguous existing-event associations. Preserve every remote event and the existing Google/Microsoft connections, source data and cooldowns. Restore access only through fresh credentials entered in Kairos after the reconnect repair is deployed.

Any targeted owner recovery must use the existing pause/version/nonce fences and verify the reconstructed inactive metadata before reopening. Do not clear uncertainty from elapsed time, erase request evidence, copy database snapshots, retire keys or enable paid billing. Actual mapping/owner recovery and fresh hosted reconnect/sync still need recorded outcomes. Older duplicate cleanup remains a separate explicit choice.
