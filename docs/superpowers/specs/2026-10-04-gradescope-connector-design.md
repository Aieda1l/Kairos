# Kairos Milestone 3 — Direct Gradescope Connector Design

**Date:** 2026-10-04  
**Status:** Draft for written-spec review  
**Milestone:** 3  
**Primary user:** A University of Washington Seattle student using Kairos locally in Firefox.

## 1. Goal

Add a direct, read-only Gradescope connector that imports the complete assignment information visible to the signed-in student account from the beginning:

- course identity and names;
- assignment identity and title;
- release date;
- due date;
- late due date;
- student-facing submission/status text;
- normalized submission state;
- published numeric grade;
- maximum grade;
- source link and source-specific identity.

The connector must fit Kairos's existing local-first architecture. It must reuse an already authenticated Gradescope tab in Firefox and must not ask for, store, export, or proxy the user's Gradescope/UW password, session cookies, CSRF tokens, or raw authenticated page HTML.

Gradescope records remain independent source records. Kairos must not silently merge them with Canvas records or invent a canonical deadline when sources disagree.

## 2. Discovery basis

Gradescope does not expose a supported public student API for this use case. The maintained MIT-licensed `nyuoss/gradescope-api` project demonstrates that the information Kairos needs is present in the authenticated Gradescope web experience.

Relevant behavior from that project:

- authenticated account discovery reads `/account`;
- student assignment discovery reads `/courses/:courseId`;
- student assignment rows expose assignment identity/title, submission or grade text, release date, due date, and late due date;
- instructor views may expose structured React props, but Kairos must design for the ordinary student view;
- the unofficial library creates its own authenticated `requests.Session`, but Kairos will not copy that credential flow;
- the upstream parser has required maintenance when Gradescope changed its HTML, so parser breakage is an expected operational risk.

Kairos will use the project as a behavioral reference, not add Python or FastAPI to the application. The implementation should be native TypeScript in the existing Firefox extension.

## 3. Chosen architecture

Use the existing Kairos Firefox extension as a multi-source local bridge.

```
Kairos website
    |
    | strict normalized bridge messages
    v
Firefox extension background broker
    |
    +----------------------+----------------------+
    |                                             |
signed-in Canvas tab                         signed-in Gradescope tab
Canvas content script                       Gradescope content script
    |                                             |
same-origin Canvas reads                    same-origin Gradescope reads
    |                                             |
normalized Canvas data                      normalized Gradescope data
    +----------------------+----------------------+
                           |
                           v
                    Kairos local APIs
                           |
                           v
                       SQLite
```

Gradescope network requests run only inside a content script attached to `https://www.gradescope.com/*`, so they reuse the browser's current signed-in session.

The Gradescope content script may receive only server-issued source/course identifiers and may return only strictly validated normalized records. Raw HTML, cookies, response headers, authentication data, arbitrary URLs, and CSRF values must never cross the extension bridge.

## 4. Alternatives considered

### A. Same Kairos extension, new Gradescope content script — selected

Advantages:

- preserves the successful Canvas trust boundary;
- no new runtime or Python dependency;
- no credential collection;
- one extension installation and one website bridge;
- source-specific parsing stays isolated inside the authenticated origin;
- fits the current Firefox-first roadmap.

Cost:

- Gradescope's private HTML is inherently less stable than a public API, so extractor fixtures and diagnostics are required.

### B. Separate Gradescope extension

This would isolate permissions, but it duplicates the broker, popup, build, bridge, release process, and user installation flow. The isolation benefit is not large enough to justify the duplicated system.

### C. Local Python service using `gradescopeapi`

This maximizes direct reuse of the unofficial library, but it would add a second runtime and normally require Kairos to obtain or maintain a Gradescope login session itself. That conflicts with the current browser-session trust model and substantially worsens installation and maintenance.

## 5. Connection and course discovery

The Sources page replaces the current Gradescope future-source card with a real Gradescope connection card.

Initial state:

1. Explain that Kairos uses an already signed-in Gradescope Firefox tab.
2. Provide an "Open Gradescope" link for the user to sign in normally.
3. Provide a "Discover courses" action.

Discovery flow:

1. Kairos sends a strict `GRADESCOPE_DISCOVER_COURSES` request through the page bridge.
2. The background broker finds a tab matching `https://www.gradescope.com/*`.
3. The Gradescope content script requests same-origin `/account` with credentials included and redirects followed.
4. The content script validates that the final origin is Gradescope and that the request did not resolve to a login page.
5. It parses only the account's student-course section.
6. It returns normalized course records:
   - `courseId`;
   - `shortName`;
   - `fullName`;
   - `term` when available;
   - `year` when available.
7. Raw account-page HTML never leaves the Gradescope content script.

Kairos then shows the discovered courses and lets the user choose which student courses to enable. No course is synchronized until the user explicitly connects it.

The course selection is persisted locally. A later discovery can add newly visible courses without silently enabling them.

## 6. Gradescope assignment extraction

For each selected course, the extension fetches:

`/courses/:courseId`

The implementation ports the behavior needed from the unofficial library into a focused TypeScript extractor using `DOMParser`.

For each visible assignment row, extract:

- stable Gradescope assignment ID;
- title;
- release timestamp;
- normal due timestamp;
- late/hard due timestamp;
- exact trimmed student-facing status/grade text;
- numeric score when visibly published;
- numeric maximum score when visibly published;
- canonical source URL constructed from validated numeric IDs.

### 6.1 Assignment identity

A stable assignment ID may come from:

- the assignment anchor href; or
- the Gradescope submit button's assignment ID attribute.

Kairos must validate that discovered course and assignment IDs are decimal identifiers before using them.

If a visible row has no stable assignment ID, Kairos must not invent one from title/date text. The row is omitted from persistence and counted in a privacy-safe parse diagnostic.

### 6.2 Dates

Machine-readable `datetime` values are preferred over human-formatted text.

Persist independently:

- `releaseAt`;
- `dueAt`;
- `lateDueAt`.

The normal due date remains Kairos's deadline for Upcoming grouping. A late due date is additional source metadata; it must not silently replace the original deadline.

### 6.3 Grades

Published grades are represented without floating-point arithmetic.

Persist:

- `gradeScore`: decimal string or null;
- `gradeMax`: decimal string or null;
- `gradeDisplay`: normalized source display text or null.

A numeric grade visible to the student maps the normalized submission state to `graded`.

Kairos does not calculate percentages or letter grades unless a future feature explicitly requires them.

### 6.4 Submission-state normalization

Kairos preserves the exact source status text separately from the normalized state.

Normalization is intentionally conservative:

- visible numeric grade -> `graded`;
- explicit Gradescope "Submitted" state -> `submitted`;
- exact normalized source text `No Submission` or `Not Submitted` -> `not_submitted`;
- any other unrecognized status -> `unknown`.

If the real student UI uses another explicit no-submission phrase during manual smoke testing, add that phrase only with a regression fixture/test before changing the allowlist.

Kairos must never infer `not_submitted` merely because no grade is visible.

Gradescope does not need to synthesize a submission timestamp when the course page does not expose one; `submittedAt` remains null.

`isLate` and `isMissing` are set only when Gradescope explicitly exposes equivalent information in the parsed student view. They are not inferred solely from current time versus due date.

## 7. Extension protocol

Gradescope receives its own strict protocol module rather than being folded into the Canvas submission-status schema.

Proposed location:

`src/lib/extension-protocol/gradescope.ts`

Message families:

- `GRADESCOPE_DISCOVER_COURSES`
- `GRADESCOPE_DISCOVER_COURSES_RESULT`
- `GRADESCOPE_SYNC_ASSIGNMENTS`
- `GRADESCOPE_SYNC_ASSIGNMENTS_RESULT`

All schemas are strict Zod schemas.

Permitted request data is limited to:

- protocol version;
- request ID;
- server-issued Gradescope course IDs selected by the user.

Permitted result data is limited to normalized course/assignment fields and privacy-safe diagnostics.

Explicitly rejected bridge fields include:

- arbitrary URL;
- cookie;
- authorization header;
- CSRF token;
- HTML;
- response headers;
- raw response body.

Suggested operational limits:

- maximum 50 discovered courses in one discovery result;
- maximum 20 selected courses in one sync request;
- maximum 500 normalized assignments in one sync result.

If a user exceeds a limit, Kairos should split work into multiple requests rather than increase the trust boundary without bound.

## 8. Background broker and Firefox manifest

The extension adds Gradescope host access:

`https://www.gradescope.com/*`

It adds a Gradescope content script at `document_idle`.

The broker gains:

- `findGradescopeTab()`;
- `sendToGradescopeTab()`.

Canvas handling remains isolated and unchanged except for any small broker refactor required to dispatch multiple request families.

The extension must not request:

- cookies permission;
- history permission;
- downloads permission;
- `<all_urls>`;
- webRequest interception.

The browser itself owns the authenticated Gradescope session.

## 9. Local persistence

### 9.1 Source connection

Reuse `source_connections` with `kind = 'gradescope'`.

No Gradescope credential is stored in `source_credentials`.

### 9.2 Course selections

Add a generic local table so the selection model can later support Ed without coupling it to Gradescope:

```sql
source_courses (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL,
  external_course_id TEXT NOT NULL,
  short_name TEXT,
  full_name TEXT NOT NULL,
  term TEXT,
  year TEXT,
  enabled INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_connection_id, external_course_id)
)
```

Only enabled Gradescope courses participate in automatic or manual assignment sync.

### 9.3 Assignment source metadata

Extend the generic assignment record with nullable fields that are useful across future sources:

- `release_at`;
- `late_due_at`;
- `source_status_text`;
- `grade_score`;
- `grade_max`;
- `grade_display`.

Existing Canvas rows remain valid with null values for fields Canvas iCal does not provide.

The existing `assignment_submission_status` table remains the normalized submission-state store and becomes explicitly source-agnostic.

## 10. Synchronization flow

A Gradescope sync is a source sync: assignment metadata, submission state, and grade are refreshed together.

1. Kairos loads the enabled Gradescope course IDs.
2. It creates a short-lived request record binding:
   - request ID;
   - Gradescope source connection;
   - exact permitted course IDs.
3. The browser bridge sends only that validated set to the extension.
4. The content script fetches selected course pages with bounded concurrency.
5. Each course is parsed independently.
6. The extension returns normalized course results plus per-course errors.
7. The completion endpoint validates:
   - request ID;
   - expected source;
   - returned course IDs;
   - assignment/course identity format;
   - protocol limits.
8. Successful course results are normalized and upserted.
9. Submission-state and grade fields are updated only for successfully checked assignments.
10. Failed courses retain all previously known assignment/status/grade data.

A partial sync therefore never destroys known data.

Assignments that disappear from a later Gradescope response are not immediately deleted. Kairos records `last_seen_at`; archival/removal policy remains separate future work.

## 11. Freshness and refresh behavior

Mirror the successful Canvas status experience:

- manual "Sync Gradescope" is always available;
- when Gradescope is connected, Kairos automatically attempts one refresh when Gradescope data is at least 15 minutes stale and the relevant dashboard is opened;
- auto-refresh is enabled by default;
- a failed auto-refresh keeps the prior known data;
- total pre-check failure does not advance `last_successful_at`;
- a partial sync advances successful freshness only when at least one selected course was actually checked.

No periodic background alarm is introduced in Milestone 3.

## 12. UI behavior

### Sources

The Gradescope source card shows:

- extension availability;
- whether a Gradescope tab is detected;
- connection/discovery state;
- discovered student courses;
- per-course enable/disable controls;
- last attempted and successful sync;
- manual sync button;
- actionable signed-out/network/parse errors.

### Assignment surfaces

Gradescope assignments use the existing Gradescope source badge.

Display the following where space permits:

- submission-state badge;
- published score such as `8.5 / 10`;
- normal due date.

Assignment detail shows the complete source metadata:

- release date;
- due date;
- late due date;
- source status text;
- normalized status;
- score/max score;
- source link.

### Upcoming

The same resolved-work rule used for Canvas applies to Gradescope:

- Submitted;
- Graded;
- Excused, if ever returned

are excluded from Upcoming.

Unresolved/unknown work remains grouped by the normal `dueAt`.

### Calendar

Calendar uses the normal due date as the assignment event and retains the existing resolved-status color/line-through treatment.

The late due date remains visible in assignment detail rather than creating a second calendar event in Milestone 3, avoiding duplicated assignment tiles.

### All Assignments

Expose Gradescope-specific dates and grades through the existing table/detail flow. A score should be visible without requiring the user to open Gradescope.

## 13. Error model and diagnostics

Stable Gradescope-facing errors should include:

- `GRADESCOPE_TAB_UNAVAILABLE`;
- `GRADESCOPE_SIGNED_OUT`;
- `GRADESCOPE_NETWORK_ERROR`;
- `GRADESCOPE_COURSE_UNAVAILABLE`;
- `GRADESCOPE_PARSE_ERROR`;
- `PARTIAL_SYNC`;
- `INVALID_RESULT`;
- existing extension unavailable/timeout errors where applicable.

Privacy-safe diagnostics may include:

- fetch exception count;
- HTTP 429 count;
- HTTP 5xx count;
- other HTTP status count;
- unrecognized assignment-row count;
- missing-stable-ID count.

Diagnostics must never contain response bodies, HTML, cookies, tokens, headers, account email, or arbitrary URLs.

## 14. Parser resilience

Gradescope HTML changes are an expected maintenance event.

Mitigations:

- keep account parsing and assignment parsing in small source-specific modules;
- prefer semantic attributes/classes and machine-readable `datetime` values;
- validate final origins and identifiers;
- preserve unknown status text instead of guessing;
- use an extractor version string in persisted submission-state data;
- include synthetic HTML fixtures that represent every supported row shape;
- fail a row/course safely when required identity fields disappear;
- surface a specific parse error rather than reporting it as a generic network failure.

Do not couple parsing to unrelated instructor-only DOM.

## 15. Security and privacy invariants

The following are non-negotiable:

1. Kairos never asks for a Gradescope password.
2. Kairos never reads or exports the Gradescope session cookie through extension APIs.
3. Kairos never sends authenticated Gradescope HTML to the website/server layer.
4. Kairos never accepts arbitrary Gradescope URLs from the website.
5. Only the fixed `www.gradescope.com` origin is permitted.
6. Only validated source/course identifiers are accepted over the bridge.
7. The connector is read-only in Milestone 3: no uploads, resubmissions, extension edits, assignment edits, grade edits, or other Gradescope writes.
8. Failed sync never deletes prior known data.
9. Cross-source records remain independent.
10. Live authenticated Gradescope is used only for manual smoke testing, never CI.

## 16. Testing strategy

Implementation follows TDD.

### Parser tests

Synthetic, sanitized Gradescope HTML fixtures cover:

- student course discovery;
- submitted assignment;
- graded assignment with numeric score/max;
- explicit not-submitted state;
- unknown status;
- assignment link ID;
- submit-button assignment ID;
- release/due/late due dates;
- missing optional dates;
- malformed row with no stable ID;
- page-shape changes producing a parse error rather than unsafe fallback.

### Protocol tests

Verify:

- accepted normalized discovery/sync messages;
- strict identifier validation;
- message size limits;
- rejection of URL/cookie/header/HTML/token fields;
- request/result identity matching.

### Broker/content-script tests

Verify:

- tab detection;
- signed-out redirects;
- origin validation;
- bounded requests;
- partial course failure;
- HTTP diagnostics;
- no raw authenticated content leaving the content script.

### Persistence/sync tests

Verify:

- course selection persistence;
- idempotent assignment upsert;
- release/due/late date persistence;
- grade persistence;
- normalized submission state;
- prior data preserved on failure;
- stale results cannot overwrite newer data;
- partial success semantics.

### Component tests

Verify:

- source connection/course-selection UI;
- grade display;
- late deadline display;
- resolved Gradescope work removed from Upcoming;
- Calendar completion styling;
- error/status messaging.

### E2E

Use a mocked Firefox page bridge, parallel to the Canvas E2E pattern, and assert that bridge/API payloads contain no credential material or HTML.

### Manual smoke

Against a real signed-in Gradescope student tab:

- discover courses;
- connect selected courses;
- sync assignments;
- compare title/release/due/late due/status/grade against Gradescope;
- signed-out behavior;
- no-tab behavior;
- partial parser/network failure behavior.

## 17. Operational and product risks

### Private-web dependency

Gradescope may change its student HTML at any time. This can break parsing independently of Kairos releases. The design mitigates this with isolated extractors, fixtures, extractor versioning, and parse-specific diagnostics, but cannot eliminate the risk.

### Terms/policy

This connector relies on direct reads of the authenticated Gradescope web experience rather than a supported public API. That external policy risk is known and accepted as part of the chosen direction; the implementation remains deliberately read-only and local.

### Source conflicts

Canvas and Gradescope may disagree on due dates or status. Kairos preserves both source records and does not silently choose one as authoritative.

## 18. Milestone 3 completion criteria

Milestone 3 is complete only when:

- a signed-in Gradescope Firefox tab can be discovered without credential export;
- student courses can be discovered and selected;
- selected courses sync their visible assignments;
- release, due, late due, source status, normalized submission state, score, and max score persist locally;
- Gradescope records appear across Upcoming, Calendar, All Assignments, Sources, and assignment detail as designed;
- submitted/graded Gradescope work follows Kairos resolved-work behavior;
- prior known data survives failures;
- strict bridge privacy tests pass;
- parser/unit/integration/component/E2E suites pass;
- lint, typecheck, Firefox extension build, and production build pass;
- a real-browser manual smoke confirms the extractor against the user's signed-in Gradescope account.

## 19. Explicitly deferred

Not part of Milestone 3:

- uploading or resubmitting work;
- changing extensions/deadlines;
- modifying assignments;
- downloading submission files;
- instructor/TA workflows;
- automatic cross-source deduplication;
- background periodic alarms;
- Chromium support;
- cloud synchronization;
- supported-API migration work if Gradescope later publishes an API.
