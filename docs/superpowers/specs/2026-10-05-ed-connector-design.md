# Kairos Milestone 4 — Direct Ed Connector Design

**Date:** 2026-10-05  
**Status:** Draft for written-spec review  
**Milestone:** 4  
**Primary user:** A University of Washington Seattle student using Kairos locally.

## 1. Goal

Add a direct, read-only Ed connector that imports all visible Ed Lessons from explicitly selected courses into Kairos's existing local assignment model.

The connector must:

- authenticate with a user-created Ed personal access token (PAT);
- store that token only in Kairos's local, server-only credential table;
- discover the user's enrolled Ed courses;
- let the user explicitly enable the courses Kairos should sync;
- import all visible lessons, including lessons without due dates;
- preserve Ed availability, due-date, and progress/status information when present;
- never invent a deadline for an undated lesson;
- preserve previously known data when refreshes fail;
- keep Ed records independent from Canvas and Gradescope records.

Milestone 4 is strictly read-only. Ed Discussion threads, Resources, Workspaces, posting, quiz submission, and other Ed mutations are out of scope.

## 2. Discovery basis

The Ed web application exposes a JSON API under `https://us.edstem.org/api`. Current community clients, including:

- `r1ckyIn/canvas-ed-mcp`; and
- `bunizao/edstem-cli`

use Ed personal access tokens as bearer credentials.

The relevant observed API behavior is:

- `GET /api/user` returns the authenticated user plus enrolled courses;
- `GET /api/courses/{courseId}/lessons` returns lessons and modules for a course;
- `GET /api/lessons/{lessonId}` returns lesson detail.

Current clients authenticate with:

```text
Authorization: Bearer <ed-personal-access-token>
```

The Ed API is not treated as a stable public contract. Existing clients describe it as beta/unofficial and implement defensive parsing around changing response fields.

The user confirmed that their Ed account exposes the API-token settings page, so a direct API connector is feasible for Kairos and avoids requiring the Firefox extension.

## 2.1 Regional-host correction

Live-account smoke on 2026-10-05 showed that the generic `https://edstem.org/api` origin returns an upstream error for the target UW account. Current Ed clients for US accounts use `https://us.edstem.org/api`, and the user's token is created from the US-region settings path. Kairos therefore pins Milestone 4 to the US Ed origin rather than accepting an arbitrary region/base URL.

## 3. Chosen architecture

Implement Ed as a normal server-side source adapter behind Kairos's existing `AssignmentSource` contract.

```
Sources UI
    |
    | token submitted once
    v
Kairos API routes
    |
    +--> server-only credential repository
    |       stores Ed PAT locally in SQLite
    |
    +--> EdSource / Ed API client
            |
            | Authorization: Bearer <PAT>
            v
      https://us.edstem.org/api
            |
            +--> /user
            +--> /courses/{id}/lessons
            |
            v
      strict normalized records
            |
            v
      existing source/course/assignment repositories
```

The Ed token never enters assignment records, source-course records, public source-connection models, browser persistence, or client-side state after submission.

No Firefox-extension permissions are added for Ed.

## 4. Alternatives considered

### A. Direct Ed API with locally stored PAT — selected

Advantages:

- simplest architecture;
- no browser-tab dependency;
- no new extension permissions;
- aligns with Ed's own PAT mechanism;
- easy to mock and test;
- reuses Kairos's existing source-adapter and server-side credential boundaries.

Cost:

- Kairos must protect a bearer token in its local SQLite database;
- Ed's beta/unofficial API may change.

### B. Firefox browser-session reuse

This would mirror Gradescope and avoid storing an Ed PAT, but it would unnecessarily tie Ed sync to a signed-in browser tab when the user's account already exposes a dedicated API token.

### C. External helper process or MCP server

This would reuse an existing Ed client but add another runtime, process boundary, installation path, and credential location. That complexity is not justified for Kairos's current local-first application.

## 5. Credential model

Extend `source_credentials` with a nullable `ed_api_token` column.

Extend `SourceCredentialRepository` with:

- `setEdApiToken(connectionId, token)`;
- `getEdApiToken(connectionId)`.

The token is stored as plaintext in the local SQLite credential table, matching the user's selected option for Milestone 4. The database is not encrypted at rest in this milestone.

Security requirements:

1. The token is accepted only through Ed-specific server routes.
2. The token is never returned after submission.
3. The token is never rendered in the Sources UI after save.
4. Errors are passed through `redactError(..., [token])` or an equivalent redaction path.
5. Tests must assert that API responses and rendered pages do not contain submitted secret markers.
6. Logs must not include request headers or raw Ed response bodies.
7. Token rotation replaces the stored token; the previous value is not retained.

Encrypted-at-rest credential storage remains separate future work.

## 6. Connection and course discovery

Replace the Ed future-source placeholder with a real `EdSourceCard`.

### 6.1 Test connection

The initial Ed card shows a password-style token field and a **Test connection** action.

`POST /api/sources/ed/test`:

1. validates basic request shape;
2. creates a short-lived Ed client using the submitted token;
3. calls `GET /api/user`;
4. validates the minimum response structure needed for identity/course discovery;
5. returns only a minimal public result such as:
   - success/failure;
   - discovered course count;
   - sanitized error code/message.

Testing does not persist the token.

### 6.2 Connect

`POST /api/sources/ed/connect`:

1. validates the token by calling `/api/user`;
2. creates or enables `source_connections(kind='ed')`;
3. stores the token in `source_credentials.ed_api_token`;
4. normalizes and upserts discovered courses into `source_courses`;
5. returns the public source connection plus public course metadata.

Add `SourceConnectionRepository.upsertEd("Ed")`.

### 6.3 Course selection

Discovered courses are persisted with:

- Ed course ID;
- short code when available;
- full name;
- session/term when available;
- year when available.

Newly discovered courses default to disabled.

Existing course selections are preserved when courses are rediscovered.

The user explicitly enables the Ed courses that Kairos should sync.

A later discovery may add new courses without silently enabling them.

Courses that stop appearing upstream remain in local metadata rather than being destructively removed.

## 7. Ed API client

Create a focused Ed API client under the Ed source module.

Responsibilities:

- fixed base URL: `https://us.edstem.org/api/`;
- bearer-token authentication;
- `Accept: application/json`;
- bounded request timeout;
- no writes;
- response-status normalization;
- JSON parsing with strict downstream validation;
- token-aware error redaction.

Required operations for Milestone 4:

- `fetchUser()`;
- `fetchLessons(courseId)`.

No generic arbitrary-path request method should be exposed outside the Ed client.

## 8. Course and lesson parsing

Treat Ed API payloads as untrusted external data.

### 8.1 Course parsing

From `/api/user`, normalize each enrollment to:

- `externalCourseId`;
- `shortName`;
- `fullName`;
- `term`;
- `year`.

Unknown or irrelevant fields are ignored.

A malformed enrollment is skipped only if its identity cannot be established safely. A completely unrecognized `/api/user` shape fails discovery closed.

### 8.2 Lesson parsing

For each enabled course, `/api/courses/{courseId}/lessons` is parsed independently.

Recognized lesson fields include:

- stable lesson ID;
- course ID;
- module ID/name;
- lesson title;
- type/kind when present;
- availability state;
- progress status;
- visibility flags;
- effective availability timestamp, falling back to raw availability timestamp;
- effective due timestamp, falling back to raw due timestamp;
- updated timestamp when present.

Kairos imports **all visible lessons**, including lessons whose due date is null.

Hidden or unlisted lessons are excluded.

Missing optional fields do not cause a course failure.

## 9. Assignment normalization

Each imported Ed Lesson becomes one `SourceAssignment`.

Mapping:

- `externalId`: stable Ed lesson ID;
- `courseId`: Ed course ID;
- `courseName`: selected Ed course display name;
- `title`: Ed lesson title;
- `releaseAt`: effective availability timestamp, else availability timestamp, else null;
- `dueAt`: effective due timestamp, else due timestamp, else null;
- `lateDueAt`: null;
- `sourceStatusText`: normalized Ed progress/state text;
- `gradeScore`: null;
- `gradeMax`: null;
- `gradeDisplay`: null;
- `sourceUpdatedAt`: lesson updated timestamp when available;
- `sourceUrl`: canonical Ed lesson URL only if the stable URL shape is verified during implementation/manual smoke.

### 9.1 Status normalization

Normalization is deliberately conservative:

- Ed `completed` -> Kairos `submitted`;
- Ed `unattempted` -> Kairos `pending`;
- Ed `attempted` -> Kairos `pending`;
- unrecognized or missing progress -> Kairos `unknown`.

Kairos does not infer `graded` because lesson progress is not a grade.

Kairos does not infer `overdue` solely from wall-clock time during ingestion; existing view/query logic remains responsible for date-based presentation.

The exact meaningful Ed state/progress text is retained separately in `sourceStatusText`.

## 10. Undated lessons

An Ed lesson with no due date is still imported.

Rules:

- `dueAt = null`;
- no synthetic/fallback deadline is generated;
- it does not appear in date-bucketed Upcoming sections that require a due date;
- it remains available through source/all-assignment surfaces that support undated work;
- its progress/status and release date remain visible where those fields are shown.

This ensures Kairos does not silently discard legitimate Ed coursework merely because the instructor did not configure a deadline.

## 11. Synchronization semantics

Ed synchronization is course-isolated and preservation-first.

For each enabled course:

1. fetch lessons;
2. validate the response;
3. filter hidden/unlisted lessons;
4. normalize each supported lesson;
5. persist the successful course result independently.

### 11.1 Full success

All enabled courses were refreshed successfully.

- all successful lesson records are upserted;
- connection sync status becomes success;
- no error code remains.

### 11.2 Partial success

At least one enabled course succeeded and at least one failed.

- successful course data is upserted;
- failed-course prior data remains untouched;
- connection records a stable partial-sync diagnostic code;
- the user sees that refresh was incomplete.

### 11.3 Total failure

No enabled course could be refreshed.

- prior Ed assignment data remains untouched;
- connection sync status becomes error;
- last successful data is preserved.

Assignments that disappear from a successful Ed response are not immediately deleted in Milestone 4. Kairos continues to rely on `last_seen_at` and conservative retention; archival/removal policy remains separate work.

## 12. Error model

Stable Ed-facing errors should include:

- `ED_AUTH_INVALID` — token rejected or expired;
- `ED_NETWORK_ERROR` — transport failure;
- `ED_RATE_LIMITED` — upstream 429;
- `ED_UPSTREAM_ERROR` — upstream 5xx or unusable response;
- `ED_COURSE_UNAVAILABLE` — one selected course cannot be read;
- `ED_PARSE_ERROR` — response no longer matches supported structure;
- `PARTIAL_SYNC` — one or more selected courses failed while another succeeded;
- `ED_NOT_CONNECTED` — no stored Ed connection/token;
- `ED_NO_COURSES_ENABLED` — sync requested with no enabled courses.

Error responses contain stable codes and actionable safe messages only.

They must never contain:

- the Ed PAT;
- `Authorization` headers;
- raw request headers;
- raw response bodies;
- account email;
- arbitrary URLs returned by upstream.

## 13. Sources UI

The Ed source card shows:

### Before connection

- explanation that Kairos uses an Ed personal access token;
- password-style token field;
- **Test connection**;
- **Connect Ed** after a successful or directly validated submission.

### After connection

- connected state;
- last sync state/time;
- discovered courses;
- per-course enable/disable controls;
- **Refresh courses**;
- **Sync now**;
- **Update token**.

The existing token is never displayed again.

Newly discovered courses remain disabled until explicitly enabled.

The UI should make clear that Ed synchronization is read-only.

## 14. Assignment surfaces

Ed already exists in `SourceKind` and source-badge handling, so imported lessons use the existing Ed identity.

### Upcoming

Only Ed lessons with due dates participate in due-date grouping.

Resolved/completed Ed lessons follow the existing source-independent resolution behavior and should not appear as unresolved Upcoming work once normalized as submitted.

Undated lessons are not assigned an artificial date.

### All Assignments / source-oriented views

All imported visible Ed lessons remain queryable, including undated lessons.

Where available, show:

- title;
- course;
- release date;
- due date or “No due date”;
- Ed progress/status;
- source link.

### Calendar

Only lessons with real due dates create dated assignment events.

No second event is created for release dates.

## 15. Persistence changes

### 15.1 `source_connections`

No schema change is required; `ed` is already an allowed source kind.

### 15.2 `source_credentials`

Add:

```sql
ed_api_token TEXT
```

The migration must be additive for existing databases.

### 15.3 `source_courses`

Reuse the existing generic course-selection table.

### 15.4 `assignments`

No new assignment columns are required for Milestone 4. Existing generic fields already cover the Ed lesson data being imported.

## 16. Security and privacy invariants

The following are non-negotiable:

1. Kairos never asks for the user's Ed password.
2. Kairos stores only the user-created Ed PAT needed for API access.
3. The PAT stays in server-only persistence after submission.
4. Public source models never include credential fields.
5. API responses never echo the submitted or stored PAT.
6. Logs and error messages never contain the PAT or bearer header.
7. Ed requests target only the fixed Ed API origin.
8. The Ed client exposes only the read operations needed by Milestone 4.
9. No Ed write endpoint is called.
10. Failed or partial sync never deletes prior known data.
11. Cross-source records remain independent.
12. Real credentials are used only for manual smoke testing, never CI fixtures.

## 17. Testing strategy

Implementation follows TDD.

### 17.1 Unit tests

Cover:

- valid course discovery;
- 0/1/many courses;
- malformed course records;
- valid lesson normalization;
- 0/1/many lessons;
- effective availability timestamp precedence;
- effective due timestamp precedence;
- missing due dates;
- missing release dates;
- hidden lessons excluded;
- unlisted lessons excluded;
- completed/unattempted/attempted/unknown progress mapping;
- malformed lessons with missing stable identity;
- strict fixed-origin request construction;
- auth/network/rate-limit/upstream error mapping;
- token redaction.

### 17.2 Repository/migration tests

Cover:

- additive `ed_api_token` migration;
- Ed token round-trip through the server-only credential repository;
- Ed token absent from public source connection models;
- Ed source connection upsert;
- course discovery persistence;
- existing course selections preserved;
- new courses default disabled.

### 17.3 Route/integration tests

Cover:

- test does not persist token;
- connect validates before persisting;
- connect never returns token;
- invalid token produces `ED_AUTH_INVALID`;
- course refresh preserves enabled selections;
- sync only requests enabled courses;
- successful sync persists visible lessons;
- undated lessons persist;
- partial failure updates successful courses and preserves failed-course prior data;
- total failure preserves all prior Ed assignment data.

### 17.4 Component tests

Cover:

- token field uses secret input semantics;
- successful test result;
- course-selection UI;
- newly discovered courses disabled;
- update-token flow without revealing the old token;
- partial/failure messaging;
- undated lesson presentation.

### 17.5 E2E

Mock Ed API calls and exercise:

1. enter token;
2. test connection;
3. connect;
4. select courses;
5. sync;
6. verify dated and undated Ed lessons appear in the correct Kairos surfaces.

Capture relevant Kairos API response bodies and assert that they do not contain a known token marker or `Authorization` material.

### 17.6 Manual smoke

Using the user's real Ed PAT, without pasting it into chat or test fixtures:

- test connection;
- discover real courses;
- enable at least one Ed course;
- sync lessons;
- compare titles, visibility, release dates, due dates, and progress against Ed;
- verify at least one undated lesson if the account contains one;
- rotate or replace the token;
- verify invalid-token behavior;
- confirm the token is never rendered back by Kairos.

## 18. Operational risks

### Ed API instability

Ed's API is treated as beta/unofficial. Response fields or endpoint behavior may change independently of Kairos.

Mitigations:

- isolate Ed parsing/client code;
- strict schemas with optional fields where appropriate;
- fail closed on unknown top-level shapes;
- preserve prior data on parse failures;
- maintain representative JSON fixtures;
- expose parse-specific diagnostics.

### Credential storage

The Ed PAT is a bearer credential stored in plaintext in the local SQLite database for this milestone.

This is an explicit product trade-off selected for local simplicity. Kairos must document that anyone with access to the local database may be able to recover the token.

Encrypted-at-rest credentials can be designed later without changing the public Ed source contract.

### Course semantics

Ed Lessons are not guaranteed to represent every graded assignment in a course. Some courses use Ed primarily for readings or interactive lessons while Canvas or Gradescope remain the authoritative deadline systems.

Kairos therefore preserves Ed records independently and does not treat Ed as globally authoritative.

## 19. Roadmap/documentation updates

As part of Milestone 4 implementation:

- update the roadmap's Milestone 3 status to reflect the completed real-browser Gradescope smoke and merge;
- change Milestone 4 from planned/discovery to implementation/completion state as work progresses;
- document how to create an Ed PAT;
- document that the PAT is stored locally in Kairos's SQLite credential store;
- document Ed API instability and token-rotation behavior.

## 20. Milestone 4 completion criteria

Milestone 4 is complete only when:

- a valid Ed PAT can be tested without persistence;
- Ed can be connected with the PAT stored server-side only;
- enrolled courses can be discovered;
- courses can be explicitly enabled/disabled;
- selected courses sync all visible lessons;
- hidden/unlisted lessons are excluded;
- lessons with and without due dates persist correctly;
- release and due timestamps use effective values when available;
- Ed progress maps conservatively into Kairos status;
- partial and total failures preserve prior known data;
- Ed assignments appear correctly in relevant Kairos views;
- secret-exposure tests prove that the PAT is absent from public API/UI output;
- unit, integration, component, E2E, lint, typecheck, and production build checks pass;
- a real-account manual smoke confirms the connector against the user's Ed account.

## 21. Explicitly deferred

Not part of Milestone 4:

- Ed Discussion thread aggregation;
- Ed Resources aggregation;
- Ed Workspaces;
- quiz answering/submission;
- marking lessons complete;
- posting/editing discussions;
- any other Ed write operation;
- encrypted-at-rest credential storage;
- automatic cross-source deduplication;
- background periodic refresh alarms;
- Chromium-specific Ed work;
- cloud credential sync;
- treating Ed as authoritative over Canvas or Gradescope.
