# Hybrid Local Guest Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people use Kairos without a Kairos account, retaining coursework locally and syncing live Canvas, Gradescope and Ed through the approved hybrid boundary.

**Architecture:** A separate public guest composition reads a versioned IndexedDB store. Canvas feeds/Ed use bounded anonymous server reads with an anti-abuse capability; Canvas statuses/Gradescope use the existing Firefox bridge directly. No guest coursework or credentials enter account repositories or hosted operation ownership.

**Tech Stack:** Existing TypeScript, React/vinext, Zod, IndexedDB, Web Crypto, D1 admission metadata, Vitest and Playwright Chromium/Firefox. No new dependency is required; native browser tests verify IndexedDB rather than substituting a JavaScript database implementation.

**Spec:** [Approved hybrid guest design](../specs/2026-10-24-hybrid-local-guest-mode-design.md).

**Status:** Implementation plan proposed for review; design approved by the user on 2026-10-24. Execution method/review checkpoint is pending. No product implementation or deployment is claimed.

## Global Constraints

- No Kairos account, Auth.js session or synthetic user row is required for guest use. Existing account auth/tenancy behavior stays intact.
- `KAIROS_GUEST_ENABLED` is exactly `true` to enable guest entry/transport; base and production defaults are `false`.
- Live Canvas, Gradescope and Ed are first-release requirements. Calendar publishing, cold-start offline/PWA, cross-device sync and account transfer are deferred.
- Credentials are memory-only by default; remembering is explicit device storage. Backup files contain no credentials, capability, lease or pending request.
- Server source reads accept at most 16,384 request bytes, 1–4096-character secrets and a decimal course ID of at most 32 characters; each has one 15-second whole-operation deadline.
- Canvas/Ed upstream bodies are at most 2 MiB. Canvas: 5,000 event blocks/2,000 assignments/2 MiB output. Ed: 500 discovered courses/512 KiB output, or one course with 2,000 raw/1,000 visible lessons/2 MiB output.
- Local limits: 10,000 assignments/statuses, 1,000 courses, 8 MiB noncredential dataset and 10 MiB import. Reject bounds atomically; never truncate into apparent success.
- Local lease: 30 seconds, renew every 5 seconds. Run: 180 seconds, at most 100 dispatched operations. Canvas batches at most 25; Gradescope one course per batch. Legacy extension waits are 30 seconds and are not upstream cancellation.
- Guest capability: 30 minutes; `__Host-kairos-guest-sync`, Secure/HttpOnly/SameSite=Strict/Path=/, no Domain. Separate loopback-only development cookie.
- Guest budgets per 600 seconds: bootstrap/network 10; reads/session 30, reads/network 60, reads/global 60. Existing account policies and HMAC derivation vectors remain compatible.
- Only anonymous admission hashes/timestamps may be written in D1. No account/source/credential/coursework/draft/OAuth/bridge/operation-owner writes, production actions, billing changes or new extension permissions.

## Review Focus

1. A late read after reset, source replacement or cross-tab lease takeover must not resurrect data or release the new owner's lease — F3, U1/U2, A1.
2. A schema-valid response with unrequested/duplicate assignment or course identities must not commit — F2, U1/U2.
3. A signed-in visitor using guest mode in the same browser must not silently upload, render or clear the account's data, or vice versa — F4, A2.
4. Missing Content-Length, a stalled body or expensive near-cap parsing must not bypass the stream/deadline/output bounds or be mislabeled as Free CPU proof — S1/S4, A3.
5. Globally denied traffic and distributed bootstrap still consume earlier D1/Siteverify work; their costs and physical cleanup must be measured before activation — S2/S4, A3.

## Independently testable parts and dependency order

| Part | Deliverable | Dependency |
| --- | --- | --- |
| [1. Local foundation](2026-10-24-hybrid-guest-1-local-foundation.md) | Strict domain/DTO contracts, merge/backup rules, real IndexedDB storage and account-free views | F1 first; remaining local work can run beside Part 2 |
| [2. Anonymous transport](2026-10-24-hybrid-guest-2-anonymous-transport.md) | Default-off protected guest endpoints and sealed native source/abuse verification | F1 contracts; no React/store implementation dependency |
| [3. Live orchestration and UI](2026-10-24-hybrid-guest-3-live-orchestration.md) | All agreed live sources, current-run outcomes, remembered-secret controls and backup/reset UX | Parts 1 and 2 interfaces |
| [4. Acceptance and release evidence](2026-10-24-hybrid-guest-4-acceptance.md) | Complete guest/account/lifecycle regression and honest capacity/readiness evidence | Parts 1–3 |

This split does not reduce first-release scope. Intermediate parts remain behind the flag; a store-only or fixture-only slice is not the finished guest feature. Each task has a RED/GREEN cycle and commit; use one integration branch rather than a production deployment per task.

## Canonical cross-part interfaces

Task F1 owns these browser-safe contracts in `src/lib/guest/types.ts`, `schema.ts`, `errors.ts` and `sources/contracts.ts`. Later tasks consume them; do not invent parallel spellings/shapes. Existing `Assignment`, `AssignmentSubmissionStatus`, `SourceCourse`, `DiscoveredSourceCourse` and `NormalizedAssignment` remain the underlying domain types.

```ts
type GuestStage = "canvas-feed" | "canvas-status" | "gradescope" | "ed";
type GuestOperation = GuestStage | "gradescope-discovery" | "ed-courses";
type GuestOutcomeStatus = "success" | "partial" | "failed" | "skipped" | "timed-out" | "cancelled";
type GuestAssignmentRecord = Omit<Assignment,"submissionStatus"> & {
  sourceConnectionId:string; metadataCheckedAt:string|null;
};
type GuestStatusRecord = AssignmentSubmissionStatus & {assignmentId:string};
type GuestConnection = {
  id:string;kind:SourceKind;enabled:boolean;generation:number;
  createdAt:string;updatedAt:string;
};
type GuestPreferences = {
  timeZone:string;filters:FilterState;sort:"due"|"status";
  automaticCanvas:boolean;automaticGradescope:boolean;
};
type GuestSyncState = {
  sourceConnectionId:string;stage:GuestStage;lastAttemptedAt:string|null;
  lastSuccessfulAt:string|null;lastErrorCode:GuestSafeCode|null;
  updatedCount:number;failedCount:number;resumeKeys:string[];
};
type GuestSnapshot = {
  schemaVersion:1;datasetId:string;revision:number;
  connections:GuestConnection[];courses:SourceCourse[];
  assignments:GuestAssignmentRecord[];statuses:GuestStatusRecord[];
  syncStates:GuestSyncState[];preferences:GuestPreferences;
};
type GuestRunIdentity = {datasetId:string;runId:string;pageEpoch:string;generation:number};
type GuestRunLease = GuestRunIdentity & {
  startedAtMs:number;deadlineAtMs:number;leaseExpiresAtMs:number;
};
type GuestRequestFence = GuestRunIdentity & {
  requestId:string;operation:GuestOperation;source:SourceKind;
  // setup only: null means the transaction must still find no connection of that kind.
  purpose:"setup"|"read";connectionId:string|null;connectionGeneration:number|null;
  deadlineAtMs:number;
};
type GuestRegisteredRequest = {
  fence:GuestRequestFence;
  members:{canvas:CanvasAssignmentLocator[];courseIds:string[]};
};
type GuestStageOutcome = {
  runId:string;stage:GuestStage;status:GuestOutcomeStatus;
  code:GuestSafeCode|null;updatedCount:number;failedCount:number;ignoredCount:number;pendingCount:number;
  attemptedAt:string;completedAt:string;
};
type GuestRunReport = {run:GuestRunIdentity;mode:"manual"|"automatic";outcomes:GuestStageOutcome[]};
type GuestClock = {
  now:()=>number;
  setTimeout:(callback:()=>void,delayMs:number)=>unknown;
  clearTimeout:(handle:unknown)=>void;
};
type GuestCommitResult =
  |{status:"accepted";snapshot:GuestSnapshot;updatedCount:number;ignoredCount:number}
  |{status:"discarded";reason:"superseded"|"expired"|"disconnected"|"consumed"};
```

`GuestSafeCode` is a closed union: approved guest API codes, existing Canvas/Gradescope protocol error enums, and local `GUEST_BUSY`, `GUEST_SUPERSEDED`, `GUEST_STORAGE_UNAVAILABLE`, `GUEST_STORAGE_LIMIT`, `GUEST_CREDENTIAL_REQUIRED`, `GUEST_NOT_CONNECTED`, `GUEST_NO_COURSES`, `GUEST_NO_ASSIGNMENTS`, `GUEST_RUN_TIMEOUT`, `GUEST_RUN_LIMIT`, `GUEST_INTERRUPTED`, `INVALID_BACKUP`, `UNSUPPORTED_BACKUP_VERSION`. Fixed message mapping must not display thrown/source messages.

F1 also defines discriminated `GuestCommitChanges`: `connect` (new connection, discovered courses, initial Canvas rows if present, and `GuestSecretChoice|null`), `credential` (validated explicit same-source re-entry choice), `course-result` (`GuestCourseResult`) and `stage-result` (current outcome/freshness plus remaining queue keys). `GuestSecretChoice={value:string;remember:boolean}` never enters a snapshot or pending-request record. Setup can create a source only through a live registered `purpose:"setup"` request whose expected kind remains absent; ordinary reads never recreate a missing connection. A read fence requires nonnull connection ID/generation. All members and references are validated before mutation.

F1 source DTO exports are `guestCanvasFeedRequestSchema`, `guestEdCoursesRequestSchema`, `guestEdLessonsRequestSchema` and corresponding `*ResponseSchema` names. All source requests carry version 1/requestId plus exactly the spec's credential/resource fields. Success carries `ok:true`, schemaVersion/requestId/checkedAt and normalized assignments+report, courses, or lessons+courseId respectively. Canvas rows use `NormalizedAssignment & {source:"canvas"}`; Ed lessons use `Omit<NormalizedAssignment,"courseName"> & {source:"ed";courseId:string}`, with the browser attaching the saved course name. Export matching inferred TypeScript request/response types and a strict fixed-code `GuestApiError` schema.

The same browser-safe contract file exports `guestSessionRequestSchema`/`GuestSessionRequest` for `{schemaVersion:1,requestId,turnstileToken}` and `guestSessionResponseSchema` for `{ok:true,schemaVersion:1,requestId,checkedAt,expiresAt}`. Session end accepts a strict empty object. API errors use the spec's fixed source codes plus `GUEST_DISABLED`, `GUEST_SESSION_REQUIRED`, `GUEST_CHALLENGE_FAILED`, `GUEST_CHALLENGE_UNAVAILABLE`, `BAD_REQUEST`, `UNSUPPORTED_MEDIA_TYPE`, `UNTRUSTED_ORIGIN`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` and `SOURCE_RESULT_TOO_LARGE`; no arbitrary string error enters a public response.

F3 implements this `GuestStore` port; methods run synchronously within their IDB transaction callbacks, with no network waits inside transactions:

```ts
interface GuestStore {
  read():Promise<GuestSnapshot>;
  subscribe(listener:()=>void):()=>void;
  savePreferences(patch:Partial<GuestPreferences>,datasetId:string):Promise<GuestSnapshot>;
  setEnabledCourses(connectionId:string,ids:string[],generation:number):Promise<GuestSnapshot>;
  beginRun(input:{pageEpoch:string;nowMs:number;deadlineAtMs:number}):Promise<GuestRunLease|null>;
  renewRun(run:GuestRunIdentity,nowMs:number):Promise<GuestRunLease|null>;
  releaseRun(run:GuestRunIdentity):Promise<void>;
  registerRequest(request:GuestRegisteredRequest,nowMs:number):Promise<boolean>;
  markStageAttempt(run:GuestRunIdentity,connectionId:string,generation:number,stage:GuestStage,at:string):Promise<boolean>;
  invalidateRun(run:GuestRunIdentity):Promise<void>;
  commit(request:GuestRequestFence,changes:GuestCommitChanges,nowMs:number):Promise<GuestCommitResult>;
  readRememberedSecret(connectionId:string):Promise<string|null>;
  forgetCredential(connectionId:string,generation:number):Promise<GuestSnapshot>;
  disconnect(connectionId:string,generation:number):Promise<GuestSnapshot>;
  replaceDataset(backup:GuestBackupV1,datasetId:string):Promise<GuestSnapshot>;
  clear(datasetId:string):Promise<GuestSnapshot>;
  close():void;
}
```

F2 owns `GuestBackupV1={schemaVersion:1,exportedAt:string,data:{connections,courses,assignments,statuses,syncStates,preferences}}` with the same noncredential record types as the snapshot; no dataset identity/revision/run/lease/requests/secret. `GuestCourseResult` is `{sourceConnectionId,connectionGeneration,stage,externalCourseId:string|null,checkedAt,assignments:NormalizedAssignment[],statuses:GuestStatusInput[],courseSucceeded:boolean,failedCount,code:GuestSafeCode|null,remainingKeys:string[]}`. `GuestStatusInput=AssignmentSubmissionStatus & {externalId:string;errorCode:GuestSafeCode|null}` maps to local assignment IDs only after per-connection identity validation/merge. Remaining/resume keys identify not-yet-dispatched members (external assignment IDs for Canvas status, external course IDs for Gradescope/Ed), not in-flight requests; validate them against current source membership and put them first on the next explicit run so limits cannot permanently starve later courses. U2 owns the in-memory credential vault; remembered secrets use the store's separate internal credential record, never `GuestSnapshot`.

The coordinator uses `GuestClock`, a fresh UUID factory and the store; current run outcomes separately report pending, failed and ignored members. Never count unprocessed queue members as successful or silently omit them from the visible result.

Credential re-entry after a memory-only reload is not source replacement: the user explicitly selects use for the same source, a bounded read validates the new value, and a `credential` commit preserves coursework/course selection while advancing connection generation and changing only secret/setup metadata. Switching provider identity still requires the approved disconnect/replacement flow. Forgetting a secret clears memory/remembered storage and advances generation without deleting coursework.

## Verification, evidence and handoff

Run each task's focused checks once after its changes. Broaden to the existing suite/build/native/browser gates at integration points or for a new failure, not repeatedly without a new reason. Store RED/GREEN logs and capacity receipts in ignored `artifacts/guest-mode-implementation/`; no real secrets/coursework enter fixtures.

- [ ] F1–F4 complete and independently testable.
- [ ] S1–S4 complete and independently testable.
- [ ] U1–U4 complete with all agreed live sources.
- [ ] A1–A3 complete; source/hosted regressions and readiness limits recorded.
- [ ] Execution method and plan review recorded before product code.

Self-review coverage: spec §§1–4 → F4/U3; §§5–6 → F1–F3/U4; §7 → F1/S1–S3; §8 → S2–S4/A3; §9 → F3/U1–U3/A1; §10 → F2/U4/A2; §§11–13 → S4/A1–A3. All five Review Focus items have owning tests below. Interface names/status literals are fixed above and referenced by all parts.
