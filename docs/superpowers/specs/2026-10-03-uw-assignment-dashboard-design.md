# UW Assignment Dashboard — Design Specification

**Date:** 2026-10-03  
**Status:** Approved design, pending written-spec review  
**Primary user:** A University of Washington Seattle student who wants one reliable place to see assignment deadlines from Canvas, Gradescope, and Ed.

## 1. Product Goal

Build a local-first personal assignment dashboard that answers one question quickly: **what do I need to do next, and when is it due?**

The application will normalize assignment metadata from multiple learning platforms into a single timeline and calendar while preserving source-of-truth differences. It will run on the student's own computer, avoid storing UW credentials, and favor simple, inspectable integrations over brittle automation.

### Success criteria

The first usable milestone is successful when the user can:

1. run the app locally with one documented command;
2. connect a UW Canvas calendar/iCal feed without entering a UW password into the app;
3. sync Canvas assignments into a local SQLite database;
4. see assignments grouped by urgency in an Upcoming view;
5. browse assignments in Calendar and All Assignments views;
6. filter by course and source;
7. open the source assignment when a source URL is available;
8. re-sync without creating duplicate rows;
9. see clear connection, sync, empty, and error states;
10. use the application comfortably on desktop and a narrow browser window.

Gradescope and Ed are explicitly designed into the architecture but are not faked in the first Canvas milestone. Their connectors are added only after their real account capabilities are validated.

## 2. Scope

### In scope for milestone 1

- Next.js + TypeScript application
- Tailwind CSS + shadcn-compatible component foundation
- SQLite persistence
- Canvas iCal source onboarding
- Canvas iCal parsing and normalization
- Idempotent assignment upserts
- Upcoming view
- Calendar view
- All Assignments view
- course and source filters
- assignment detail dialog/sheet
- light and dark themes
- manual Sync Now action
- source status and last-sync metadata
- local configuration handling that keeps the Canvas feed URL server-side
- unit/integration tests for parsing, normalization, and persistence
- one end-to-end smoke flow: connect Canvas feed → sync → assignment appears

### Deferred until after milestone 1

- Gradescope live connector
- Ed live connector
- automatic background scheduling
- notifications
- mobile native application
- cloud account or multi-device sync
- user accounts/authentication inside this app
- official UW branding, logos, or representations of university affiliation
- AI-generated planning or task prioritization

## 3. Key Constraints

### Canvas access at UW

UW does not provide student access to Canvas developer keys for personal integrations. Therefore the design must not depend on a student-generated Canvas REST API token. The Canvas connector will use the student's Canvas calendar/iCal feed as its first supported ingestion mechanism.

Reference: https://uwconnect.uw.edu/it?id=kb_article_view&sysparm_article=KB0034591

### Security and privacy

- The app will never request or store the user's UW NetID password.
- Source secrets such as a private Canvas feed URL are treated as credentials.
- Secrets remain server-side/local and are excluded from source control and client-rendered payloads.
- Logs must redact credentials and full private feed URLs.
- SQLite and config data remain local by default.

### Source disagreements

Canvas, Gradescope, and Ed can disagree about due dates or represent the same work differently. The application must not silently overwrite one source with another or merge records solely on title similarity.

## 4. Architecture

### Chosen approach: local-first Next.js monolith

Use a single Next.js project containing the UI, server-side sync routes/actions, normalization layer, and SQLite access.

Why this approach:

- direct compatibility with 21st.dev's React/Next.js component ecosystem;
- one runtime and one repository instead of a React + Python split;
- easy access to server-only configuration for private feed URLs;
- simple local deployment and testing;
- low operational overhead for a single-user application.

### High-level flow

```text
Canvas iCal ───────┐
                   │
Gradescope future ─┼─> Source adapter -> Normalizer -> Assignment repository -> SQLite
                   │                                           |
Ed future ─────────┘                                           v
                                                        Next.js UI
                                                 Upcoming / Calendar / All
```

### Module boundaries

```text
src/
  app/                 Next.js routes and page composition
  components/          reusable UI components
  features/
    assignments/       assignment views, filters, detail UI
    sources/           source onboarding and connection status UI
    sync/              sync actions and status presentation
  lib/
    db/                 schema, client, repositories
    sources/
      types.ts           source adapter contract
      canvas-ical/       Canvas connector implementation
      gradescope/        future connector boundary
      ed/                future connector boundary
    assignments/         normalization, dedupe/linking heuristics
    dates/               timezone/date utilities
    security/            secret redaction and config helpers
  tests/
```

Each connector owns retrieval and source-specific parsing. The normalizer owns conversion to application records. The repository owns persistence/upsert behavior. UI code consumes normalized records only.

## 5. Source Adapter Contract

All sources conform to a small interface so the UI and persistence layer do not depend on source-specific details.

```ts
export interface AssignmentSource {
  readonly kind: SourceKind;
  testConnection(): Promise<ConnectionResult>;
  sync(): Promise<SourceAssignment[]>;
}
```

`SourceAssignment` is source-shaped but already parsed into typed values. A separate normalization step converts it into the application's canonical assignment structure.

### Source kinds

```ts
type SourceKind = "canvas" | "gradescope" | "ed";
```

Only `canvas` is enabled in milestone 1. The other values exist to stabilize the model and routes; their UI connection actions remain clearly marked unavailable until implemented.

## 6. Canonical Data Model

### Assignment

```ts
type AssignmentStatus =
  | "pending"
  | "submitted"
  | "graded"
  | "overdue"
  | "unknown";

type Assignment = {
  id: string;
  source: SourceKind;
  externalId: string;
  courseId: string | null;
  courseName: string;
  title: string;
  dueAt: string | null;
  status: AssignmentStatus;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};
```

Dates are persisted as ISO-8601 timestamps. Date display uses the application's configured timezone, defaulting to `America/Los_Angeles` for this UW-focused single-user app.

### Source connection

```ts
type SourceConnection = {
  id: string;
  kind: SourceKind;
  label: string;
  enabled: boolean;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncStatus: "never" | "success" | "error";
  lastErrorCode: string | null;
};
```

Credentials are not stored in this public model.

## 7. Persistence

SQLite is the canonical local store.

Minimum tables:

### `source_connections`

- `id`
- `kind`
- `label`
- `enabled`
- `last_sync_started_at`
- `last_sync_completed_at`
- `last_sync_status`
- `last_error_code`
- `created_at`
- `updated_at`

### `assignments`

- `id`
- `source_connection_id`
- `source_kind`
- `external_id`
- `course_id`
- `course_name`
- `title`
- `due_at`
- `status`
- `source_url`
- `source_updated_at`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Unique constraint: `(source_connection_id, external_id)`.

### `assignment_links`

Reserved for cross-source relationships after Gradescope/Ed are added.

- `id`
- `assignment_a_id`
- `assignment_b_id`
- `relationship` (`possible_duplicate`, `same_work`, `date_conflict`)
- `confidence`
- `created_at`

No automatic destructive merge is performed.

## 8. Canvas iCal Connector

### Input

The user pastes a Canvas calendar/iCal feed URL in Sources → Canvas.

### Connection flow

1. User pastes the feed URL.
2. Server validates URL shape and allowed protocol.
3. `testConnection()` retrieves and parses the feed.
4. UI reports success or a sanitized error.
5. On confirmation, the secret is written to local server-side configuration.
6. Initial sync runs.
7. Normalized assignments are persisted.
8. UI navigates to Upcoming with imported records visible.

### Parsing behavior

The connector will:

- parse VEVENT records;
- preserve stable UID as the preferred `externalId`;
- extract summary/title;
- parse DTSTART/DTEND when present;
- retain source URL when exposed by the event;
- infer course name only from reliable feed metadata/patterns;
- skip malformed events individually rather than failing the whole feed;
- report counts for imported, updated, skipped, and errored records.

### Idempotency

Repeated syncs must update existing records by `(source_connection_id, external_id)` rather than duplicate them.

Records no longer present in a feed are not immediately deleted. Their `last_seen_at` remains stale so future retention behavior can be added safely without accidental data loss.

## 9. UX and Information Architecture

### Primary navigation

- **Upcoming** — default landing page
- **Calendar** — month-based planning
- **All Assignments** — dense searchable/filterable list
- **Sources** — connection setup and sync health
- **Settings** — theme/timezone and local preferences

### Upcoming

Assignments are sorted ascending by due date and grouped into:

- Overdue
- Today
- Tomorrow
- This week
- Later
- No due date

Each row/card shows:

- course
- assignment title
- due date/time
- source badge
- status
- source-link affordance if available

The screen prioritizes scannability over analytics. No charts or vanity metrics are included in milestone 1.

### Calendar

Month view with assignment markers inside each day. Selecting an assignment opens its detail UI without navigating away from the calendar context.

### All Assignments

Dense table for scanning and filtering. Initial columns:

- Assignment
- Course
- Due
- Source
- Status

Selecting a row opens the assignment detail dialog/sheet.

### Sources

Canvas shows connection status, last successful sync, and actions to test/update/sync. Gradescope and Ed appear only as clearly disabled future connectors, not as fake connected integrations.

## 10. 21st.dev Component and Theme Plan

The UI will use 21st.dev as a design/component reference library, while keeping copied/adapted code reviewable inside the project.

### App shell

**Dashboard with Collapsible Sidebar — Sonu kumar**

Reference collection: https://21st.dev/community/components/explore/collapsible-sidebar

Use for:

- desktop navigation hierarchy;
- collapsible behavior;
- responsive sidebar patterns.

Adaptation:

- remove generic admin/dashboard sections;
- retain only student-task navigation;
- collapse to a compact mobile trigger on narrow layouts.

### Calendar

**Fullscreen Calendar — Ahmed Mayara**

Reference: https://21st.dev/community/components/ahmedmayara/fullscreen-calendar

Use for:

- calendar grid composition;
- event placement;
- month navigation interaction patterns.

Adaptation:

- assignment-specific event content;
- source/status treatment;
- assignment detail selection;
- responsive fallback for narrow screens.

### Assignment table/detail interaction

**Table With Dialog — Ruixen**

Reference collection: https://21st.dev/community/components/explore/dev-table

Use for:

- dense All Assignments layout;
- row-to-detail interaction pattern.

Adaptation:

- remove unrelated CRUD controls;
- preserve accessible table semantics;
- make row selection keyboard-accessible;
- support due-date and status sorting/filtering.

### Segmented controls

**Segmented Control — Théo Balick**

Reference catalogue: https://21st.dev/community/components/newest

Use sparingly for mutually exclusive compact views such as date range or presentation mode. Do not replace ordinary navigation with segmented controls.

### Theme

**Modern Minimal — Serafim**

Reference: https://21st.dev/community/themes

Use as the neutral token baseline:

- restrained surfaces;
- minimal borders;
- typography-led hierarchy;
- high information density without visual noise;
- first-class dark mode.

The interaction accent will be inspired by UW Spirit Purple (`#4b2e83`) without copying UW branding. Husky Gold is not a general UI accent; if used at all, it is limited to rare semantic emphasis. The app must not imply official UW affiliation.

## 11. Accessibility and Responsive Behavior

- keyboard-accessible navigation, filters, rows, dialogs, and calendar selection;
- visible focus indicators;
- semantic buttons/links rather than clickable generic containers;
- color is never the sole representation of status or source;
- target WCAG AA contrast for text and primary controls;
- motion is optional and respects reduced-motion settings;
- layout remains usable around 320 CSS px without page-level horizontal scrolling;
- tables may switch to a compact list/card representation when a table becomes unusable on narrow widths.

## 12. Error Handling

Errors are classified into stable categories instead of exposing raw exceptions to the UI.

Canvas connection examples:

- `INVALID_URL`
- `NETWORK_ERROR`
- `UNAUTHORIZED_OR_EXPIRED_FEED`
- `INVALID_ICAL`
- `EMPTY_FEED`
- `PARTIAL_PARSE`

UI messages explain the action the user can take. Raw URLs and feed contents are not printed in client errors or logs.

A partial parse does not discard valid records. The sync summary reports skipped records and keeps the successful imports.

## 13. Synchronization Semantics

Milestone 1 uses explicit user-triggered synchronization.

Sync lifecycle:

```text
idle -> syncing -> success
                -> partial success
                -> error
```

Rules:

- only one sync per source runs at a time;
- the Sync Now button disables during an active sync;
- sync status survives page navigation;
- UI shows last successful sync time;
- failures do not delete previously imported assignments;
- a failed sync can be retried safely.

Background scheduling is deferred until manual sync proves reliable.

## 14. Cross-source Duplicate and Conflict Strategy

When future sources are implemented, exact source identities remain separate.

Potential duplicates may be suggested when course, normalized title, and due-time proximity align. Suggestions create an `assignment_links` relationship; they do not merge or delete records.

If two linked assignments disagree on due date, the UI explicitly displays the conflict and identifies each source's value.

Example:

```text
HW 3 — CSE 351
Gradescope: Oct 12, 11:59 PM
Canvas:     Oct 13, 11:59 PM
Date conflict
```

The user is never given a silently invented canonical deadline.

## 15. Testing Strategy

Implementation follows test-driven development.

### Unit tests

- iCal event parsing
- timezone conversion
- normalization
- stable external IDs
- source URL extraction
- malformed event handling
- grouping into Overdue/Today/Tomorrow/This week/Later
- secret redaction helpers

### Persistence/integration tests

- first sync inserts records
- repeated sync updates rather than duplicates
- changed due date updates existing assignment
- sync failure preserves prior rows
- partial parse persists valid rows and reports invalid ones

### Component tests

- filters update visible assignments
- source and status are not represented by color alone
- detail UI opens from keyboard and pointer interaction
- empty/error/loading states render correctly

### End-to-end smoke test

With a deterministic fixture feed:

1. start from unconfigured app state;
2. connect fixture Canvas feed;
3. run initial sync;
4. confirm Upcoming shows fixture assignment;
5. confirm Calendar contains the same assignment;
6. run sync again;
7. confirm no duplicate assignment is created.

## 16. Security Tests

- feed secret is absent from rendered HTML and serialized client state;
- feed secret is absent from normal logs;
- invalid URL schemes are rejected;
- server fetch logic cannot be used as an arbitrary local-file reader;
- test fixtures use fake credentials only;
- `.env*`, local secrets, and SQLite runtime files are ignored by git.

## 17. Implementation Milestones

### Milestone 1A — Project foundation

Create Next.js/TypeScript app, test runner, Tailwind/shadcn foundation, SQLite layer, schema, source adapter types, and baseline theme tokens.

### Milestone 1B — Canvas ingestion

Implement connection validation, fixture-driven iCal parsing, normalization, persistence, sync summaries, and secret redaction.

### Milestone 1C — Core dashboard

Implement app shell, Upcoming view, filters, sync state, and source badges using the approved 21st.dev-inspired patterns.

### Milestone 1D — Planning views

Implement Fullscreen Calendar adaptation and All Assignments table/dialog interaction.

### Milestone 1E — Onboarding and polish

Implement Sources setup, error states, dark mode, responsive behavior, accessibility checks, and end-to-end verification.

### Milestone 2 — Gradescope connector discovery + implementation

Validate the user's real Gradescope account capabilities before selecting an integration strategy. Prefer supported/tokenized access if available; otherwise evaluate a browser-local bridge that never stores UW credentials.

### Milestone 3 — Ed connector discovery + implementation

Validate available Ed API/token capability for the user's account, then implement through the same source adapter contract.

## 18. Non-goals and YAGNI Decisions

The first version deliberately does not include:

- analytics dashboards;
- study-time predictions;
- automatic assignment completion detection unless supplied reliably by a source;
- collaboration;
- comments/notes system;
- cloud hosting;
- push notifications;
- complex recurring scheduler;
- plugin marketplace;
- custom theming beyond light/dark + the chosen token system.

These would increase surface area before the core requirement—reliable deadline aggregation—is proven.

## 19. Acceptance Criteria for Milestone 1

Milestone 1 is complete only when all of the following are verified:

- Canvas iCal connection works using a fixture and a real-user-provided feed path without exposing the secret to the client;
- imported assignments persist in SQLite;
- repeat sync is idempotent;
- Upcoming, Calendar, and All Assignments show the same normalized records consistently;
- source/course filters work;
- timezone display is consistent in `America/Los_Angeles` by default;
- sync failures preserve prior data and show actionable UI;
- light and dark modes are usable;
- the primary workflow is keyboard accessible;
- automated test suite passes;
- end-to-end fixture smoke test passes;
- repository contains setup documentation and no credentials.

## 20. Design Decision Summary

- **Framework:** Next.js + TypeScript
- **Styling:** Tailwind CSS + shadcn-compatible primitives
- **Design references:** 21st.dev community components
- **Theme:** Modern Minimal foundation with restrained UW-inspired purple interaction accent
- **Persistence:** SQLite
- **Architecture:** local-first monolith with source adapters
- **Canvas strategy:** iCal feed, not student Canvas API token
- **Default screen:** Upcoming
- **Sync:** manual in milestone 1
- **Cross-source duplicates:** link/flag, never silently merge
- **Implementation method:** test-driven development under the Superpowers workflow
