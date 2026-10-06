# Calendar Destination Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-first one-way synchronization from Kairos assignments to dedicated Google Calendar, Microsoft Outlook/Microsoft 365, and Apple iCloud calendar destinations with idempotent event reconciliation and isolated provider failures.

**Architecture:** Keep Canvas, Gradescope, and Ed as assignment sources and add a separate calendar-destination subsystem backed by three new SQLite tables. A provider-neutral reconciliation engine projects normalized assignments into timed calendar events, tracks durable assignment↔remote-event links, and delegates transport/authentication to Google, Microsoft, or CalDAV adapters. Existing source syncs trigger best-effort destination reconciliation; the Upcoming `Sync All` flow defers those per-source pushes and performs one final destination pass.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node.js 22+, better-sqlite3, Zod, native `fetch`/`crypto`, fast-xml-parser 5.11.x for DAV XML, Vitest 5, Testing Library, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-calendar-sync-design.md`

## Global Constraints

- Calendar destinations are separate from assignment sources; do not add Google, Microsoft, or iCloud to `SourceKind`.
- The direction is one-way: Kairos → calendar.
- Each destination uses a dedicated calendar named **Kairos** rather than writing into the user's primary calendar.
- Only assignments with a non-null `dueAt` are eligible for external calendar events.
- Each generated event starts at the exact `dueAt` and ends 15 minutes later.
- Generated events are transparent/free where the provider supports that concept.
- Kairos does not create attendees, meetings, conferencing, or locations.
- Google uses OAuth 2.0 + PKCE and requests `https://www.googleapis.com/auth/calendar.app.created`.
- Microsoft uses authorization code + PKCE as a public client and requests delegated `Calendars.ReadWrite` plus `offline_access`.
- Apple iCloud uses CalDAV with the fixed Apple entry origin `https://caldav.icloud.com/` and an app-specific password.
- No user-controlled arbitrary authenticated HTTP URL is introduced in Milestone 5.
- OAuth refresh tokens and CalDAV credentials stay in local server-side SQLite and are never returned to normal client state.
- Access tokens and PKCE verifiers remain short-lived/in-memory where practical.
- Local SQLite credentials are **not encrypted at rest**; UI/docs must say so accurately.
- Repeated synchronization must be idempotent and must not create duplicate events.
- A user-deleted managed event is recreated on the next reconciliation.
- An assignment that explicitly becomes undated removes its previously generated event.
- Deleting the whole remote **Kairos** calendar must not silently recreate it during ordinary reconciliation.
- Source synchronization success is not rolled back by a destination failure.
- One calendar provider's failure must not abort another provider.
- Current Kairos source records remain independent; do not deduplicate or invent a canonical deadline.
- There is no hosted Kairos backend and no claim of 24/7 synchronization while the local app is closed.
- No real credential, refresh token, app password, authorization code, cookie, or authenticated raw payload may appear in tests, logs, screenshots, fixtures, or commits.
- A provider is not marked complete in the roadmap until a real-account smoke has been performed for that provider.

## Review Focus

1. **Create response lost after the provider already created the event:** retry with the persisted sync key must converge on one event, not duplicate it. Pinned by Task 3 reconciliation tests plus provider-specific idempotency tests in Tasks 4–6.
2. **CalDAV discovery returns a foreign absolute URL, redirect, or XML entity/DOCTYPE payload:** Kairos must fail closed before sending credentials outside the allowed Apple CalDAV host family or parsing dangerous XML. Pinned by Task 6.
3. **The entire remote Kairos calendar is deleted while individual event links still exist:** ordinary reconciliation must mark `CALENDAR_REMOTE_CALENDAR_MISSING` and preserve local mappings instead of silently creating a new calendar. Pinned by Task 3.
4. **Sync All has mixed source failures while calendars are connected:** it must issue one final destination reconciliation after all eligible source attempts, using the valid local state that remains, and surface calendar warnings without converting source success into failure. Pinned by Task 9.
5. **OAuth callback replay, expired state, or forged local redirect host:** callbacks must be one-time, expire after about 10 minutes, and never build a redirect URI from an untrusted non-loopback host. Pinned by Tasks 2 and 7.

---

### Task 1: Calendar persistence model, repositories, and branch CI

**Files:**
- Modify: `src/lib/db/migrate.ts`
- Create: `src/lib/calendar/types.ts`
- Create: `src/lib/db/repositories/calendar-connections.ts`
- Create: `src/lib/db/repositories/calendar-credentials.ts`
- Create: `src/lib/db/repositories/calendar-event-links.ts`
- Create: `tests/integration/calendar-schema.test.ts`
- Create: `tests/integration/calendar-repositories.test.ts`

**Interfaces:**
- Produces `CalendarProvider = "google" | "microsoft" | "caldav"`.
- Produces `CalendarSyncStatus = "never" | "success" | "partial" | "error"`.
- Produces public `CalendarConnection` metadata with no credential fields.
- Produces `CalendarEventLink` with `calendarConnectionId`, `assignmentId`, `syncKey`, `remoteEventId`, `remoteEtag`, `contentHash`, `lastSyncedAt`, and `lastErrorCode`.
- Produces `CalendarConnectionRepository.list(): CalendarConnection[]`, `getById(id)`, `create(input, now?)`, `updateRemoteCalendar(id, remoteCalendarId, remoteCalendarName, now?)`, `markSyncStarted(id, at)`, `markSyncResult(id, {completedAt,status,errorCode})`, and `delete(id)`.
- Produces `CalendarCredentialRepository.setOAuthRefreshToken(connectionId, token)`, `getOAuthRefreshToken(connectionId)`, `setCaldavCredentials(connectionId, username, secret)`, `getCaldavCredentials(connectionId)`, and `delete(connectionId)`.
- Produces `CalendarEventLinkRepository.get(connectionId, assignmentId)`, `listByConnection(connectionId)`, `ensure(connectionId, assignmentId, syncKey, now?)`, `markSynced(id, remoteEventId, remoteEtag, contentHash, syncedAt)`, `markError(id, errorCode, at)`, and `delete(id)`.

- [ ] **Step 1: Open a draft PR and verify the exact base is green**

Open a draft PR from `feat/milestone-5-calendar-sync` to `main` before the first implementation commit. The existing workflow already runs on pull requests to `main`, so do not add another milestone-specific branch trigger.

Require feature CI on the current docs-only head to pass before feature code begins.

Expected: existing tests, lint, typecheck, extension build, E2E, production build, dynamic-dashboard verification, and credential/permission review all pass on the exact starting head.

- [ ] **Step 2: Write failing schema/repository tests**

`calendar-schema.test.ts` asserts that migration creates:

- `calendar_connections`;
- `calendar_credentials`;
- `calendar_event_links`;
- provider CHECK values `google`, `microsoft`, `caldav`;
- sync status CHECK values `never`, `success`, `partial`, `error`;
- unique `(calendar_connection_id, assignment_id)`;
- unique `(calendar_connection_id, sync_key)`;
- no UNIQUE constraint on provider, so two Google connections are allowed.

`calendar-repositories.test.ts` asserts:

- two connections of the same provider can coexist;
- public connection JSON contains no refresh token or CalDAV secret;
- OAuth and CalDAV credentials round-trip only through the credential repository;
- `markSyncResult` preserves the previous successful timestamp after a later error;
- `ensure` returns the same event-link row for repeated connection/assignment calls;
- cascading connection deletion removes credentials and event links.

- [ ] **Step 3: Run the new tests and observe RED**

Run:

```bash
npm test -- tests/integration/calendar-schema.test.ts tests/integration/calendar-repositories.test.ts
```

Expected: FAIL because the calendar tables/types/repositories do not exist.

When local dependency execution is unavailable, push the tests-only commit and require branch CI to show the same expected failure before continuing.

- [ ] **Step 4: Implement the migration, types, and repositories**

Add the three tables from the approved spec. Keep `calendar_connections.provider` non-unique. Store `oauth_refresh_token`, `caldav_username`, and `caldav_secret` only in `calendar_credentials`.

Use additive migration behavior consistent with existing Kairos migrations; do not rebuild source tables or change `SourceKind`.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/integration/calendar-schema.test.ts tests/integration/calendar-repositories.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/db/migrate.ts src/lib/calendar/types.ts src/lib/db/repositories/calendar-connections.ts src/lib/db/repositories/calendar-credentials.ts src/lib/db/repositories/calendar-event-links.ts tests/integration/calendar-schema.test.ts tests/integration/calendar-repositories.test.ts
git commit -m "feat: add calendar destination persistence"
```

---

### Task 2: Event projection, stable sync keys, OAuth state registry, and calendar errors

**Files:**
- Create: `src/lib/calendar/projection.ts`
- Create: `src/lib/calendar/sync-key.ts`
- Create: `src/lib/calendar/errors.ts`
- Create: `src/lib/calendar/oauth-registry.ts`
- Create: `src/lib/calendar/local-oauth-origin.ts`
- Create: `tests/unit/calendar-projection.test.ts`
- Create: `tests/unit/calendar-sync-key.test.ts`
- Create: `tests/unit/calendar-oauth-registry.test.ts`
- Modify: `tests/integration/secret-exposure.test.ts`

**Interfaces:**
- Consumes `Assignment` and calendar types from Task 1.
- Produces `CalendarEventProjection = { assignmentId,title,description,startsAt,endsAt,sourceUrl }`.
- Produces `projectAssignment(assignment: Assignment): CalendarEventProjection | null`.
- Produces `hashCalendarProjection(projection): string` using SHA-256 over a deterministic serialization.
- Produces `createCalendarSyncKey(connectionId: string, assignmentId: string): string` as deterministic lowercase hex SHA-256.
- Produces `CalendarSyncErrorCode` containing every stable error code named by the spec.
- Produces `CalendarSyncError(code, message)`.
- Produces `registerOAuthRequest(input, now?): {state:string; codeChallenge:string}` and `consumeOAuthRequest(state, provider, now?): RegisteredOAuthRequest | null`.
- Produces `getLocalOAuthRedirectUri(requestUrl: string, callbackPath: string): string`, accepting only `localhost` and `127.0.0.1` HTTP origins and failing closed otherwise.

- [ ] **Step 1: Write failing projection/key tests**

Assert:

- null `dueAt` returns `null`;
- `2026-10-09T06:59:00.000Z` projects to start at exactly that instant and end at `2026-10-09T07:14:00.000Z`;
- title is `[CSE 331] Homework 3`;
- description includes course/source/status and the safe assignment source URL when present;
- description never includes a supplied fixture credential string;
- identical projections hash identically and changing title/due/status changes the hash;
- sync key is stable for one connection/assignment pair and differs when either ID differs.

- [ ] **Step 2: Write failing OAuth registry/origin tests**

Assert:

- PKCE challenge is S256/base64url and does not contain the verifier;
- state is one-time and cannot be replayed;
- entries expire after 10 minutes;
- consuming with the wrong provider returns null;
- `http://127.0.0.1:3000` and `http://localhost:3000` produce valid callback URIs;
- `https://evil.example`, `http://localhost.evil.example`, and URLs with embedded credentials are rejected.

Extend secret exposure coverage with fixture refresh token, authorization code, PKCE verifier, and CalDAV app password values.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- tests/unit/calendar-projection.test.ts tests/unit/calendar-sync-key.test.ts tests/unit/calendar-oauth-registry.test.ts tests/integration/secret-exposure.test.ts
```

Expected: FAIL because the new calendar modules do not exist.

- [ ] **Step 4: Implement minimal projection/security primitives**

Use exact 15-minute intervals. Escape/normalize description text but do not fetch source URLs. Store OAuth registry entries only in process memory with approximately 10-minute expiry and one-time consumption.

`CalendarSyncErrorCode` includes at least:

- `CALENDAR_AUTH_REQUIRED`
- `CALENDAR_AUTH_EXPIRED`
- `CALENDAR_CONFIG_MISSING`
- `CALENDAR_NETWORK_ERROR`
- `CALENDAR_RATE_LIMITED`
- `CALENDAR_UPSTREAM_ERROR`
- `CALENDAR_REMOTE_CALENDAR_MISSING`
- `CALENDAR_EVENT_INVALID`
- `CALENDAR_PARTIAL_SYNC`
- `CALDAV_DISCOVERY_FAILED`
- `CALDAV_NOT_WRITABLE`

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/unit/calendar-projection.test.ts tests/unit/calendar-sync-key.test.ts tests/unit/calendar-oauth-registry.test.ts tests/integration/secret-exposure.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/calendar/projection.ts src/lib/calendar/sync-key.ts src/lib/calendar/errors.ts src/lib/calendar/oauth-registry.ts src/lib/calendar/local-oauth-origin.ts tests/unit/calendar-projection.test.ts tests/unit/calendar-sync-key.test.ts tests/unit/calendar-oauth-registry.test.ts tests/integration/secret-exposure.test.ts
git commit -m "feat: add calendar projection and oauth primitives"
```

---

### Task 3: Provider-neutral reconciliation engine

**Files:**
- Create: `src/lib/calendar/adapter.ts`
- Create: `src/lib/calendar/reconcile.ts`
- Create: `tests/integration/calendar-reconcile.test.ts`

**Interfaces:**
- Consumes Tasks 1–2 repositories, projection, hashes, keys, and error codes.
- Produces `CalendarDestinationAdapter` exactly as the spec contract: `testConnection`, `ensureCalendar`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`.
- Produces `CalendarAdapterFactory = (connection: CalendarConnection) => Promise<CalendarDestinationAdapter>`.
- Produces `reconcileCalendarConnection(db, connectionId, {adapterFactory, now?, concurrency?}): Promise<CalendarSyncResult>`.
- Produces `reconcileAllCalendars(db, {adapterFactory, now?, concurrency?}): Promise<CalendarSyncAllResult>`.
- `concurrency` defaults to 4 and never exceeds 4 in production calls.
- `CalendarSyncResult` exposes connection ID, status, created/updated/deleted/unchanged/failed counts, completed timestamp, and sanitized error code.

- [ ] **Step 1: Write failing reconciliation tests with a deterministic fake adapter**

Cover:

- first sync creates one link and one remote event;
- repeat sync checks existence but performs no create/update when hash is unchanged;
- due date/title/status change updates the same remote event;
- assignment becoming `dueAt = null` deletes the managed event and then deletes its link;
- remote event missing while the calendar still exists recreates with the same persisted sync key;
- a simulated lost create response leaves a link with sync key but no remote ID; retry with that same key converges on one provider event;
- deleted whole calendar raises `CALENDAR_REMOTE_CALENDAR_MISSING`, does not call `ensureCalendar`, and preserves links;
- one event failure plus one success returns `partial` and preserves both mappings/error state;
- all event/provider failure returns `error`;
- one connection error does not stop another connection in `reconcileAllCalendars`;
- assignments absent from the local table are not inferred/deleted by this subsystem;
- worker concurrency never exceeds four.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/integration/calendar-reconcile.test.ts
```

Expected: FAIL because adapter/reconciliation modules do not exist.

- [ ] **Step 3: Implement the reconciliation engine**

Important ordering:

1. mark connection attempt;
2. construct adapter and call `testConnection()` to verify the stored calendar still exists/writable;
3. load assignments and links;
4. create links/sync keys before remote creates;
5. reconcile each assignment;
6. persist per-event success/error without clearing prior good mappings on failure;
7. mark connection `success`, `partial`, or `error`.

Do not call `ensureCalendar()` during ordinary reconciliation; that method is reserved for explicit connect/reconnect flows.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- tests/integration/calendar-reconcile.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/adapter.ts src/lib/calendar/reconcile.ts tests/integration/calendar-reconcile.test.ts
git commit -m "feat: add calendar reconciliation engine"
```

---

### Task 4: Google Calendar OAuth and adapter

**Files:**
- Create: `src/lib/calendar/google/oauth.ts`
- Create: `src/lib/calendar/google/client.ts`
- Create: `src/lib/calendar/google/adapter.ts`
- Create: `tests/unit/google-calendar-oauth.test.ts`
- Create: `tests/unit/google-calendar-client.test.ts`

**Interfaces:**
- Consumes Tasks 1–3.
- Produces `getGoogleCalendarConfig(env?): {clientId:string; clientSecret:string|null}`; missing client ID throws `CALENDAR_CONFIG_MISSING`.
- Produces `buildGoogleAuthorizationUrl({clientId,state,codeChallenge,redirectUri}): URL`.
- Produces `exchangeGoogleAuthorizationCode(input, fetchImpl?)` and `refreshGoogleAccessToken(input, fetchImpl?)`.
- Produces `googleEventId(syncKey: string): string` using only lowercase base32hex characters and a valid Google event-ID length.
- Produces `GoogleCalendarClient` methods for create/get calendar and get/create/update/delete event against fixed `https://www.googleapis.com/calendar/v3`.
- Produces `GoogleCalendarAdapter` implementing Task 3's adapter contract.

- [ ] **Step 1: Write failing OAuth tests**

Assert the authorization URL:

- uses Google's fixed authorization endpoint;
- requests `https://www.googleapis.com/auth/calendar.app.created`;
- includes `access_type=offline`;
- includes PKCE `code_challenge_method=S256`;
- includes supplied state/redirect URI;
- does not include a PKCE verifier or stored refresh token.

Token tests assert:

- token exchange/refresh POST only to Google's fixed token endpoint;
- refresh token is accepted/rotated when returned;
- 401/invalid_grant maps to `CALENDAR_AUTH_EXPIRED`;
- 429 maps to `CALENDAR_RATE_LIMITED`;
- error text never echoes tokens/codes.

- [ ] **Step 2: Write failing Google client/adapter tests**

With mocked fetch, assert:

- `ensureCalendar()` creates a secondary calendar named `Kairos`;
- `testConnection()` checks the stored calendar ID and maps 404 to `CALENDAR_REMOTE_CALENDAR_MISSING`;
- create event supplies deterministic `id=googleEventId(syncKey)`;
- body contains exact UTC start/end, `transparency:"transparent"`, no attendees/location/conference data, and default reminder behavior;
- retrying create with the same sync key uses the same event ID;
- update/delete target only the stored calendar/event IDs;
- network/429/5xx errors map to stable calendar errors.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- tests/unit/google-calendar-oauth.test.ts tests/unit/google-calendar-client.test.ts
```

Expected: FAIL because Google modules do not exist.

- [ ] **Step 4: Implement the Google modules**

Use native fetch and Zod/defensive parsing for token/API payloads. Never accept a caller-supplied Google API origin.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/unit/google-calendar-oauth.test.ts tests/unit/google-calendar-client.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/calendar/google tests/unit/google-calendar-oauth.test.ts tests/unit/google-calendar-client.test.ts
git commit -m "feat: add google calendar adapter"
```

---

### Task 5: Microsoft Outlook / Microsoft 365 OAuth and Graph adapter

**Files:**
- Create: `src/lib/calendar/microsoft/oauth.ts`
- Create: `src/lib/calendar/microsoft/client.ts`
- Create: `src/lib/calendar/microsoft/adapter.ts`
- Create: `tests/unit/microsoft-calendar-oauth.test.ts`
- Create: `tests/unit/microsoft-calendar-client.test.ts`

**Interfaces:**
- Produces `getMicrosoftCalendarConfig(env?): {clientId:string; tenant:string}`, with tenant default `common`.
- Produces `buildMicrosoftAuthorizationUrl({clientId,tenant,state,codeChallenge,redirectUri}): URL`.
- Produces authorization-code and refresh-token exchange helpers.
- Produces `microsoftTransactionId(syncKey: string): string` as the stable value used for every retry of one event create.
- Produces `MicrosoftCalendarClient` against fixed `https://graph.microsoft.com/v1.0`.
- Produces `MicrosoftCalendarAdapter` implementing the shared adapter contract.

- [ ] **Step 1: Write failing Microsoft OAuth tests**

Assert:

- fixed Microsoft identity endpoint with the configured tenant;
- the requested scope set is exactly `offline_access Calendars.ReadWrite` and does not request mail/contact/file scopes;
- PKCE S256 and state are present;
- no client secret is required;
- token refresh rotation returns a replacement refresh token when supplied;
- invalid_grant/auth failures map to `CALENDAR_AUTH_EXPIRED`;
- 429/5xx/network errors map stably and redact secrets.

- [ ] **Step 2: Write failing Graph client/adapter tests**

Assert:

- `ensureCalendar()` POSTs one secondary calendar named `Kairos`;
- `testConnection()` checks the stored calendar ID and treats 404 as `CALENDAR_REMOTE_CALENDAR_MISSING`;
- create event writes `transactionId=microsoftTransactionId(syncKey)`;
- create/update bodies use UTC date-time values and `showAs:"free"`;
- no attendees, location, online meeting, invitation behavior, or reminder override is introduced;
- repeated uncertain create retries reuse the same transaction ID;
- update/delete use only stored calendar/event IDs;
- provider errors map to shared codes.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- tests/unit/microsoft-calendar-oauth.test.ts tests/unit/microsoft-calendar-client.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement Microsoft modules**

Do not add `User.Read` merely to obtain an account label; `accountLabel` may remain null/ generic when the granted scopes do not provide it safely.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/unit/microsoft-calendar-oauth.test.ts tests/unit/microsoft-calendar-client.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/calendar/microsoft tests/unit/microsoft-calendar-oauth.test.ts tests/unit/microsoft-calendar-client.test.ts
git commit -m "feat: add microsoft calendar adapter"
```

---

### Task 6: Apple iCloud CalDAV adapter

**Files:**
- Modify: `package.json`
- Create: `src/lib/calendar/caldav/xml.ts`
- Create: `src/lib/calendar/caldav/ical.ts`
- Create: `src/lib/calendar/caldav/client.ts`
- Create: `src/lib/calendar/caldav/adapter.ts`
- Create: `tests/unit/caldav-xml.test.ts`
- Create: `tests/unit/caldav-client.test.ts`
- Create: `tests/fixtures/caldav/principal.xml`
- Create: `tests/fixtures/caldav/calendar-home.xml`

**Interfaces:**
- Adds `fast-xml-parser: ^5.11.2` as the single new production dependency for DAV XML parsing.
- Produces `ICLOUD_CALDAV_ORIGIN = "https://caldav.icloud.com/"`.
- Produces `resolveAppleDavUrl(base: URL, href: string): URL`, accepting only HTTPS `caldav.icloud.com` and partition hosts matching `p<digits>-caldav.icloud.com`; rejects other hosts/ports/schemes.
- Produces namespace-tolerant DAV multistatus parsing helpers that reject `<!DOCTYPE` and `<!ENTITY` before parsing.
- Produces `serializeCalendarEvent(projection, syncKey): string` with deterministic `UID`, UTC `DTSTART`/`DTEND`, escaped SUMMARY/DESCRIPTION, and `TRANSP:TRANSPARENT`.
- Produces `caldavResourceName(syncKey): string` as a deterministic `.ics` resource name.
- Produces `CalDavClient` supporting principal/home discovery, list/create calendar, get/put/delete event.
- Produces `CalDavCalendarAdapter`.

- [ ] **Step 1: Write failing XML/URL security tests**

Assert:

- relative DAV hrefs resolve inside the current Apple host;
- absolute `https://p12-caldav.icloud.com/...` is allowed;
- `http://`, non-443 explicit ports, `https://evil.example`, `https://caldav.icloud.com.evil.example`, username/password URLs, and foreign redirect targets are rejected before an Authorization header is sent;
- XML parser accepts namespace prefixes changing between fixtures;
- payload containing DOCTYPE/ENTITY is rejected with `CALDAV_DISCOVERY_FAILED`.

- [ ] **Step 2: Write failing CalDAV client/adapter tests**

Mock fetch and cover:

- Basic auth uses the supplied Apple Account email + fixture app-specific password only toward validated Apple hosts;
- PROPFIND discovers current-user-principal → calendar-home-set → calendar collections;
- `ensureCalendar()` creates a dedicated `Kairos` collection with MKCALENDAR;
- unsupported/not-writable creation maps to `CALDAV_NOT_WRITABLE`;
- `testConnection()` sees a missing stored collection as `CALENDAR_REMOTE_CALENDAR_MISSING`;
- create PUT uses deterministic resource name/UID and `If-None-Match: *`, with no `VALARM` reminder block;
- update uses stored ETag with `If-Match` when available;
- delete treats 404 as already absent;
- identical create retries target the same resource URL;
- 429/5xx/network responses map to shared error codes;
- credentials never appear in thrown messages.

- [ ] **Step 3: Run RED**

Install the pinned dependency, then run:

```bash
npm install --no-audit --no-fund
npm test -- tests/unit/caldav-xml.test.ts tests/unit/caldav-client.test.ts
```

Expected: FAIL before the CalDAV modules exist.

- [ ] **Step 4: Implement CalDAV modules**

Use `redirect:"manual"` for authenticated DAV requests and explicitly validate each redirect/discovered href before retrying with credentials. Do not expose a custom CalDAV URL field in Milestone 5.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/unit/caldav-xml.test.ts tests/unit/caldav-client.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add package.json src/lib/calendar/caldav tests/unit/caldav-xml.test.ts tests/unit/caldav-client.test.ts tests/fixtures/caldav
git commit -m "feat: add icloud caldav adapter"
```

---

### Task 7: Provider factory, connection services, and calendar API routes

**Files:**
- Create: `src/lib/calendar/provider-factory.ts`
- Create: `src/lib/calendar/connection-service.ts`
- Create: `src/app/api/calendars/route.ts`
- Create: `src/app/api/calendars/sync-all/route.ts`
- Create: `src/app/api/calendars/[id]/sync/route.ts`
- Create: `src/app/api/calendars/[id]/disconnect/route.ts`
- Create: `src/app/api/calendars/[id]/remove-events/route.ts`
- Create: `src/app/api/calendars/google/start/route.ts`
- Create: `src/app/api/calendars/google/callback/route.ts`
- Create: `src/app/api/calendars/microsoft/start/route.ts`
- Create: `src/app/api/calendars/microsoft/callback/route.ts`
- Create: `src/app/api/calendars/caldav/test/route.ts`
- Create: `src/app/api/calendars/caldav/connect/route.ts`
- Create: `tests/integration/calendar-api.test.ts`
- Create: `tests/integration/calendar-oauth-api.test.ts`
- Modify: `tests/integration/secret-exposure.test.ts`

**Interfaces:**
- Consumes Tasks 1–6.
- Produces `createCalendarAdapterFactory(db, options?): CalendarAdapterFactory`; production provider origins stay fixed, tests may inject `fetchImpl`.
- Produces explicit connect/reconnect services that call `ensureCalendar()` only after user-authorized setup/reconnect.
- GET `/api/calendars` returns only safe `CalendarConnection[]`.
- POST `/api/calendars/sync-all` returns per-connection sanitized sync results and never credentials.
- POST `/api/calendars/:id/sync` reconciles one destination.
- POST `/api/calendars/:id/disconnect` removes only local connection/credential/link state.
- POST `/api/calendars/:id/remove-events` deletes managed remote events first, preserving the connection/calendar itself.
- Google/Microsoft start routes accept optional `connectionId` for explicit reconnect and return `{authorizationUrl}` with state + PKCE challenge only.
- Google/Microsoft callbacks consume state exactly once, exchange the code, create/reconnect the dedicated calendar, persist refresh token, and redirect to local `/sources`.
- CalDAV test/connect accept `{username, secret}`; successful connect clears no secret back into JSON.

- [ ] **Step 1: Write failing safe-metadata and sync API tests**

Cover:

- GET returns multiple destinations and never credential values;
- sync one/all delegates through injected provider fetch/adapters and records health;
- one provider failure returns its error state while another succeeds;
- disconnect removes local credential/link state but performs no remote delete;
- remove-events deletes only linked events and keeps the connection/remote calendar;
- unknown IDs return 404/409 with sanitized messages.

- [ ] **Step 2: Write failing OAuth/CalDAV route tests**

Cover:

- start fails `CALENDAR_CONFIG_MISSING` when client ID is absent;
- start refuses a non-loopback request origin;
- returned authorization URL contains state/challenge but no verifier;
- expired/replayed/mismatched state is rejected;
- forged callback with an unknown state never calls a provider token endpoint;
- OAuth code exchange response persists only the refresh token; the schema/repository has no durable access-token field and responses never return either token;
- reconnect for a missing calendar can create a replacement only because reconnect is an explicit user action;
- CalDAV connect stores fixture username/secret but response contains only safe connection metadata;
- invalid CalDAV credential replacement does not destroy a previously working credential.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- tests/integration/calendar-api.test.ts tests/integration/calendar-oauth-api.test.ts tests/integration/secret-exposure.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement factory/services/routes**

OAuth callback routes must redact provider error details. Refresh-token rotation from Google/Microsoft is persisted atomically whenever the provider returns a replacement.

Do not make calendar route failure alter any source connection row.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/integration/calendar-api.test.ts tests/integration/calendar-oauth-api.test.ts tests/integration/secret-exposure.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/lib/calendar/provider-factory.ts src/lib/calendar/connection-service.ts src/app/api/calendars tests/integration/calendar-api.test.ts tests/integration/calendar-oauth-api.test.ts tests/integration/secret-exposure.test.ts
git commit -m "feat: add calendar connection api"
```

---

### Task 8: Calendar destination provider and Sources UI

**Files:**
- Create: `src/features/calendars/calendar-provider.tsx`
- Create: `src/features/sources/calendar-destinations.tsx`
- Create: `src/features/sources/google-calendar-card.tsx`
- Create: `src/features/sources/microsoft-calendar-card.tsx`
- Create: `src/features/sources/icloud-calendar-card.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/(dashboard)/sources/page.tsx`
- Create: `tests/component/calendar-destinations.test.tsx`
- Create: `tests/component/calendar-provider.test.tsx`

**Interfaces:**
- Produces `CalendarProvider` React context with `connections`, per-connection phase/message, `startGoogle(connectionId?)`, `startMicrosoft(connectionId?)`, `testIcloud(username,secret)`, `connectIcloud(username,secret)`, `syncConnection(id)`, `syncAll()`, `removeEvents(id)`, and `disconnect(id)`.
- `syncAll()` returns/retains sanitized provider warnings for Task 9.
- Dashboard layout loads initial `CalendarConnectionRepository.list()` and wraps the existing providers with `CalendarProvider`.
- Sources page renders assignment-source cards first, then a visually distinct **Calendar destinations** section.

- [ ] **Step 1: Write failing UI tests**

Assert visible copy:

- `Sources bring assignments into Kairos. Calendar destinations publish Kairos deadlines to calendars you already use.`
- cards named **Google Calendar**, **Outlook / Microsoft 365**, and **Apple iCloud Calendar**;
- Google explains access is to the calendar Kairos creates;
- Microsoft explicitly names broader `Calendars.ReadWrite`;
- Apple uses password-style input for an app-specific password and says it stays on this computer;
- connected card shows remote calendar name/health/last successful sync and Sync/Reconnect/Disconnect actions;
- stored secret/refresh-token fixture values never render.

Interaction assertions:

- Google/Microsoft connect starts OAuth and assigns `window.location` only to the server-returned provider URL;
- successful iCloud connect clears username/password state as appropriate, especially the secret;
- disconnect confirmation does not imply remote calendar deletion;
- remove generated events is a separate explicit action.

- [ ] **Step 2: Write failing provider-state tests**

Assert route calls update phases/messages and a failed provider operation does not erase other connections.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- tests/component/calendar-destinations.test.tsx tests/component/calendar-provider.test.tsx
```

Expected: FAIL.

- [ ] **Step 4: Implement provider/UI**

Keep provider cards keyboard accessible and consistent with current rounded source-card UI. Do not add a new primary sidebar destination; calendar connections belong on Sources.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- tests/component/calendar-destinations.test.tsx tests/component/calendar-provider.test.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/features/calendars src/features/sources/calendar-destinations.tsx src/features/sources/google-calendar-card.tsx src/features/sources/microsoft-calendar-card.tsx src/features/sources/icloud-calendar-card.tsx 'src/app/(dashboard)/layout.tsx' 'src/app/(dashboard)/sources/page.tsx' tests/component/calendar-destinations.test.tsx tests/component/calendar-provider.test.tsx
git commit -m "feat: add calendar destination ui"
```

---

### Task 9: Live source hooks, stale-on-visible reconciliation, and unified Sync All

**Files:**
- Create: `src/lib/calendar/post-source-sync.ts`
- Modify: `src/app/api/sources/canvas/sync/route.ts`
- Modify: `src/app/api/sources/canvas/submission-status/complete/route.ts`
- Modify: `src/app/api/sources/gradescope/sync/complete/route.ts`
- Modify: `src/app/api/sources/ed/sync/route.ts`
- Modify: `src/features/submission-status/submission-status-provider.tsx`
- Modify: `src/features/gradescope/gradescope-provider.tsx`
- Modify: `src/features/ed/ed-provider.tsx`
- Modify: `src/features/sync/connected-source-sync-controls.tsx`
- Modify: `src/features/calendars/calendar-provider.tsx`
- Create: `tests/integration/calendar-source-hooks.test.ts`
- Modify: `tests/component/connected-source-sync-controls.test.tsx`
- Modify: `tests/component/calendar-provider.test.tsx`

**Interfaces:**
- Produces `reconcileCalendarsAfterSourceWrite(db, {defer, changed}): Promise<void>`, which is best-effort, stores calendar health through the normal reconciliation engine, and never throws back into a successful source operation.
- A request header `x-kairos-calendar-sync: defer` means “this source call is part of unified Sync All; do not run a per-source calendar pass.”
- Extends source-provider methods to `syncNow(options?: {deferCalendarSync?: boolean}): Promise<void>`.
- Calendar provider uses a 15-minute stale threshold on dashboard mount/visibility activation and prevents concurrent duplicate calendar syncs.
- ConnectedSourceSyncControls calls one final `calendars.syncAll()` after eligible source attempts.

- [ ] **Step 1: Write failing source-hook integration tests**

Use module/fetch injection to prove:

- successful Canvas deadline write invokes calendar reconciliation unless deferred;
- successful/partial Gradescope completion with local writes invokes it unless deferred;
- successful/partial Ed sync with local writes invokes it unless deferred;
- Canvas submission-status completion invokes it when at least one status write changes projection-relevant state;
- a calendar exception is swallowed after destination health is recorded and the original source response remains successful;
- `x-kairos-calendar-sync: defer` suppresses only the immediate push, not the source write.

- [ ] **Step 2: Extend Sync All component tests**

Assert exact high-level order:

1. Canvas deadline sync with defer header;
2. Canvas submission `syncNow({deferCalendarSync:true})`;
3. Gradescope `syncNow({deferCalendarSync:true})`;
4. Ed `syncNow({deferCalendarSync:true})`;
5. calendars `syncAll()`;
6. router refresh.

Also assert:

- a source warning does not skip the final calendar pass;
- calendar warnings are rendered separately;
- calendar sync is invoked exactly once by this workflow.

- [ ] **Step 3: Add stale-on-visible calendar tests**

With fake timers/visibility events:

- no destination means no request;
- fresh destination (<15 minutes) does not auto-sync;
- stale/never destination syncs once on mount;
- returning to visible after it becomes stale triggers one reconciliation;
- overlapping visibility events do not start concurrent syncs.

- [ ] **Step 4: Run RED, implement, then GREEN**

Run before implementation:

```bash
npm test -- tests/integration/calendar-source-hooks.test.ts tests/component/connected-source-sync-controls.test.tsx tests/component/calendar-provider.test.tsx
```

Expected: FAIL on new calendar behavior.

Implement the route hooks, defer option, Sync All final pass, and visibility stale check.

Run again:

```bash
npm test -- tests/integration/calendar-source-hooks.test.ts tests/component/connected-source-sync-controls.test.tsx tests/component/calendar-provider.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/post-source-sync.ts src/app/api/sources/canvas/sync/route.ts src/app/api/sources/canvas/submission-status/complete/route.ts src/app/api/sources/gradescope/sync/complete/route.ts src/app/api/sources/ed/sync/route.ts src/features/submission-status/submission-status-provider.tsx src/features/gradescope/gradescope-provider.tsx src/features/ed/ed-provider.tsx src/features/sync/connected-source-sync-controls.tsx src/features/calendars/calendar-provider.tsx tests/integration/calendar-source-hooks.test.ts tests/component/connected-source-sync-controls.test.tsx tests/component/calendar-provider.test.tsx
git commit -m "feat: sync calendar destinations with sources"
```

---

### Task 10: Deterministic E2E calendar fixture and browser workflow

**Files:**
- Create: `src/lib/calendar/e2e-fixture-fetch.ts`
- Create: `src/app/api/test-fixtures/calendar-state/route.ts`
- Create: `src/app/api/test-fixtures/calendar-mode/route.ts`
- Create: `src/app/api/test-fixtures/assignment-due-date/route.ts`
- Modify: `src/app/api/test-fixtures/reset/route.ts`
- Modify: `src/lib/calendar/provider-factory.ts`
- Create: `tests/e2e/calendar-sync.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- When `E2E_FIXTURES=1`, only server-side provider factory calls use deterministic fixture fetch state; production builds still use fixed real provider origins.
- Fixture CalDAV credentials are constant fake values accepted only in E2E mode.
- Calendar-state endpoint returns non-secret fixture event metadata for assertions.
- Calendar-mode endpoint can simulate provider network failure and remote event deletion.
- Assignment-due-date endpoint can mutate a fixture assignment's due date only in E2E mode.

- [ ] **Step 1: Write failing Playwright flow**

The Chromium E2E test must:

1. reset fixtures;
2. connect the existing Canvas deadline fixture and import its assignment;
3. connect Apple iCloud using fixture email/app password;
4. assert the app-specific password is cleared and absent from rendered HTML/API responses after connect;
5. sync calendar and assert exactly one remote fixture event;
6. sync again and assert still exactly one event;
7. mutate the local fixture assignment due date, sync, and assert the same remote event ID now has the new timestamp;
8. simulate remote event deletion, sync, and assert it is recreated without a duplicate;
9. switch provider fixture to failure mode, run **Sync All**, and assert a calendar warning appears while the assignment remains in Kairos;
10. assert captured calendar API responses never contain the fixture app password, Authorization header value, OAuth-like token string, or raw DAV authenticated response body.

- [ ] **Step 2: Run E2E and observe RED**

Run:

```bash
npm run test:e2e -- --project=chromium tests/e2e/calendar-sync.spec.ts
```

Expected: FAIL because fixture calendar routes/fetch do not exist.

- [ ] **Step 3: Implement fixture transport/state**

Keep all fixture-only routes gated behind `E2E_FIXTURES==="1"`; otherwise return 404.

Extend reset to delete `calendar_connections` as well as source data and clear in-memory fixture calendar state.

- [ ] **Step 4: Run GREEN plus existing E2E regression**

Run:

```bash
npm run test:e2e
```

Expected: all Canvas, Gradescope, Ed, submission-status, and new calendar E2E tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/e2e-fixture-fetch.ts src/app/api/test-fixtures/calendar-state/route.ts src/app/api/test-fixtures/calendar-mode/route.ts src/app/api/test-fixtures/assignment-due-date/route.ts src/app/api/test-fixtures/reset/route.ts src/lib/calendar/provider-factory.ts tests/e2e/calendar-sync.spec.ts playwright.config.ts
git commit -m "test: add calendar sync e2e coverage"
```

---

### Task 11: Documentation, security review, full verification, and validation gate

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/ROADMAP.md`
- Modify: `tests/integration/secret-exposure.test.ts` only if final security review identifies a missing credential pattern

**Interfaces:**
- README documents local setup for Google client ID/config, Microsoft client ID, and iCloud app-specific passwords without real values.
- README states that SQLite calendar credentials are not encrypted at rest and that Kairos must be running to publish new upstream changes.
- README documents disconnect vs **Remove generated events**.
- Roadmap status is **Milestone 5 — Calendar destination sync — Implemented, real-account validation pending** until Google, Microsoft, and iCloud smoke checks are completed.
- The draft PR remains the CI trigger throughout implementation; do not add a milestone-specific push trigger.

- [ ] **Step 1: Update README/setup/privacy/acceptance documentation**

Document these local configuration keys in `.env.example` without real values:

- `GOOGLE_CALENDAR_CLIENT_ID=`
- optional `GOOGLE_CALENDAR_CLIENT_SECRET=`
- `MICROSOFT_CALENDAR_CLIENT_ID=`
- `MICROSOFT_CALENDAR_TENANT=common`

Document:

- Google `calendar.app.created` permission rationale;
- Microsoft `Calendars.ReadWrite` breadth;
- iCloud app-specific password flow;
- no arbitrary CalDAV server URL;
- local-only refresh-token/app-password storage and lack of encryption at rest;
- 15-minute stale-on-visible behavior while open;
- no 24/7 background synchronization while closed;
- explicit provider smoke checklist for create/repeat/update/delete/recreate/reconnect.

- [ ] **Step 2: Update roadmap without prematurely marking provider support complete**

Add Milestone 5 implementation summary and keep real-account validation visibly pending.

Do not claim Google, Microsoft, or iCloud “complete” until the corresponding real-account smoke has happened.

- [ ] **Step 3: Run focused security scans**

Run:

```bash
npm test -- tests/integration/secret-exposure.test.ts
git grep -nE '(fixture-.*(refresh|password|token)|oauth_refresh_token|caldav_secret|authorization.*Bearer)' -- src tests ':!tests/fixtures/**'
```

Expected:

- the test passes;
- grep findings are only schema/field names or intentional fake-value assertions, not committed real credentials or rendered-secret behavior.

Manually inspect every new fetch origin and confirm production requests are limited to Google Calendar/Google OAuth, Microsoft identity/Graph, and validated Apple CalDAV hosts.

- [ ] **Step 4: Run the full verification suite on the exact final head**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build:extension
npm run test:e2e
npm run build
node scripts/verify-dynamic-dashboard-build.mjs
```

Expected: all commands exit 0.

Push the exact head and require the GitHub feature workflow to complete successfully on the same SHA.

- [ ] **Step 5: Commit docs and verify the final implementation head**

Commit:

```bash
git add README.md .env.example docs/superpowers/ROADMAP.md tests/integration/secret-exposure.test.ts
git commit -m "docs: document calendar sync milestone"
```

If `tests/integration/secret-exposure.test.ts` did not change, omit it from `git add`.

Rerun the full verification suite and require the draft PR's GitHub feature CI to pass on this exact final head.

---

## Real-account acceptance gate before merge

Automated implementation is not the end of Milestone 5. Before the roadmap may be changed to **Complete** and before merge, perform local real-account smoke checks without pasting credentials into chat, shell history, fixtures, or commits.

### Google Calendar

- authorize with the configured desktop OAuth application;
- confirm Kairos creates a dedicated **Kairos** calendar;
- create an assignment event;
- repeat sync without duplication;
- change a due date and confirm the same event moves;
- delete one generated event and confirm reconciliation recreates it;
- confirm ordinary reconciliation reports a deleted whole Kairos calendar instead of silently recreating it;
- reconnect explicitly and confirm the user-authorized reconnect can restore a destination.

### Outlook / Microsoft 365

Repeat the same create/idempotency/update/delete/recreate/reconnect checks and confirm the provider consent screen corresponds to delegated `Calendars.ReadWrite` + offline access, with no unrelated mail/files/contacts permission.

### Apple iCloud

- use an Apple Account email and app-specific password;
- confirm principal/calendar-home discovery succeeds;
- confirm a dedicated writable **Kairos** calendar is created;
- repeat create/idempotency/update/delete/recreate behavior;
- confirm the app-specific password is never rendered back or present in Kairos API responses.

If any provider cannot pass the real-account smoke, leave its roadmap support pending and fix it through a new RED→GREEN regression test before merge.

## Final branch review

After every task is complete and real-account acceptance is either complete or explicitly left as a merge blocker, run the Superpowers whole-branch review against:

- Spec: `docs/superpowers/specs/2026-10-05-calendar-sync-design.md`
- Plan: `docs/superpowers/plans/2026-10-05-calendar-sync-milestone-5.md`
- Merge base: `main`
- Review focus: the five cases at the top of this plan

Critical/Important findings require one TDD fix pass and a fresh full-suite run. Minor findings are ledgered and reported rather than silently expanding scope.
