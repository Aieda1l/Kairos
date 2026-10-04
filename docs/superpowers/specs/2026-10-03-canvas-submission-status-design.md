# Kairos Milestone 2: Canvas Submission Status

Date: 2026-10-03  
Status: Approved design, awaiting implementation plan  
Target branch: `feat/milestone-2-submission-status`

## 1. Purpose

Milestone 2 adds student-specific Canvas submission status to Kairos without replacing the working Canvas iCal deadline integration.

Kairos will continue to use the private Canvas iCal feed as the authoritative source for assignment deadlines. An optional Firefox WebExtension will use the user's already-authenticated `canvas.uw.edu` browser session to read submission state for assignments Kairos already knows about.

The milestone succeeds when Kairos can show reliable submission state in the web UI, refresh it automatically when stale, and do so without collecting UW credentials, persisting Canvas cookies, or attempting to automate UW SSO.

## 2. Product goals

Kairos should:

- distinguish `Not submitted`, `Submitted`, `Graded`, and `Excused`;
- represent `Late` and `Missing` as independent flags rather than mutually exclusive primary states;
- use `Status unavailable` when Canvas does not expose a trustworthy signal;
- automatically refresh submission status by default when Kairos opens and the latest successful status refresh is at least 15 minutes old;
- provide a manual `Sync submission status` action in the Kairos website;
- require only that Firefox is running with the Kairos extension installed and at least one signed-in `canvas.uw.edu` tab available;
- preserve the last known good status when a later refresh fails;
- make partial success visible without treating the whole synchronization as failed.

## 3. Non-goals

Milestone 2 will not:

- replace the Canvas iCal deadline source;
- ask for or store UW NetID credentials;
- copy, export, persist, or transmit Canvas authentication cookies;
- automate UW SSO;
- generate Canvas API tokens or bypass UW Canvas API restrictions;
- continuously scrape Canvas in the background;
- refresh on a periodic timer while Kairos is closed;
- support Chromium in the first release;
- discover arbitrary Canvas assignments from the extension;
- allow Kairos to instruct the extension to fetch arbitrary URLs;
- make the 15-minute staleness threshold user-configurable.

Periodic background refresh and Chromium support are planned follow-up capabilities that should reuse the protocol and extractor defined here.

## 4. Architecture

Milestone 2 consists of four collaborating units.

### 4.1 Kairos web application

The existing Next.js application owns:

- the set of assignments eligible for submission-status lookup;
- local persistence of normalized status data;
- staleness calculation;
- automatic-on-open and manual refresh triggers;
- user-visible sync state and status badges;
- validation of status results before persistence.

The web application never receives or handles Canvas authentication material.

### 4.2 Kairos page bridge

A Firefox content script is registered for local Kairos pages and activates only when `location.origin` is exactly `http://localhost:3000` or `http://127.0.0.1:3000`. It acts as a narrow bridge between the Kairos page and the extension runtime.

The bridge accepts only versioned, schema-valid Kairos messages. It does not expose a generic RPC mechanism.

### 4.3 Extension background broker

The extension background process:

- receives a normalized sync request from the Kairos bridge;
- locates an open `canvas.uw.edu` tab;
- verifies that the Canvas content script is reachable;
- forwards only normalized course and assignment identifiers;
- aggregates Canvas-side results;
- returns one versioned result envelope to the Kairos page bridge.

The broker never receives a Canvas password or cookie value.

### 4.4 Canvas content script

A content script running on `canvas.uw.edu` performs same-origin assignment-page requests within the existing signed-in browser context.

It:

- accepts only numeric Canvas course and assignment identifiers;
- constructs Canvas assignment URLs internally;
- retrieves assignment pages with bounded concurrency;
- extracts submission state using a versioned parser;
- returns normalized status records;
- never sends page HTML, cookies, headers, or authentication material back to Kairos.

The high-level flow is:

```text
Kairos page
    |
    | sync request
    v
Kairos page bridge
    |
    | WebExtension runtime messaging
    v
Extension background broker
    |
    | locate signed-in Canvas tab
    v
Canvas content script
    |
    | same-origin requests
    v
Canvas assignment pages
    |
    | normalized results only
    v
Kairos persistence + UI
```

## 5. Firefox-first extension packaging

The extension will live in the main Kairos repository under:

```text
extension/firefox/
```

Shared protocol types and schemas should live in a browser-neutral location so a future Chromium package can reuse them.

For Milestone 2 the extension is installed as an unpacked temporary/developer extension. Store packaging, signing, and automatic updates are not required.

The extension should request the minimum practical permissions:

- access to `canvas.uw.edu`;
- access to local `localhost` / `127.0.0.1` pages needed to inject the bridge, with the bridge itself refusing to activate unless the exact origin is `http://localhost:3000` or `http://127.0.0.1:3000`;
- only the tab/runtime capabilities required to find and message the Canvas tab.

The extension must not request:

- `cookies`;
- browsing history;
- downloads;
- `<all_urls>`;
- broad unrelated host access.

## 6. Trust boundaries and message protocol

All cross-boundary messages are explicit, versioned, and schema-validated.

### 6.1 Kairos to extension

Kairos sends only the assignments it already knows about:

```ts
type SubmissionSyncRequestV1 = {
  protocolVersion: 1;
  requestId: string;
  assignments: Array<{
    assignmentLocalId: string;
    courseId: string;
    assignmentId: string;
  }>;
};
```

Constraints:

- `courseId` and `assignmentId` must contain only decimal digits;
- no URL field is accepted;
- no course or assignment is requested unless it already exists in Kairos;
- duplicate identifiers are rejected or normalized before dispatch;
- each extension message contains at most 100 assignments; larger logical refreshes are split into sequential chunks by Kairos and reconciled as one user-visible sync.

The extension constructs:

```text
https://canvas.uw.edu/courses/<courseId>/assignments/<assignmentId>
```

It does not accept alternate hosts or paths from the page.

### 6.2 Extension to Kairos

The extension returns normalized records only:

```ts
type SubmissionStatusState =
  | "unknown"
  | "not_submitted"
  | "submitted"
  | "graded"
  | "excused";

type SubmissionStatusResultV1 = {
  assignmentLocalId: string;
  courseId: string;
  assignmentId: string;
  state: SubmissionStatusState;
  isLate: boolean;
  isMissing: boolean;
  submittedAt: string | null;
  checkedAt: string;
  extractorVersion: string;
  errorCode?: string;
};
```

The envelope also reports overall counts and whether the run was complete or partial.

Kairos validates every returned identifier against the original request before persistence. Results for unknown or mismatched assignments are rejected.

## 7. Data model

Submission state is stored separately from the existing assignment record so deadline ingestion and student-specific status ingestion can fail independently.

A new table should represent the latest known status:

```text
assignment_submission_status
  assignment_id          PK/FK -> assignments.id
  state                  enum-like text
  is_late                integer boolean
  is_missing             integer boolean
  submitted_at           nullable timestamp
  checked_at             timestamp
  extractor_version      text
  updated_at              timestamp
```

A separate synchronization record stores status-refresh health independently from the existing Canvas iCal sync metadata:

```text
submission_status_sync
  source_connection_id   PK/FK
  last_attempted_at      nullable timestamp
  last_successful_at     nullable timestamp
  last_error_code        nullable text
  updated_count          integer
  failed_count           integer
```

The exact schema may use the repository's existing settings/source metadata patterns, but these logical fields and independence from iCal sync state are required.

## 8. Status semantics

Primary status precedence is:

```text
Excused
  >
Graded
  >
Submitted
  >
Not submitted
  >
Unknown
```

This precedence resolves pages where more than one signal is visible.

`Late` and `Missing` are independent booleans. For example:

- `Submitted · Late`
- `Not submitted · Missing`
- `Graded · Late`

Kairos must never infer `not_submitted` merely because a submitted signal is absent. A page that does not contain a trustworthy explicit status signal returns `unknown`.

This protects against:

- no-submission assignments;
- external/LTI tools;
- locked or unavailable assignments;
- unpublished or unusual assignment types;
- temporary Canvas markup changes;
- conflicting indicators.

## 9. Canvas extraction strategy

The extractor is a small isolated module with a version identifier.

It uses an ordered set of explicit Canvas signals rather than one brittle selector. Signals may include:

- explicit submission-state text such as submitted/not submitted;
- grade or entered-grade indicators;
- excused indicators;
- structured assignment/submission regions;
- late or missing labels;
- submission timestamps when clearly available.

The extractor returns `unknown` when:

- required elements are absent;
- signals conflict;
- the response looks like a login/authentication page;
- Canvas returns an unexpected page type;
- the parser cannot confidently map the page to the requested assignment.

The extractor should operate on fixture HTML in unit tests and must not require a live Canvas instance for ordinary test execution.

## 10. Synchronization behavior

### 10.1 Automatic refresh

Automatic refresh is enabled by default.

When a Kairos dashboard page loads:

1. read the latest successful submission-status refresh time;
2. if it is less than 15 minutes old, do nothing;
3. if it is missing or at least 15 minutes old, send one refresh request;
4. do not retry automatically again during the same page load.

This avoids loops when Canvas is unavailable or signed out.

### 10.2 Manual refresh

The website always exposes a `Sync submission status` button.

Manual refresh bypasses the 15-minute freshness check but still uses the same extension pipeline and concurrency limits.

### 10.3 Scope

A refresh checks all currently imported Canvas assignments that have valid numeric Canvas course and assignment identifiers.

The extension does not independently discover unrelated Canvas coursework. Assignments lacking valid identifiers are skipped and remain `Status unavailable`.

### 10.4 Concurrency

Canvas assignment-page requests use a fixed concurrency limit of four requests at a time.

One assignment failure does not abort the batch. Kairos sends at most 100 assignments per extension message and processes additional chunks sequentially within the same logical refresh.

### 10.5 Persistence

A batch is reconciled transactionally for all successful results.

For an individual assignment:

- a successful new result replaces the previous status;
- a failed lookup preserves the previous successful status;
- `checked_at` changes only for a result that was actually checked;
- an unavailable/failed assignment is surfaced as stale or unavailable without deleting its last known state.

The overall synchronization record updates `last_attempted_at` on every attempt. It updates `last_successful_at` when the extension reaches Canvas and returns at least one successfully checked assignment result; a run may therefore be successful-but-partial. A run that fails before any assignment is checked, including extension-unavailable, no-tab, or signed-out failures, does not advance `last_successful_at`. Partial runs record updated/failed counts and set `last_error_code` to a stable partial-sync code.

## 11. UI and UX

### 11.1 Upcoming/dashboard surface

Near the existing Canvas sync controls, Kairos shows:

```text
Canvas submissions · Updated 8 min ago
[Sync submission status]
```

During refresh it shows a compact non-blocking syncing state.

After a partial run it may show:

```text
18 of 20 submission statuses updated
```

### 11.2 Assignment status badges

Primary labels are:

- `Not submitted`
- `Submitted`
- `Graded`
- `Excused`
- `Status unavailable`

Secondary flags are displayed alongside the primary label where applicable.

The old generic `Unknown` wording should not remain as the normal Canvas-feed-only experience. `Status unavailable` communicates that the source did not provide a reliable status.

### 11.3 Extension availability states

Kairos recognizes these bridge states:

- extension unavailable;
- Canvas tab unavailable;
- Canvas signed out;
- syncing;
- sync complete;
- sync partial.

Recommended messages:

- extension unavailable: `Firefox extension not detected`;
- Canvas tab unavailable: `Open Canvas in Firefox, then try again.`;
- Canvas signed out: `Sign in to Canvas, then retry.`;
- partial sync: show updated/failed counts;
- success: update badges and timestamp without a modal.

Existing status values remain visible whenever possible.

### 11.4 Settings

Settings gains a Canvas submission-status section:

```text
Submission status
Automatic refresh          On
Refresh when older than    15 minutes
Last successful refresh    <timestamp>
Firefox extension          Connected / Not detected
```

The 15-minute threshold is explanatory text in Milestone 2, not a user-editable control.

### 11.5 Extension popup

The extension popup is diagnostic only in this milestone.

It should show enough information to confirm:

- Kairos extension is active;
- Canvas tab/session is detected or unavailable;
- extension version.

Primary synchronization controls remain on the Kairos website.

## 12. Error handling

Failures are non-destructive.

| Condition | Behavior |
| --- | --- |
| Extension unavailable | Preserve statuses; show install/connect guidance |
| No Canvas tab | Preserve statuses; ask user to open Canvas |
| Canvas signed out | Preserve statuses; ask user to sign in |
| One assignment fails | Update successful assignments; report partial sync |
| Canvas markup changed | Return `unknown` or parse error for affected records |
| Canvas network error | Preserve last successful values |
| Kairos cannot persist results | Report failure; extension keeps no durable queue |
| Invalid/mismatched result | Reject result and record validation failure |

The extension does not maintain a durable offline queue. The user can retry from Kairos.

## 13. Security requirements

Milestone 2 must preserve these invariants:

1. Kairos never asks for or stores UW credentials.
2. Kairos never receives Canvas cookies or authorization headers.
3. The extension never exports cookies to Kairos.
4. No arbitrary URL-fetch capability crosses the Kairos/extension boundary.
5. Canvas host construction is hard-coded to `https://canvas.uw.edu`.
6. Course and assignment identifiers are validated before URL construction.
7. Result payloads contain normalized status metadata only.
8. All inbound messages are schema-validated and protocol-versioned.
9. Local persistence contains status metadata, not Canvas page HTML.
10. Debug/error logs redact or omit private feed URLs and authentication material.

The local Kairos bridge activates only when `location.origin` is exactly `http://localhost:3000` or `http://127.0.0.1:3000`. On any other localhost origin it installs no page-message listener.

## 14. Testing strategy

### 14.1 Kairos unit/integration tests

Cover:

- migration/schema creation;
- status repository CRUD/upsert behavior;
- batch reconciliation and idempotence;
- 15-minute staleness logic;
- automatic refresh triggers once per page load;
- manual refresh bypassing freshness;
- status precedence;
- late/missing flag combinations;
- preservation of previous values after failed lookups;
- partial-sync bookkeeping;
- validation rejection for unknown assignments;
- message-envelope validation;
- sync-state UI.

### 14.2 Firefox extension tests

Cover:

- protocol schema validation;
- numeric identifier validation;
- URL construction;
- Canvas HTML fixtures for all primary states;
- late/missing extraction;
- ambiguous/no-signal pages returning `unknown`;
- login-page detection;
- individual fetch failure;
- partial batches;
- concurrency limiting;
- result ordering/identity;
- outbound payloads containing no cookie/header/page-HTML data.

### 14.3 Component tests

Cover:

- `Status unavailable` default presentation;
- Submitted/Graded/Excused/Not submitted badges;
- late and missing secondary labels;
- automatic syncing state;
- extension missing guidance;
- no Canvas tab guidance;
- signed-out guidance;
- partial sync message;
- last-updated timestamp.

### 14.4 End-to-end test

The milestone should add an extension-aware E2E flow using a local/mock Canvas fixture environment rather than real UW credentials.

The E2E scenario verifies:

1. Kairos has an assignment imported from iCal;
2. submission status begins unavailable/stale;
3. the extension bridge is available;
4. stale-on-open synchronization triggers;
5. mock Canvas reports the assignment as submitted;
6. Kairos updates the badge and timestamp;
7. a manual refresh also works;
8. network/message payloads do not contain authentication material.

Live `canvas.uw.edu` is not a CI dependency.

## 15. Repository organization

Expected new structure:

```text
extension/
  firefox/
    manifest.json
    background/
    content/
    popup/
    tests/

src/
  features/
    submission-status/
  lib/
    submission-status/
    extension-protocol/

tests/
  fixtures/
    canvas-submission-pages/
```

Exact filenames may change during planning, but the parser, extension protocol, persistence layer, and UI state should remain isolated units with explicit interfaces.

## 16. Release and compatibility strategy

Milestone 2 ships Firefox first as an unpacked developer extension.

The extension protocol and extractor are browser-neutral where practical. Firefox-specific runtime calls should be isolated behind a small adapter so a future Chromium release can:

- reuse protocol schemas;
- reuse Canvas status extraction;
- reuse persistence and website behavior;
- supply a Chromium manifest/runtime adapter instead of forking business logic.

Automatic periodic background refresh is deferred. A future release may add an opt-in interval using browser scheduling APIs while preserving the default stale-on-open behavior.

## 17. Acceptance criteria

Milestone 2 is complete when all of the following are true:

- Firefox extension can be loaded unpacked and reports itself to Kairos;
- Kairos retains iCal as the deadline source;
- opening Kairos automatically refreshes submission status when the last successful refresh is at least 15 minutes old;
- the website manual refresh button works;
- a signed-in open Canvas tab is sufficient for status lookup;
- no UW password, Canvas cookie, or authorization material is stored or sent to Kairos;
- known assignments can display Not submitted, Submitted, Graded, Excused, Late, and Missing appropriately;
- ambiguous assignments display Status unavailable rather than being guessed as not submitted;
- one failed assignment does not prevent successful statuses from persisting;
- last known successful status survives failed future refreshes;
- extension-unavailable, no-tab, signed-out, partial, and success states are represented in the website UI;
- automated unit, integration, component, extension, and E2E tests cover the behaviors defined above;
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`, and `npm run build` are green before merge.

## 18. Approved design decisions

The following decisions were explicitly approved during design:

- browser-extension approach rather than Canvas credential/session automation;
- Firefox-first release, unpacked installation acceptable;
- Chromium support deferred;
- website-owned manual sync control;
- automatic refresh enabled by default;
- stale threshold of 15 minutes;
- signed-in open Canvas tab required;
- iCal remains deadline authority;
- primary states: Not submitted, Submitted, Graded, Excused;
- Late and Missing as independent flags;
- two content-script bridges with a background broker;
- only normalized status data crosses back into Kairos;
- no periodic background timer in Milestone 2.
