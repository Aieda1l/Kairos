# Kairos Milestone 5 — Calendar Destination Sync Design

**Date:** 2026-10-05  
**Status:** Approved design, implementation not yet started  
**Branch:** `feat/milestone-5-calendar-sync`

## 1. Goal

Add first-class outbound calendar integration so assignments already normalized by Kairos can appear in a user's external calendar with near-live synchronization while preserving the project's local-first privacy model.

Milestone 5 supports the main calendar ecosystems through provider-specific adapters:

- Google Calendar through the Google Calendar API and OAuth 2.0;
- Outlook / Microsoft 365 Calendar through Microsoft Graph and OAuth 2.0;
- Apple iCloud Calendar through CalDAV;
- the CalDAV implementation should remain provider-neutral enough that additional CalDAV services can be added later without changing the core synchronization model.

Kairos remains the authority for assignment data. External calendars are destinations, not new assignment sources.

## 2. Product intent and success criteria

The user should be able to connect one or more calendar destinations and have Kairos maintain a dedicated **Kairos** calendar in each destination.

Success means:

1. Canvas, Gradescope, and Ed remain independent assignment sources.
2. Google, Microsoft, and iCloud are represented separately as calendar destinations.
3. A successful assignment refresh is followed by best-effort calendar reconciliation.
4. The existing **Sync All** action pulls connected assignment sources first, then pushes the resulting local state to every enabled calendar destination.
5. Repeated synchronization is idempotent and does not create duplicate events.
6. Due-date changes move/update the existing external event.
7. A user-deleted Kairos-managed event is recreated on the next reconciliation.
8. An assignment that becomes explicitly undated has its previously generated calendar event removed.
9. A provider failure does not roll back successful source synchronization or another calendar provider's synchronization.
10. No calendar credential, OAuth refresh token, authorization code, PKCE verifier, or app password is returned to normal client state, rendered after capture, committed, or included in diagnostic text.
11. The UI accurately explains that local SQLite credentials are not encrypted at rest.
12. No hosted Kairos backend, user account, or cloud database is introduced.

## 3. Architectural boundary: destinations are not sources

The existing source model answers:

> Where did this assignment come from?

That model should continue to use the existing source kinds:

`"canvas" | "gradescope" | "ed"`

Calendar integrations answer a different question:

> Where should Kairos publish this assignment?

Adding `google`, `microsoft`, or `icloud` to `SourceKind` would blur provenance, pollute source filtering, and risk treating copies of an assignment as new assignments.

Milestone 5 therefore introduces a separate calendar-destination subsystem.

A representative interface is:

```ts
export type CalendarProvider = "google" | "microsoft" | "caldav";

export type CalendarEventProjection = {
  assignmentId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  sourceUrl: string | null;
};

export type RemoteCalendarEvent = {
  remoteEventId: string;
  etag: string | null;
};

export interface CalendarDestinationAdapter {
  readonly provider: CalendarProvider;

  testConnection(): Promise<void>;
  ensureCalendar(): Promise<{ remoteCalendarId: string; name: string }>;

  getEvent(remoteCalendarId: string, remoteEventId: string): Promise<RemoteCalendarEvent | null>;
  createEvent(
    remoteCalendarId: string,
    projection: CalendarEventProjection,
    syncKey: string,
  ): Promise<RemoteCalendarEvent>;
  updateEvent(
    remoteCalendarId: string,
    remoteEventId: string,
    projection: CalendarEventProjection,
  ): Promise<RemoteCalendarEvent>;
  deleteEvent(remoteCalendarId: string, remoteEventId: string): Promise<void>;
}
```

Provider authentication and token-refresh details stay outside the normalized event projection.

## 4. Provider strategy

### 4.1 Google Calendar

Google uses an installed/desktop OAuth flow with PKCE and a loopback redirect handled by the local Kairos server.

Kairos requests the narrowest practical calendar permission:

`https://www.googleapis.com/auth/calendar.app.created`

That scope allows the app to create a secondary Google calendar and manage events on calendars it created. Kairos does not request broad access to every calendar when the narrower app-created-calendar scope is sufficient.

The OAuth request may additionally use OpenID/email identity scopes only to display a non-secret account label.

The Google adapter creates one secondary calendar named **Kairos** and stores its remote calendar ID.

For event creation, Kairos supplies a deterministic Google-compatible event ID derived from the calendar connection ID and assignment ID. Google explicitly supports client-supplied event IDs to keep a local database synchronized and avoid duplicate creation after uncertain network outcomes.

The generated ID must satisfy Google's base32hex-compatible event-ID rules.

### 4.2 Microsoft Outlook / Microsoft 365

Microsoft uses the authorization-code flow with PKCE as a public/native client. The application registration supports personal Microsoft accounts and work/school accounts.

The delegated permission is:

`Calendars.ReadWrite`

Kairos also requests `offline_access` so it can refresh access without asking the user to sign in on every synchronization.

Microsoft's calendar write permission is broader than Google's app-created-calendar scope. The UI must call this out plainly before connection.

The Microsoft adapter creates a secondary **Kairos** calendar and stores its remote calendar ID.

For event creation, Kairos generates and persists a stable UUID-like `transactionId` before issuing the POST. Microsoft documents `transactionId` as the client identifier used to avoid redundant event creation when a create request needs to be retried.

### 4.3 Apple iCloud / CalDAV

Apple does not expose an equivalent public Google- or Graph-style Calendar REST API for this use case. Kairos therefore uses CalDAV for iCloud Calendar.

The iCloud card requests only:

- Apple Account email / CalDAV username;
- an Apple-supported app authorization or app-specific password, depending on the account/app flow available to the user.

The credential is stored only in local SQLite and is never rendered back after save.

The iCloud preset uses a fixed Apple CalDAV origin rather than accepting an arbitrary server URL. This avoids introducing an SSRF-capable arbitrary authenticated HTTP client in the normal iCloud flow.

The CalDAV adapter performs standard principal/calendar-home discovery, discovers writable collections, and prefers a dedicated **Kairos** calendar. If the server supports calendar creation, Kairos creates it. If creation is unavailable but a writable calendar is discoverable, the UI may let the user choose that writable calendar instead of silently writing elsewhere.

Each CalDAV event uses a deterministic iCalendar `UID` and a deterministic resource name so PUT retries are idempotent.

A free-form custom CalDAV server URL is **not** required for Milestone 5. The adapter boundary should make a future advanced custom-CalDAV connector possible after a separate SSRF/security design.

## 5. Dedicated calendar ownership

Each destination uses a dedicated calendar named **Kairos** rather than writing into the user's primary calendar.

Reasons:

- isolates Kairos-managed events;
- makes disconnect/removal understandable;
- reduces accidental edits to unrelated user events;
- enables the narrow Google app-created-calendar scope;
- makes one-way ownership semantics clear;
- simplifies reconciliation and cleanup.

Kairos owns the generated events inside that calendar.

If the user manually edits a Kairos-managed event, the next reconciliation may overwrite managed fields. If the user deletes one generated event, the next reconciliation recreates it.

If the user deletes the entire remote **Kairos** calendar, Kairos does **not** silently recreate it. The connection moves to an error/reconnect state so an intentional calendar deletion is respected.

## 6. Event projection

Only assignments with a non-null `dueAt` are eligible for external calendar events.

Each external event is a timed 15-minute marker:

- start: exact assignment `dueAt`;
- end: `dueAt + 15 minutes`;
- UTC is used at the provider API boundary where possible so provider clients can display the event in the user's configured calendar timezone;
- the event is transparent/free where the provider supports that concept, so a homework deadline does not make the user appear busy;
- Kairos does not create attendees, meetings, conferencing, or locations;
- provider/default calendar reminder behavior is left intact rather than imposing a Kairos-specific reminder policy.

Title:

`[Course name] Assignment title`

Description contains only non-secret normalized assignment context, for example:

```text
Course: CSE 331
Source: Canvas
Status: Not submitted
Due: 2026-10-09T06:59:00.000Z

Open in source:
https://canvas.uw.edu/courses/123/assignments/987
```

The description may include current source/submission status when available, but never credential-bearing URLs, feed URLs, tokens, request headers, cookies, raw provider payloads, or parser diagnostics.

The content hash is derived from the exact normalized projection Kairos owns. A hash change means the external event needs an update.

## 7. Persistence model

Calendar destinations use new tables rather than `source_connections`.

### 7.1 `calendar_connections`

Representative schema:

```sql
CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','caldav')),
  label TEXT NOT NULL,
  account_label TEXT,
  remote_calendar_id TEXT,
  remote_calendar_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'never'
    CHECK(last_sync_status IN ('never','success','partial','error')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Multiple connections of the same provider are allowed. This differs intentionally from source connections, which currently have one row per source kind.

### 7.2 `calendar_credentials`

Representative schema:

```sql
CREATE TABLE calendar_credentials (
  calendar_connection_id TEXT PRIMARY KEY
    REFERENCES calendar_connections(id) ON DELETE CASCADE,
  oauth_refresh_token TEXT,
  caldav_username TEXT,
  caldav_secret TEXT,
  updated_at TEXT NOT NULL
);
```

Access tokens are short-lived and should normally remain in memory rather than be stored durably.

If a provider rotates a refresh token, Kairos stores the replacement atomically.

Provider client IDs and any locally required Google desktop-client configuration come from local environment/configuration, not this table and not committed source.

### 7.3 `calendar_event_links`

Representative schema:

```sql
CREATE TABLE calendar_event_links (
  id TEXT PRIMARY KEY,
  calendar_connection_id TEXT NOT NULL
    REFERENCES calendar_connections(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL
    REFERENCES assignments(id) ON DELETE CASCADE,
  sync_key TEXT NOT NULL,
  remote_event_id TEXT,
  remote_etag TEXT,
  content_hash TEXT,
  last_synced_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(calendar_connection_id, assignment_id),
  UNIQUE(calendar_connection_id, sync_key)
);
```

The link row is created before a remote create attempt so its provider-specific `sync_key` survives uncertain request outcomes.

The current Kairos data model does not authoritatively delete assignments when an upstream item disappears. Milestone 5 therefore does not infer remote-event deletion from absence alone.

## 8. Reconciliation algorithm

For each enabled calendar connection:

1. Mark the destination synchronization attempt.
2. Refresh/obtain provider access if needed.
3. Verify that the stored remote **Kairos** calendar still exists and is writable.
4. Load local assignments and existing event links.
5. For each assignment:
   - if `dueAt` is non-null, build the deterministic event projection and content hash;
   - if no link exists, create the link/sync key first, then create the remote event idempotently;
   - if the link exists, verify the remote event exists;
   - if it does not exist, recreate it using the same sync key;
   - if it exists and the content hash changed, update it;
   - if it exists and the content hash is unchanged, leave content untouched after the existence check.
6. For an assignment that still exists locally but now has `dueAt = null` and has a remote event link:
   - delete the managed remote event;
   - remove the link only after deletion succeeds or the provider confirms the event is already absent.
7. Persist event-level successes/errors without erasing prior successful mappings on failure.
8. Mark destination status:
   - `success` when every required operation succeeds;
   - `partial` when at least one event succeeds and at least one fails;
   - `error` when provider/auth/calendar failure prevents useful reconciliation.

Provider operations should use conservative concurrency, initially at most four concurrent event operations per destination.

One provider's failure never aborts another destination.

## 9. Live synchronization semantics

Kairos is local-first and has no always-on hosted worker. Therefore "live sync" has a precise Milestone 5 meaning:

### Immediate after assignment changes

Any successful workflow that changes normalized assignment/deadline state triggers a best-effort calendar reconciliation after the local source transaction completes.

This applies to:

- Canvas deadline sync;
- Gradescope sync completion;
- Ed sync;
- future source syncs that write normalized assignments.

Submission-status-only changes may also trigger reconciliation when the external event projection includes status text.

The source operation remains authoritative. A calendar push failure does not turn a successful Canvas/Gradescope/Ed pull into a failed source sync.

### Sync All

The existing Upcoming **Sync All** sequence becomes:

1. Canvas deadline sync, if connected;
2. Canvas submission status sync, if eligible;
3. Gradescope sync, if eligible;
4. Ed sync, if eligible;
5. one calendar-destination reconciliation pass using the resulting local database state;
6. refresh UI.

Source-specific failures remain isolated. Calendar synchronization still runs for the local data that remains valid.

### While the app is open

Kairos may run a lightweight stale check when the application becomes active/visible. If an enabled calendar destination has not reconciled recently, the client can request a background reconciliation.

Milestone 5 should not introduce a high-frequency polling loop.

### While Kairos is closed

There is no continuous cloud-to-cloud synchronization because Kairos intentionally has no hosted backend.

Events already written remain in the user's calendars. New upstream changes are published the next time Kairos runs a source refresh/reconciliation.

The UI and README must say this plainly rather than implying server-side 24/7 sync.

## 10. OAuth and authentication flows

### 10.1 Shared OAuth state registry

Google and Microsoft use a short-lived process-local OAuth request registry, similar in spirit to existing short-lived sync request registries.

Each entry stores:

- random `state`;
- provider;
- PKCE verifier;
- redirect/return target;
- creation/expiry time.

Rules:

- one-time consumption;
- approximately 10-minute expiry;
- state mismatch fails closed;
- PKCE verifier is never persisted after callback completion;
- authorization codes are never logged;
- callback errors are redacted.

### 10.2 Google callback

The local server initiates the installed-app authorization request and receives the loopback callback on the Kairos local origin.

The token exchange obtains a refresh token for offline access. Only the refresh token is persisted.

A missing required local Google client configuration produces a clear setup diagnostic without exposing environment values.

### 10.3 Microsoft callback

Microsoft uses authorization code + PKCE with a public-client registration and localhost redirect.

The local configuration contains the Microsoft application/client ID, not a client secret.

Refresh tokens are persisted locally and rotated when Microsoft returns a replacement.

### 10.4 CalDAV authentication

The iCloud CalDAV secret is accepted only through the local server route and stored server-side.

It is never returned after save.

Authorization headers and DAV response bodies that may contain account information are not logged into user-visible diagnostics.

## 11. Security and privacy boundaries

Milestone 5 keeps the existing Kairos privacy posture:

- no hosted Kairos service;
- no Kairos user account;
- no cloud database controlled by Kairos;
- no password collection for Google or Microsoft;
- OAuth browser sign-in happens directly with the provider;
- OAuth refresh tokens stay in local server-side SQLite;
- iCloud app authorization/app-specific credentials stay in local server-side SQLite;
- credentials are **not encrypted at rest** by Kairos in this milestone;
- credentials never appear in rendered connection payloads;
- provider access tokens, refresh tokens, app passwords, authorization codes, cookie values, request headers, or raw authenticated response bodies must not appear in logs, errors, fixtures, tests, screenshots, or committed files;
- provider API origins are fixed for Google and Microsoft;
- the iCloud preset uses a fixed Apple CalDAV origin;
- no user-controlled arbitrary authenticated fetch URL is introduced in this milestone.

Disconnect removes the local credential and disables/removes the local destination connection.

The UI should give the user a separate explicit choice to remove the remote **Kairos** calendar. Disconnecting should not silently delete remote events/calendar data.

## 12. Failure behavior

Stable provider-facing error classes should include at least:

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

Errors exposed to the UI are compact and sanitized.

Rate limiting uses bounded retry/backoff only where the provider explicitly indicates retryability. Kairos does not spin indefinitely.

A failed update never deletes a previously known-good event mapping.

An authentication failure disables automatic writes until reauthorization but preserves local assignment data and event mappings.

## 13. UI

Calendar connections live on the existing **Sources** page under a new **Calendar destinations** section, visually separated from assignment sources.

The page copy should make the direction explicit:

> Sources bring assignments into Kairos. Calendar destinations publish Kairos deadlines to calendars you already use.

Initial cards:

- Google Calendar
- Outlook / Microsoft 365
- Apple iCloud Calendar

Each connected card shows:

- account label when safely available;
- remote calendar name;
- last successful sync;
- current health;
- **Sync calendar**;
- **Reconnect** when auth is invalid;
- **Disconnect**.

The Google card explains that Kairos requests access to the calendar it creates.

The Microsoft card warns that Microsoft exposes calendar write access through the broader `Calendars.ReadWrite` delegated permission.

The Apple card explains the app-specific authorization/password requirement and that the secret stays on this computer.

The cards never render stored refresh tokens or CalDAV secrets.

The existing **Sync All** remains the primary cross-system action on Upcoming.

## 14. API surface

Exact filenames may change in the implementation plan, but the external shape should remain small.

Representative routes:

```text
POST /api/calendars/google/start
GET  /api/calendars/google/callback

POST /api/calendars/microsoft/start
GET  /api/calendars/microsoft/callback

POST /api/calendars/caldav/test
POST /api/calendars/caldav/connect

GET  /api/calendars
POST /api/calendars/:id/sync
POST /api/calendars/sync-all
POST /api/calendars/:id/disconnect
POST /api/calendars/:id/remove-remote-calendar
```

OAuth `start` endpoints return/perform a provider authorization redirect and do not expose PKCE verifier material.

Normal calendar connection JSON contains only safe metadata and sync state.

## 15. Testing strategy

Implementation follows TDD.

### Unit tests

Cover:

- deterministic projection and content hashing;
- 15-minute deadline event interval;
- no event for `dueAt = null`;
- secret-safe description generation;
- provider sync-key generation;
- Google event-ID formatting;
- Microsoft transaction-ID stability;
- CalDAV UID/resource-name stability;
- OAuth state/PKCE registry expiry and one-time consumption;
- stable error mapping and redaction.

### Repository/integration tests

Cover:

- calendar connection CRUD;
- credential round trip while connection JSON does not expose secrets;
- multiple connections of the same provider;
- event-link uniqueness;
- refresh-token rotation;
- successful create/update/delete;
- idempotent repeat synchronization;
- unknown create outcome followed by safe retry;
- user-deleted event recreated;
- due date change updates the same event;
- due date becoming null removes the generated event;
- one event failing yields partial destination sync without discarding successful links;
- one destination failing does not block another;
- source success remains source success when outbound calendar reconciliation fails.

### Component tests

Cover:

- source/destination wording;
- provider permission/privacy explanations;
- account/calendar health presentation;
- secret fields cleared after connect;
- reconnect/disconnect behavior;
- calendar warning presentation after Sync All.

### E2E

Use fixture OAuth/provider servers reachable only in the E2E environment.

The browser flow should prove:

1. connect a fixture calendar destination;
2. sync source assignments;
3. event is created once;
4. repeat sync does not duplicate;
5. fixture due date changes and existing event moves;
6. remote event deletion followed by sync recreates it;
7. destination failure surfaces a warning while assignments remain;
8. rendered HTML/API bodies never expose fixture refresh tokens/app passwords;
9. existing Canvas/Gradescope/Ed workflows remain functional.

Real credentials must never be used in automated tests.

## 16. Real-account acceptance

Before marking each provider supported, perform a real-account smoke with the user's own local environment.

### Google

Verify:

- OAuth authorization;
- dedicated **Kairos** calendar creation;
- initial event creation;
- idempotent repeat sync;
- due-date update;
- manually deleted event recreated;
- reconnect/refresh behavior.

### Microsoft

Verify the same behavior against Outlook/Microsoft 365 and confirm the consent screen matches the documented delegated permission.

### Apple iCloud

Verify:

- supported Apple authorization/app-specific credential flow;
- DAV discovery;
- writable Kairos calendar;
- create/update/delete/recreate behavior;
- no credential echo.

A provider is not called complete in the roadmap merely because fixture tests pass.

## 17. Configuration and documentation

README/provider setup docs must explain:

- which local OAuth app registrations/config values are needed;
- that Google/Microsoft sign-in happens at the provider;
- the exact permission rationale;
- how iCloud authorization/app-specific credentials work;
- that local SQLite credential storage is not encrypted at rest;
- that Kairos must be running to publish new upstream changes;
- how to disconnect without deleting remote data;
- how to explicitly remove the remote Kairos calendar.

No real client secret, refresh token, app password, or user credential is committed.

## 18. Non-goals

Milestone 5 does not include:

- importing arbitrary personal calendar events into Kairos;
- editing assignments from Google/Outlook/iCloud;
- two-way conflict resolution;
- scheduling study blocks;
- automatically changing source deadlines from calendar edits;
- attendees, invites, conferencing, or meeting scheduling;
- public webhook receivers;
- a hosted Kairos synchronization backend;
- 24/7 sync while the local application is closed;
- generic arbitrary-URL CalDAV setup;
- mobile-native background execution;
- notifications beyond the destination calendar's own reminder behavior.

These can be separate future milestones if the local-first assignment-to-calendar workflow proves valuable.

## 19. Design decisions resolved

- **Direction:** one-way Kairos → calendar.
- **Model:** calendar destinations are separate from assignment sources.
- **Calendars:** dedicated Kairos calendar per destination.
- **Google:** native Calendar API + PKCE + app-created-calendar scope.
- **Microsoft:** Graph + PKCE public client + delegated `Calendars.ReadWrite`.
- **Apple:** CalDAV preset with fixed Apple origin and app-specific authorization/credential flow.
- **Idempotency:** provider-specific stable create keys plus persistent event links.
- **Deadline event:** exact due timestamp, 15-minute transparent marker.
- **Undated assignment:** no external event; remove an existing generated event when the assignment explicitly becomes undated.
- **Manual deletion:** recreate a generated event; do not silently recreate an entire deleted Kairos calendar.
- **Live semantics:** reconcile immediately after local assignment changes and through Sync All; no claim of 24/7 sync while Kairos is closed.
- **Failure policy:** source and destination failures are isolated; partial calendar results preserve successful mappings.
- **Security:** local-only credentials, strict redaction, fixed provider origins, no arbitrary authenticated URL fetch.
- **Encryption:** not provided at rest in Milestone 5; UI/docs state this accurately.

## 20. Current provider references

The design was checked against current provider documentation on 2026-10-05:

- Google OAuth 2.0 for desktop/installed apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Google Calendar OAuth scopes: https://developers.google.com/workspace/calendar/api/auth
- Google Calendar event creation/idempotent event IDs: https://developers.google.com/workspace/calendar/api/guides/create-events
- Microsoft authorization-code + PKCE flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft desktop/public-client configuration: https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration
- Microsoft Graph create calendar: https://learn.microsoft.com/en-us/graph/api/user-post-calendars?view=graph-rest-1.0
- Microsoft Graph event `transactionId`: https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0
- Apple third-party iCloud Mail/Calendar/Contacts authorization: https://support.apple.com/en-us/121539
