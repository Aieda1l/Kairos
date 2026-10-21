# Free-plan calendar invocations — October 21, 2026 UTC

Goal: keep the measured Google/Microsoft calendar recovery on Workers Free by sending each destination through a separate HTTP invocation. No billing, schema, encryption-key or browser-extension change is required.

## Request flow

1. The browser finishes the source steps of Sync All with automatic calendar refresh held.
2. `POST /api/calendars/sync-all` with `x-kairos-calendar-invocations: separate` authenticates and charges the shared Sync All budget, or consumes its already-admitted calendar step. It performs no provider calls and issues one destination-bound ticket for each enabled connection owned by that user. Preparation is bounded to 100 destinations.
3. The browser sends each ticket in a separate `POST /api/calendars/{id}/sync` using `x-kairos-calendar-run`. Each request atomically claims that ticket, then pays its ordinary destination/provider budget and uses the existing durable owner, control-version fences and transport checks. A provider failure does not discard another destination's result.
4. Each result updates the existing UI. New source completions are exposed with the user's calendar metadata, so an open browser can start reconciliation after a normal source refresh. Hosted source handlers no longer call calendar providers inline. Failed automatic attempts keep their 15-minute pacing; a manual Sync All holds automatic refresh until its explicit final calendar pass.

Tickets are opaque random UUIDs stored as object entries in the existing `sync_all_runs.eligible_steps_json`. General Sync All eligibility remains string entries; existing generic step claims cannot consume or promote a destination ticket into a full fanout. Claims require the same user, exact connection, enabled destination and unexpired run, and use the existing unique `sync_all_steps` key to reject replay/concurrent duplicate claims. Ten-minute expiration and existing cleanup/account-deletion cascades apply. The tickets contain no credentials and are never part of the Firefox bridge protocol.

The old hosted multi-destination endpoint rejects an unsplit request before provider work. Existing local/legacy behavior remains available for the compatibility harness. A single destination can also still be manually synchronized through its existing endpoint.

## Verification

- Repository/API tests cover cross-user and wrong-destination rejection, ordinary-run misuse, expiry, disabled destinations, single use and competing consumers. Root admission is charged once; provider budgets remain independent and authoritative.
- Component tests cover separate child requests, independent provider failures, source-triggered reconciliation, visibility retry pacing and the automatic-refresh hold during root Sync All.
- The compiled workerd probe uses 66 synthetic assignments and local provider fixtures. Initial recovery succeeds in separate Google/Microsoft invocations with 29 and 31 external requests respectively (112 and 84 SQL statements including the ticket claim). Repeat requests use 18 external calls each and create no duplicates. All destination owners return idle, and ticket replay returns 400.
- The native probe enforces 50 external requests per invocation and a separate 1,000-statement conservative D1 bound. Existing 17/40/46-statement Gradescope/Microsoft/Google optimization regressions remain asserted independently; the old artificial 50-statement ceiling is no longer represented as the platform limit.

The browser must remain open to finish all destination requests. If it closes between them, later reconciliation uses durable event mappings and idempotent provider operations. This change addresses the measured combined-request overflow; a future single destination whose own workload exceeds Free limits will need bounded continuation or batching. Synthetic request counts do not establish live provider acceptance or Free CPU headroom.

## Hosted recovery

After the exact merged source passes CI, stage and verify its compiled Worker using the existing seven-migration release checks. Preserve production bindings, secrets, owners, mappings and controls. After promotion and public health/isolation smoke, reopen each idle provider using its exact paused control version. Google retains its disabled reconstructed connection until the user supplies fresh consent through the product. Verify actual Microsoft sync, Google reconnection/sync, combined Sync All and CPU/error outcomes before closing hosted calendar acceptance.
