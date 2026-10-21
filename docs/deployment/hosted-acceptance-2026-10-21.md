# Hosted acceptance continuation — October 21

Status: in progress. Live observations in this record concern source `6db74878a0ab4db6e04769bc0733b1be0cc91907`, Worker `47580d73-00bc-457b-b74c-7c4eba79cf04`, unless a later deployment is explicitly recorded. Local repair tests do not establish a deployed fix.

## Completed observations

- The operator confirmed delivery of the new health workflow's intentional failure notification, [run 39689508514](https://github.com/Aieda1l/Kairos/actions/runs/39689508514). The subsequent ordinary [health run 39689749003](https://github.com/Aieda1l/Kairos/actions/runs/39689749003) passed. Both used documentation revision `8ea5ac1`; the synthetic run failed only its intended notification step. This closes health failure-notification delivery, independently of maintenance activation.
- Anonymous checks at 23:14 UTC returned HTML 200 without redirects for `/`, `/privacy`, `/terms`, `/support` and `/security`. The homepage identifies the UW purpose and unofficial status. Every page links the four public policy/contact pages. Mozilla's public API still reports signed-release version 0.4.0, a description containing the privacy link, homepage and support URL. This checks access/link consistency; it does not independently approve every policy statement or provider verification status.
- The operator created a disposable second account. Read-only inventory confirms it is empty, with its own identity/session. iCloud was intentionally tested on the main account, which also has Google and Microsoft calendars. This is account creation evidence, not authenticated cross-account isolation or deletion evidence.

## iCloud partial sync and duplicate report

The main account's iCloud connection is accepted. Its 22:54 UTC sync recorded `partial` / `CALENDAR_PARTIAL_SYNC`, with 13 mappings: 11 remote IDs, one rate-limit failure and one upstream failure without remote IDs. The durable calendar owner remains uncertain. The operator subsequently reports populated events, old events retained and supplies a screenshot showing duplicates, then confirms they remain with only iCloud Kairos visible. The current eligible assignment projections contain no identical title/deadline pairs. The extra remote entries remain unclassified; this is not evidence authorizing their removal.

At 23:13 UTC, the current projection and saved mappings identify 17 eligible assignments: 11 mapped remote events have unchanged content hashes, two mappings lack remote IDs, and four eligible assignments have no mapping. There are **zero current managed removal candidates**. No Apple inventory was read for this check. Kairos only deletes saved, connection-scoped managed events when their assignment becomes ineligible; it does not delete unrecognized older events or another calendar's copies. Past dates alone do not make an event ineligible. A stopped partial pass can also leave later work unprocessed. Do not delete entries from the screenshot or clear uncertainty without reconciling the actual prior outcome.

An aggregate window around this attempt records three successful Worker invocations, no runtime errors and 13 external subrequests. That is consistent with partial progress and a provider throttle, but it is not a retained HTTP trace and does not prove which individual request failed.

## Reproduced repairs

Two bounded defects were reproduced before their repairs:

1. The disconnect lifetime helper retained calendar operations but skipped source operations and bridge completion. An isolated native source probe lost final settlement after returning a response. The helper now retains all six provider operation keys and one-use bridge completion using the same pending work, without retries or automatic owner recovery. Bridge registration continues holding its owner until completion.
2. When one calendar write received 429, another request waiting for its ownership check could be cancelled **before HTTP dispatch**. Its ownership error became a calendar network error and falsely marked the owner uncertain. Known pre-dispatch throttle cancellation now retains the fixed calendar rate-limit classification and cooldown. A genuinely dispatched write with an unknown network outcome still requires recovery. Tests exercise both cases through the real Google, Microsoft and CalDAV adapters.

Three retained source owners were also observed. Canvas and Gradescope each match one unconsumed bridge request, so a running row alone does not prove lost settlement. Ed has no matching bridge request. The operator explicitly confirms earlier main-account source attempts have stopped. A subsequent exact-owner recovery must preserve accepted data, request evidence, nonces and cooldowns and fence old work through provider controls. No source or iCloud owner has been recovered in this observation record.

Local verification of these repairs: 1,573 tests passed, with 46 Windows skips (1,619 total); typecheck and lint passed, with six existing lint warnings. The Workers build, all 12 compiled-provider fixtures, expanded native lifetime probe for six keys plus bridge completion, and production-safety check passed. All provider fixtures used synthetic data with zero real external provider requests. The first full run found a stale module mock after the lifetime-helper rename; updating that fixture restored both privacy tests before the successful full run. Required Linux CI and a controlled deployment still follow.

## Free-plan and cleanup measurements

Read-only aggregate metrics for the deployed source, 22:22–22:52 UTC, report 56 successful invocations, zero runtime errors and CPU P50 **25.946 ms** / P99 **146.766 ms**. One disconnected invocation is separate. The narrow Google sync window has one invocation, 19 external subrequests and CPU **54.539 ms**. The Microsoft window contains ten invocations and must not be treated as an isolated Microsoft measurement. These observations do not establish Free CPU headroom. Cloudflare publishes a [10 ms Free CPU limit](https://developers.cloudflare.com/workers/platform/limits/) and describes [CPU rollover and invocation metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/); a successful invocation is not proof of adequate capacity. No paid plan was enabled.

The exact cleanup selector dry run, batch size 100, selected 100 rate events and zero runs/OAuth/bridge requests, reading 1,160 rows across four statements and writing zero. Backlog counts at that observation: 216 expired rate events, 30 expired runs, 32 expired OAuth requests and 182 expired bridge requests. Expiry alone does not make retained owner/request evidence deletable. SQL durations are not Worker CPU. No cleanup apply or maintenance workflow activation occurred.

## Remaining sequence

Verify and release the provider settlement/throttle repairs, then perform separately justified exact-owner recovery. Complete iCloud reconciliation and repeat/update/removal behavior, and the disposable-account onboarding, authenticated isolation, revocation, disconnect and deletion journeys while preserving the main account. Representative Free CPU capacity, intended maintenance activation/notification, authenticated rollback and final readiness remain open. Stored production logs stay disabled under the completed privacy assessment.

Private metadata-only receipts are retained under ignored `artifacts/m7-hosted-acceptance/`; they contain no credentials, provider response bodies or coursework. Historical incident records are preserved rather than overwritten.
