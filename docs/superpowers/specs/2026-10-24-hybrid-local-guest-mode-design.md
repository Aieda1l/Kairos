# Hybrid local guest mode

Date: 2026-10-24

Status: **APPROVED by the user on 2026-10-24.** Approval covers this design and its proposed first-release boundaries. It does not authorize production activation or claim implementation exists. The next checkpoint is review of the detailed implementation plan and execution method.

## 1. Intent and decisions

People should be able to use Kairos without creating or signing into a Kairos account. The user confirmed that the first guest release includes live Canvas, Gradescope and Ed syncing, then selected the **hybrid** approach: save coursework and preferences on the device, while Canvas feed and Ed requests may pass transiently through Kairos's server.

Provider access is separate from a Kairos account. Canvas submission statuses and Gradescope still require the existing Firefox extension and signed-in provider tabs. Canvas feed and Ed requests use the user's private feed URL/personal API token and do not require Firefox.

The following engineering defaults were accepted through design approval; the explicit no-account, three-source and hybrid decisions above came directly from the user's earlier choices:

- Guest views and data live at `/guest`; the hosted account application remains a separate mode.
- IndexedDB stores guest coursework and source configuration. Credentials are memory-only by default, with explicit optional remembering on this device.
- Backup export/import ships in the first release. It excludes credentials and replaces, rather than merges, a guest dataset on import.
- Guest v1 does not add outbound Google/Microsoft/iCloud connections, cold-start offline/PWA support, cross-device sync, or guest-to-account transfer. Its Calendar view displays local assignments. Those features need separate designs; account mode retains its existing integrations.
- Existing Canvas/Gradescope stale-on-open behavior is coordinated locally; there is no periodic background alarm. Every manual run reports its own outcomes.
- Guest code is developed behind a default-off feature flag. Public activation requires separate capacity/security/acceptance evidence and a concrete deployment review.

## 2. Approaches considered

| Approach | Behavior and tradeoff | Decision |
| --- | --- | --- |
| Device-only | Extension fetches all providers; new feed/Ed commands and permissions required. Source secrets/responses stay off the backend. | Considered; user chose hybrid instead. |
| Hybrid local data | Browser owns saved coursework; server performs bounded feed/Ed reads using request-scoped credentials; existing extension handles Canvas statuses/Gradescope. | **Selected by the user.** |
| Anonymous hosted dataset | Server saves coursework under a temporary identity. | Rejected: it does not implement the agreed local-storage boundary. |

This is a multi-increment feature, not an authentication bypass or a restored SQLite runtime. Current `npm run dev` uses local D1; `better-sqlite3` remains test-only. No synthetic Auth.js user/account is created for a guest.

## 3. Existing seams and reuse

The root layout has no account gate. Add guest routes outside `src/app/(dashboard)`, whose layout requires authentication and loads D1 repositories. Source runtime and current source APIs remain account-bound. Guest endpoints must not call hosted connection, credential, onboarding-draft, source-sync, bridge-start/completion or owned-operation services.

Reuse normalized assignment types, date/query helpers and prop-fed table/calendar/filter/timezone components. Extract presentation/composition seams where `AssignmentExplorer`, Settings and navigation currently embed hosted providers, account URLs or sign-out controls. Client guest updates subscribe to their local store; source completion must not call `router.refresh()` to reload server-owned dashboard data.

Reuse Canvas iCal parsing through a shared normalization boundary, preserving date-only Pacific handling, event filtering and SHA-256 fallback identity. Keep the server wrapper server-only. Ed parsing/schemas are reusable; inject a bounded transport rather than importing the existing diagnostics/AsyncLocalStorage graph into client code. Canvas/Gradescope DOM extraction and strict v1 bridge protocols remain unchanged.

## 4. Entry and user behavior

When `KAIROS_GUEST_ENABLED` is exactly `true`, the public entry page offers **Continue without an account** alongside account sign-in. Direct `/guest` entry works without an Auth.js session. Proposed guest pages are `/guest/upcoming`, `/guest/calendar`, `/guest/assignments`, `/guest/sources` and `/guest/settings`; `/guest` opens Upcoming. Disabled guest routes/endpoints return a fixed unavailable/404 response and the public entry link is hidden.

Guest mode consistently says **Saved in this browser**. It explains that Canvas feed/Ed secrets and responses are processed transiently by Kairos when those reads run. Source setup does not lead to Kairos sign-in. A browser check used to protect server reads is not account creation.

Canvas setup accepts the private calendar feed URL and can additionally enable Firefox submission-status checks. Gradescope discovers courses through Firefox, then requires explicit course selection. Ed accepts a personal token, discovers courses through the server, and requires explicit selection. Missing Firefox affects only extension-backed features; Canvas deadlines and Ed remain available in other supported browsers.

Source cards display independent current attempt and last successful state. A partial result retains saved rows and reports counts/cause; one source failure does not hide later successes. Empty results are distinguished from failed reads. No secret is echoed by a response or rendered into general source health data.

Choosing account mode leaves the guest dataset intact. Signing in, signing out, switching account identities, or deleting a hosted account never implicitly uploads, renders, overwrites or clears guest coursework. Guest reset never mutates hosted data. Theme may retain the existing device-wide next-themes preference; guest timezone and coursework/source preferences are independently stored.

## 5. Local data ownership

Use a versioned IndexedDB database, proposed name `kairos-guest`, with explicit schema migrations and a rendering projection compatible with existing components. Stores cover:

| Store | Required identity/content |
| --- | --- |
| Metadata | Schema version, random dataset instance ID, run generation and short local lease |
| Source connections | Local UUID, source kind, enabled state, generation, setup metadata and timestamps |
| Courses | Local UUID, connection ID, external course ID, display metadata, enabled selection, first/last seen |
| Assignments | Local UUID, connection ID, external ID and the complete normalized assignment metadata |
| Submission status | Assignment reference, state/late/missing flags, grade fields, checkedAt and extractor version |
| Source sync state | Attempt/success timestamps, safe error category and current result counts |
| Preferences | Timezone, filters and automatic-check preferences |
| Remembered credentials | Optional separate record per connection; never part of ordinary projections/backups |

One active connection per source kind is the initial supported model. Source identity is **connection ID + external ID**, not title/date and not source kind alone. Preserve local IDs and first-seen values during normal sync; a missing upstream row does not imply deletion.

Keep assignment metadata, submission freshness and source freshness separate. Accept status results only when strictly newer; equal-time results are first-wins. Gradescope metadata also has stale/equal protection. Failed items/courses keep accepted data; successful empty courses can advance freshness; total failure preserves the prior success timestamp. Commit related metadata/status updates and their outcome atomically.

Proposed initial dataset bounds are 10,000 assignments/statuses, 1,000 courses and an 8 MiB serialized noncredential dataset. Each accepted commit must remain exportable inside the 10 MiB backup bound. Limit breaches reject the affected transaction with retained-data guidance rather than silently dropping records. These are proposed product limits to verify with fixtures.

If storage cannot open, migrations fail, quota is exceeded or a transaction aborts, do not silently switch to unsaved mode or erase prior data. Show a recoverable error and available backup/reset actions. Request persistent storage after a user saves data, but continue honestly if permission is denied. Clearing browser data/private-session lifetime can remove guest data; server recovery is not available for this dataset.

## 6. Credentials, disconnect and reset

The default feed URL/Ed token lives only in guest memory. An explicit **Remember on this device** choice stores it separately in IndexedDB. Explain that this is browser-profile storage, not a claim of application encryption at rest or isolation from trusted same-origin scripts. Reloading without remembered credentials keeps coursework but asks for the secret before the next corresponding server sync. Raw secrets never enter URL/query parameters, analytics, logs, error text or ordinary backup files.

Disconnect/source replacement requires confirmation, invalidates its generation and pending requests, removes its remembered/in-memory secret, and deletes that connection's local imported data in one transaction. Make that deletion explicit and offer backup export before confirmation. Replacing a source uses a new connection ID; do not silently merge a different provider identity into saved coursework. A failed credential test changes nothing accepted.

The existing bridge follows the signed-in provider tabs; it does not prove provider-account identity or select Firefox containers. Do not claim automatic detection of a provider-account switch. Setup/reconnect copy must tell the user to use the intended signed-in profile, and switching the underlying source account uses explicit disconnect/replacement.

Clear guest data invalidates the dataset instance/run generation before clearing all stores and remembered secrets. Old callbacks must require the original dataset and existing connection, never auto-create missing records. Other open guest tabs close/version-change their storage handles, discard pending results and show the reset state. Clearing the guest capability cookie is a same-origin server operation; clearing local coursework does not erase anti-abuse counters or hosted data.

## 7. Hybrid server API

Add separate POST-only endpoints. They ignore Auth.js identity even when an account cookie is present, never redirect to Kairos sign-in and do not read or write account coursework/credentials. The only D1 writes permitted are the explicit anonymous admission metadata described below.

| Endpoint | Strict input | Normalized output |
| --- | --- | --- |
| `/api/guest/session` | Guest Turnstile proof | Short-lived guest capability cookie; no account |
| `/api/guest/session/end` | Empty JSON object | Expire guest capability cookie |
| `/api/guest/sources/canvas/feed` | Version, request UUID, feed URL | Normalized Canvas assignments + skipped/malformed/partial report |
| `/api/guest/sources/ed/courses` | Version, request UUID, token | Allowlisted course ID/name/term/year fields only |
| `/api/guest/sources/ed/lessons` | Version, request UUID, token, one decimal course ID | Normalized visible lessons/progress for that course only |

All source requests/results use schema version 1 and a caller UUID for correlation, not authorization. Success echoes that UUID and a server checkedAt. Strict input excludes user/account IDs, upstream origins/paths/headers, local assignment rows and arrays that cause server-side course fanout. No arbitrary proxy endpoint is exposed. Ed Sync All queues one course per request in the browser; the upstream client has no verified cursor pagination contract.

The shared error shape is `{ok:false, code, message, retryAfterSeconds?}` with allowlisted codes and fixed copy. Missing/expired guest capability is 401 `GUEST_SESSION_REQUIRED`, not a sign-in redirect. Invalid provider credentials use a distinct 422 source error, so the client does not confuse Ed auth failure with guest-cookie renewal. Origin/challenge failures are 403, malformed input 400, unsupported media 415, rate denial 429 with integer Retry-After, source-result limits 422, and unavailable infrastructure/provider controls 503. Provider read failures have fixed source categories; no upstream exception/HTML/body is returned.

Require exact Origin validation, JSON content type and streamed request-body limits before parsing. All guest API success/error responses use `Cache-Control: no-store, private`; no wildcard credentialed CORS, CDN/source caching, credential redirects or provider URL in a diagnostic is permitted. Existing fixed structured diagnostics can record operation/error category and opaque correlation only. Production log persistence remains disabled.

### Proposed bounds

These limits are new proposed defaults, not properties the existing readers already enforce. Measure them before activation; byte/item limits alone do not establish Free CPU safety.

| Boundary | Proposed default |
| --- | --- |
| Request body | 16,384 UTF-8 bytes; feed URL/token trimmed length 1–4096 |
| Course ID | Decimal digits, at most 32 characters |
| Whole upstream operation | 15 seconds, including redirects and bounded body reading |
| Canvas feed | 2 MiB upstream, at most 5,000 event blocks, at most 2,000 assignments, 2 MiB normalized output |
| Ed discovery | 2 MiB upstream, at most 500 courses, 512 KiB normalized output |
| Ed lessons | One course, 2 MiB upstream, at most 2,000 raw/1,000 visible normalized lessons, 2 MiB output |

Enforce upstream bytes while streaming, before `.text()`, JSON or iCal parsing. Cancel reading on a breach. Reject oversized results atomically; do not truncate and call a source complete. Preserve valid-sibling Canvas parsing with explicit partial diagnostics; an all-malformed assignment feed fails while ordinary nonassignment calendar events can produce a legitimate empty result. Match existing Ed visibility, effective dates and progress semantics.

Reuse existing strict protocol field-length precedents where suitable (title/status text 500, course short name 160, full name 240, term 80, year 16). Validate additional fields explicitly; never truncate identity keys into collisions. Return canonical supported Canvas/Gradescope links only; Ed source links remain null until a mapping is verified. Do not attach raw profile data, headers or request credentials to normalized responses.

Canvas requires exact `url.origin === "https://canvas.uw.edu"`, without embedded URL credentials, on the initial URL and every redirect destination; alternate ports/origins are rejected. Allow at most six HTTP attempts total. Ed uses only `https://us.edstem.org/api/user` and `/api/courses/{decimalId}/lessons`, refuses redirects and sends only the fixed authorization/accept headers. New wrappers call bounded readers/pure parsers, not owned hosted source services. DNS/redirect and body behavior need native workerd tests, not only mocked fetch tests.

## 8. Anonymous admission without an account

A guest cookie is a short-lived anti-abuse capability, not a Kairos account, source credential or server coursework dataset. Browsing saved guest data and existing extension reads do not require it. Server feed/Ed reads do.

`POST /api/guest/session` enforces exact origin, trusted network admission and a distinct Turnstile action, proposed `guest_sync`. Reuse server-side Siteverify hostname/action verification and its existing 2,048-character proof, 5-second fetch and 8 KiB response limits. A widget alone is not validation. Failed/expired/replayed proofs cannot mint a capability.

Proposed capability: strict version-1 payload containing a cryptographically random 32-byte guest session identifier, canonical audience, server issuance time and fixed 30-minute expiry, HMAC-signed with a new explicit `guest-capability` subkey purpose derived from `KAIROS_ABUSE_KEY_V1`. Preserve existing rate-key/auth-attempt derivation vectors; do not reuse their signing domain or a credential-encryption key. Verify bounded encoding/schema/signature/audience/time before use. Reject duplicate cookie names rather than guessing.

Production cookie name is `__Host-kairos-guest-sync`, with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. The host prefix requires Path=/, not `/api/guest`. Strictly loopback development may use a separate unprefixed development cookie and test transport under existing nonproduction guards; production never accepts that cookie/test proof. Session end clears only this capability. Hosted authentication ignores it; guest handlers ignore account cookies.

Extend anonymous rate-subject/policy types explicitly. `abuse_rate_events.user_id` already permits null, so guest rate events require no user row or new table. Use HMAC network/session/global keys with stable guest-specific labels and server/database time. Trust only the configured Cloudflare ingress normalization; never accept forwarded client identity or a browser-provided guest ID as a verified network.

Proposed initial limits: session bootstrap 10 per 10 minutes per network; source reads 30 per 10 minutes per guest capability, 60 per 10 minutes per network, and 60 per 10 minutes guest-global across Canvas/Ed. Recreating cookies cannot reset the network/global budget. These conservative defaults and their shared-network effects must be checked against normal selected-course runs and cost measurements before rollout. They are separate from existing account budgets.

Consume admission in a fixed network → session → global order. A later denial may leave earlier conservative budget charges; no refund/retry race is introduced. The guest-global limit bounds admitted upstream reads, not earlier D1 charges or distributed session-bootstrap/Siteverify traffic. Capacity evidence must therefore include globally denied requests, bootstrap floods across network subjects and cleanup of all charges; do not infer a D1 cost ceiling from the upstream limit. Return the denial's retry delay and perform no upstream fetch. Storage/configuration failures fail closed. Reuse provider-wide Canvas/Ed kill switches, checking control state/version before dispatch, before Canvas redirects and before publishing results. Do not write `operation_locks` or a held browser bridge request for guest reads.

No new abuse-control SQL key is required: `KAIROS_GUEST_ENABLED` is the default-off feature stop, existing provider controls remain shared stops. Anonymous D1 events contain hashes/time metadata, not tokens, feed URLs, coursework, raw IP addresses or account references. Existing events have an expiry horizon, but expiry is not proof of physical deletion. Public activation requires a documented, approved, bounded cleanup/retention mechanism and measured backlog costs. This feature does not silently activate the still-separate production maintenance job.

## 9. Guest orchestration and interruption

Use one guest coordinator for manual/automatic triggers. Acquire a short renewable local lease in an IndexedDB compare-and-set transaction (proposed 30 seconds, renewal every 5 seconds), with a fresh run nonce and monotonically advanced dataset run generation. Another tab gets an explicit busy outcome. BroadcastChannel can notify tabs, but transaction checks are authoritative.

An expired local lease may be superseded because guest operations are read-only upstream and every commit is fenced; this does not imply old network reads stopped. Record dataset instance, run generation, connection generation, request UUID, requested item/course membership and deadline before dispatch. Commit only if all still match a live local registry/lease entry; missing/disconnected/reset data is never recreated from a late reply. New imports/resets use a new dataset instance. Explicit retries use new IDs and epochs.

A proposed manual Sync All sequence is Canvas feed → Canvas statuses → selected Gradescope courses → selected Ed courses. Discovery/selection is setup or explicit refresh, not an unbounded server task. Canvas status batches use at most 25 locators within the existing 100-locator protocol cap; Gradescope uses one selected course per batch within v1 limits. Ed uses one bounded server request per selected course. Proposed overall run deadline is 180 seconds and at most 100 dispatched operations; a source or run cap yields a visible partial/timed-out result with earlier accepted data retained.

Each stage returns a current-run success/partial/failed/skipped/timed-out/cancelled outcome. Ordinary source failure permits later independent sources within the deadline. Extension timeout stops additional extension batches for that run; eligible Ed reads may continue. Server 429/auth errors stop that server-source queue with saved data retained and a clear retry/credential action. Do not borrow a prior success banner or silently treat an early return as completion.

The current extension's 30-second page timeout only stops waiting. It does not cancel provider fetches. On timeout, invalidate local request membership, stop queuing more batches and discard late results; use a bounded retry delay (at least 60 seconds unless a longer valid source delay applies). Do not automatically retry uncertain/failed upstream reads. User cancellation aborts server fetches best-effort and invalidates local writes immediately; it must not claim legacy extension work was cancelled upstream.

Reuse protocol-v1 schemas and bridge functions directly with fresh per-batch UUIDs. Require matching nested/outer IDs, requested Canvas local/course/assignment tuples, requested Gradescope courses, duplicate rejection and valid result membership before local commits. Current extension 0.4.0 requires no new permissions/commands for this hybrid. Do not append fields to strict v1 envelopes. A valid PONG/tab capability is the compatibility signal; the website version field is intentionally not shared.

Stale-on-open Canvas statuses/Gradescope checks run at most once after local storage is ready and use the same coordinator/lease as manual work. Preserve the 15-minute freshness meaning. Manual work never races a second guest provider instance; the button reflects active work and can stop waiting explicitly. Ed/feed remain manual. No completion triggers a server-data router refresh, and no guest request enters hosted `/start`/`complete` ownership.

## 10. Backup and account separation

Export a versioned JSON snapshot of normalized noncredential stores, provenance and preferences. State plainly that it contains private coursework/grades. Do not include credentials, guest cookies, server keys or pending requests/leases.

Import validates UTF-8 byte/count/field bounds, schema version, dates/timezone, supported URLs, source/connection membership and references before changing data. Initial import **replaces** the current guest dataset after confirmation; it does not guess a merge. Use an atomic replacement transaction with a new dataset instance and fresh connection mapping, clearing pending work. Invalid/unsupported/quota-failed import leaves the original dataset intact.

Guest-to-account transfer is deferred rather than automatic. Current hosted uniqueness is user + connection + external ID, and a same-kind connection may belong to a different provider identity. Any later transfer needs explicit provenance/conflict/credential consent and its own authorization design. Account sign-in is never a prerequisite for basic guest use.

## 11. Implementation sequencing and release gates

After design approval, write an increment-by-increment implementation plan. Suggested dependency order:

1. Prove bounded transient reader/admission feasibility with synthetic native-worker measurements; create the browser store/merge contracts and guest composition in isolation.
2. Implement guest capability/origin/budget/control checks and the three bounded transient source reads, with the feature still off in production.
3. Implement direct guest Canvas/Gradescope bridge orchestration, local course selection/ingestion, current-run outcomes and cross-tab/reset fences.
4. Complete source/settings UX, remembered-credential choice, backup/reset/import behavior and guest/account separation.
5. Run complete fixtures/native/browser checks, operator live acceptance and measured staged capacity/privacy checks before a concrete activation proposal.

Workers Free remains the default. Server-side 15-second wall deadlines and successful requests do not establish CPU headroom. Measure guest bootstrap, Canvas parse, Ed discovery and one-course normalization separately, with normal and adversarial near-cap payloads, admitted and denied traffic, distributed bootstrap, admission D1 read/write costs and cleanup costs. Current Cloudflare documentation lists 10 ms HTTP CPU on Free. Existing hosted measurements already leave headroom open; anonymous guest traffic must not be enabled by assuming those results passed.

If representative operations do not fit reliable Free bounds, keep guest server transport disabled and bring measured optimization/smaller-invocation/hosting alternatives for a concrete decision. Do not silently buy a plan, remove required live sources, widen an arbitrary proxy, or advertise all-provider support based on mocked tests.

Production guest activation, changes to public policies and any maintenance activation remain concrete release steps after implementation and review. No deployment, billing, secret rotation, source connection or production data mutation is part of this design work.

## 12. Acceptance criteria

- Unauthenticated visitors can enter guest views, connect the agreed sources, sync and reload saved coursework without a Kairos account or automatic sign-in redirect.
- Canvas feed and Ed reads work without Firefox; Canvas statuses/Gradescope use signed-in Firefox with the existing extension. Missing/signed-out/older bridge outcomes are explicit and preserve data.
- Guest source responses/credentials never create account, source, assignment, credential, draft, OAuth or operation-owner records in D1. Anonymous admission metadata is the explicit exception, tested structurally.
- Every anonymous request has exact origin/proof/capability/body/budget/provider-control gates; expired, replayed, wrong-audience or wrong-purpose inputs and untrusted ingress fail before upstream work.
- Fixed-origin, redirect, timeout, response-byte/item/output limits and safe diagnostics are verified in native workerd, including bodies without Content-Length and errors carrying synthetic secret markers.
- Local identity/freshness/partial/empty/total-failure semantics match existing source behavior; repeated sync is duplicate-safe and never deletes omitted items.
- Same-browser guest/account switching, two accounts, reload during a read, two guest tabs, lost leases, late replies, disconnect/reset/import and storage failures cannot cross-write or resurrect data.
- Export/import is bounded, credential-free, reference-valid and atomic; source replacement/reset only affects the confirmed local dataset.
- All current source/extension/calendar/auth/tenant/security regression checks pass; guest changes do not weaken account authorization or hosted ownership.
- Operator live checks establish actual Canvas feed/status, Gradescope discovery/status and Ed discovery/progress behavior. Full browser captures and credentials are not requested in chat.
- Release evidence distinguishes successful flow, any legitimate Canvas partial, native transport verification, measured Free capacity and remaining broader beta gates. No all-provider or offline promise is inferred from a source-level pass.

## 13. References and evidence boundaries

Repository evidence: `src/app/(dashboard)/layout.tsx`, `src/app/layout.tsx`, `src/lib/platform/source-runtime.ts`, `src/lib/platform/abuse-runtime.ts`, `src/lib/abuse/{keys,guard,policy}.ts`, D1 rate/source repositories, source parsers/clients, extension v1 protocols, and `extension/firefox/manifest.json`. Read-only research notes are retained in ignored `artifacts/guest-mode-design/research.md`; their earlier device-only recommendation is superseded by the user's hybrid decision.

Primary browser/platform references consulted on 2026-10-24:

- [IndexedDB terminology and transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology)
- [IndexedDB atomic changes and browser shutdown](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Cookie scope and host-prefix rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Mozilla content-script and background boundaries](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)

These references support platform constraints, not evidence that this guest implementation or its native transports already work. The user approved the full design before implementation planning. [The implementation plan](../plans/2026-10-24-hybrid-local-guest-mode.md) records the next review/execution checkpoint.
