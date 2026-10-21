# October 21 calendar reconnect and interrupted-operation repair

The incident began on the Free-plan split release (`67ca0f4`, Worker `e2fdf405-e437-4938-9860-aa3b2b84c53a`). The user reported Microsoft busy/recovery errors, followed by a local disconnect, and a Google reconnect returning raw `CALENDAR_AUTH_EXPIRED` JSON after consent. The repair is now deployed as source `5547ff1` / Worker `3f083be0-d112-4035-97f8-185c06506313`; acceptance is recorded below.

## Evidence and recovery

Read-only inspection found one Microsoft owner still `running`, started at 16:29:33 UTC. The corresponding 35-second Cloudflare metrics window contains one `clientDisconnected` invocation with zero external requests and no runtime errors. No CPU/subrequest termination appears in that window. Browser navigation interrupting the operation is the supported explanation; request metadata was deliberately not persisted, so the exact navigation cannot be reconstructed.

The connected Outlook Calendar inventory contains exactly 17 events in one writable Kairos calendar. All 17 uniquely match current assignments by title, course and start/end time. The user explicitly confirmed all earlier sync/OAuth work stopped. The local disconnect removed its connection, credentials and mappings, while retaining the provider owner.

Recovery paused only Microsoft (control version 2 to 3), reconstructed one **disabled** connection and its 17 existing remote-event mappings, then settled only the exact stale owner with compare-and-swap. The nonce and cooldown were preserved. No remote calendar/event writes, credential recovery, key changes or billing changes occurred. Fresh Microsoft consent is required. Google retains its disabled connection and 11 mappings, also awaiting fresh consent.

The reconstructed Microsoft mappings have no trusted content hashes. The current 77-assignment workload therefore estimates **45** external requests for its first sync (10 creates, 6 updates, 11 deletes); Google estimates 29. Each still fits the Free-plan limit as a separate invocation. These are estimates, not real-provider acceptance.

## Runtime repair

Calendar ownership now retains the same operation promise with Cloudflare's `waitUntil`, including acquisition and final owner persistence. The normal caller still awaits the result. The lifetime task consumes rejection without retrying work or changing the caller's error. Browser calendar sync/removal fetches also use `keepalive` so ordinary navigation can preserve their request. Cloudflare's post-disconnect grace period is bounded; a genuinely interrupted or ambiguous write still requires reconciliation and exact-owner recovery.

A new native workerd regression starts an owned calendar operation, ends its HTTP response, and checks the subsequent D1 completion and owner release from an independent request. It fails before the repair with `CALENDAR_SETTLEMENT_CANCELLED_AFTER_RESPONSE` and passes afterward. This exercises actual request lifetime rather than a mocked transport. Unit/integration coverage also checks contention, retained settlement and original error propagation.

## Google reconnect

The reported message is emitted during saved-calendar access verification, after the token exchange. The provider body/status was not retained, so the exact upstream rejection remains unverified. The old path classified every Google 403 as expired authorization and displayed JSON at the callback URL.

On a CalendarList permission rejection, the repair makes one additional read of **only the saved calendar's effective event role** (`events.list`, `maxResults=1`, `fields=accessRole`). It accepts only owner/write roles, retains the original calendar ID and mappings, and requests no additional OAuth scopes. Read-only, denied, missing or malformed results still reject the replacement. A final 403 reports permission denied; only 401 reports expired authorization. Recognized API-disabled and quota reasons remain configuration/rate-limit errors and do not trigger a fallback. Google callback failures return to the registered app page with fixed error/stage codes, clearing the one-time OAuth code from the resulting URL.

Both [CalendarList.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get) and [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) document `calendar.app.created`; the fallback is a compatibility check, not proof that this user's grant permits access. A fresh real-account reconnect is required to establish that.

## Release acceptance

[PR #26](https://github.com/Aieda1l/Kairos/pull/26) merged as `5547ff13a8eb43b7ab749b4dbec8e04e2c7dbff2`. [Exact-main CI](https://github.com/Aieda1l/Kairos/actions/runs/39644756198) passed 1,571 tests and all 63 browser cases, including native calendar lifetime and compiled-provider checks. The sealed build passed staged configuration, seven-migration schema, required secret-name, isolation and health checks. Worker `3f083be0-d112-4035-97f8-185c06506313` was promoted at 17:40 UTC in deployment `6b54d8bb-1759-48ed-8334-cf540b1fb1a2`; served client hashes and all 11 anonymous smoke checks passed. The [GitHub health check](https://github.com/Aieda1l/Kairos/actions/runs/39645991114) also passed.

Both provider controls are reopened at version 4. A live Free-plan replay using 77 synthetic assignments passed separate first-sync invocations with 29 Google and 45 Microsoft external requests, then 18 each on repeat; both owners returned idle. Temporary replay Workers and D1 were deleted. This establishes the measured request shape, not general Free CPU headroom.

The user subsequently reported success. Read-only production state at 17:48 UTC confirms Microsoft consent consumed at 17:46:54 UTC and successful sync at 17:47:13 UTC: enabled connection, one credential, 17 mappings and idle owner. Google remains disabled with no credential and 11 preserved mappings, despite a consumed callback at 17:46:44 UTC. Its successful reconnect/sync is therefore still unverified; clarification is pending. No remote event writes were made by the recovery procedure. Do not clear owners based on elapsed time alone.
