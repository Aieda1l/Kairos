# Guest Free processing implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with fresh scoped implementers, task reviews and whole-branch ECC/security review. Root owns integration and operator actions.

**Goal:** Implement the approved browser parsing and two-call guest source design without changing normalized data, account-mode behavior or production activation.

**Architecture:** Keep guest bootstrap and the normalized client facade/storage at v1. Source wire v2 relays bounded provider bytes plus a signed, short-lived receipt; a foreground browser worker parses them, then an approval call rechecks the provider version before registry acceptance. Server handlers never normalize source bodies or retain a heavy guest fallback.

**Tech stack:** TypeScript, existing Zod/ICAL/date-fns-tz, Web Crypto, dedicated browser workers, existing D1 repositories, Vitest/Playwright/workerd. No new dependency, migration, deployed secret or billing configuration.

**Spec:** [Approved design](../specs/2026-11-12-guest-free-processing-design.md), approved by the user's “I approove, please proceed.” Original reviewed proposal SHA-256 `7b1b2fdfcfd932e18e2b1e4fbae7b5abf3dabf58ec8b8cd4faa392b61384bc74`.

## Global constraints

- Existing normalized DTOs, IndexedDB/backups/credentials format v1, source IDs, selections, merge/lease/generation/epoch/consumption fences and all data limits remain. Account-mode source interfaces and semantics remain unchanged.
- Fifteen seconds covers relay, body consumption, browser parsing and approval together; the 180-second run fence remains. Cancellation terminates/ignores parser work. No new service worker, durable job or tab-close completion.
- Raw bodies may contain private fields/reflected credentials. They stay out of app persistence, snapshots, exports, caches, DOM, diagnostics and error messages; user-managed developer tools and physical RAM erasure are not controlled by the app.
- Server keeps feature/Host/Origin/capability/network/admission/redirect/provider/deadline checks. Legacy heavy guest requests reject cheaply before provider/parser/admission work. No arbitrary proxy, source fanout or local assignment rows sent to approval.
- Approval validates capability/receipt/correlation/expiry before D1; consumes exactly one claim from the SAME read-global 60/600-second pool before its one provider lookup. Invalid/expired receipts access no D1; admitted replays consume again. No new network/session claim or nonce table. Two global slots per complete read; aggregate capacity 30/600, existing per-session30/network60 unchanged.
- Receipt approval is a session/version/time check, not data attestation or commit-wide revocation. No new purpose changes existing capability/rate/auth derivation vectors.
- No source/config change enables production guests. No cloud test/deployment/provider/billing/maintenance actions are included; the consumed v3 packet stays retired. All worktrees, ignored evidence and dependency junctions remain.
- Preserve original `next-env.d.ts` bytes (SHA-256539B8EFF936DCF0CB92EEECD475BFE28B068121F71631ABD0A614B9C7707D6E4). Root serializes builds/browser/type generation to avoid `.next/types` races.

## Fixed cross-task interfaces

Task 2 owns `src/lib/guest/sources/wire.ts`. Other tasks may use its types before it is implemented, but must not edit it. It is lightweight and imports no normalized parser, server runtime or account/auth module.

```ts
type GuestSourceOperation = 'canvas-feed'|'ed-courses'|'ed-lessons';
type GuestParseContext = {requestId:string;checkedAt:string} & (
  {operation:'canvas-feed'|'ed-courses';courseId?:never} |
  {operation:'ed-lessons';courseId:string}
);
type GuestSourceParseInput = GuestParseContext & {bytes:ArrayBuffer};
// Normalized result is the existing Canvas/Ed response union, schemaVersion:1.
```

- Wire source inputs use the existing fields with `schemaVersion:2`. Public normalized request types remain v1 at the client facade; the client validates them before constructing strict v2 wire inputs.
- Success response: `Content-Type: application/octet-stream`, `Cache-Control: no-store, private`, `x-kairos-guest-source-version: 2`, `x-kairos-guest-read-receipt: <token>`. Do not forward upstream headers. Actual body limit is 2 MiB.
- Receipt token is canonical unpadded base64url UTF-8 JSON plus dot plus 32-byte HMAC, at most 2048 characters. Strict claims: `{v:2,aud,sessionTag,operation,requestId,checkedAt,issuedAtMs,deadlineAtMs,providerVersion,courseId}`. `courseId` is null except lessons. `checkedAt` is the ISO representation of issuedAtMs; duration is positive and at most15000ms, and expiry is no later than capability expiry or remaining original handler deadline. Integers must be safe/nonnegative.
- New derived key purpose: `guest-read-approval`. Session tag uses HMAC over JSON `["kairos:guest-read-session:v2",capability.sid]`; receipt signature over JSON `["kairos:guest-read-receipt:v2",encodedPayload]`. No raw capability SID or source credential/URL is returned. Use native Web Crypto sign/verify, canonical encoding and constant bounded checks.
- `POST /api/guest/sources/approve`: strict JSON `{schemaVersion:2,requestId,receipt}` within16KiB. Success strict JSON `{ok:true,schemaVersion:2,requestId,checkedAt,operation,courseId}`. Missing/expired capability remains401; invalid/tampered/wrong-session/correlation receipt is400 BAD_REQUEST; valid expired operation returns existing source timeout code (`NETWORK_ERROR` or `ED_NETWORK_ERROR`). Disabled/changed provider is503; budget denial existing429/Retry-After. Check deadline again after budget/provider awaits. No automatic approval retry/renewal.
- Portable metadata decoder `readGuestReadReceiptMetadata(token)` validates schema/canonical encoding only; it does NOT authenticate the receipt. Server authenticates before D1. Client matches operation/requestId/course against the original call before parsing and again after approval, without manufacturing correlation fields.
- Task1 exports `parseGuestSourceBytes(input, options?:{signal?:AbortSignal;check?:()=>void}):Promise<GuestCanvasFeedResponse|GuestEdCoursesResponse|GuestEdLessonsResponse>` from `sources/parse.ts`. It imports wire types only. No credential input goes to the parser. It throws existing portable `GuestSourceError` safe codes; signal abort is `GUEST_INTERRUPTED`, caller check can enforce remaining time.
- Task3 exports browser `parseGuestSourceInWorker(input,signal,localDeadlineAtMs)` and wires it into `createGuestTransientClient` with a local test injection seam. The client API signatures/result schemas stay unchanged. Worker job IDs are separate from source request IDs; raw ArrayBuffers are transferred where possible. No heavy server fallback on unsupported Worker.

## Review focus

1. Entire-result IDs/dates/order/partial/duplicate/byte limits match, including Canvas SHA-256 and UTC-floating behavior across browser timezones; account behavior unchanged (Task1).
2. Origin/capability/signed receipt and exact shared-global admission precede provider check; late awaits cannot extend expiry or dispatch another read (Task2).
3. Cancel/Stop/reset/import/replacement/session/lease changes reject worker and approval completions before storage; raw content never persists (Task3).
4. All physical HTTP calls, raw byte limits, client-derived normalization and approval are honestly recorded in diagnostics; no synthesized HTTP response or hidden call count (Task4).
5. Mixed client versions fail safely; old heavy route cannot still be called on Free, and worker assets load under existing CSP in both builds (Tasks2–4).

## Task 1 — Portable parsing with frozen compatibility vectors

**Ownership:** `src/lib/sources/canvas-ical/parser.ts`; new `parser-core.ts` alongside it; new `src/lib/guest/sources/parse.ts`; new `tests/unit/guest-portable-parser.test.ts`; new `tests/helpers/guest-parser-cases.*` and `guest-parser-golden.json`; new `scripts/verify-browser-guest-parsers.mjs`. Existing other account/source tests are read-only unless a concrete fixture expectation needs root coordination.

- [ ] Capture small explicit normalized vectors and large-fixture digests BEFORE edits from the immutable reference build `artifacts/guest-hosted/build-response-validation-20261112-01/source` (app4398646, same runtime as base). Record exact reference hashes and UTC runtime. All data is synthetic. Commit small fixed golden expectations; CI must NOT require ignored artifacts or historic Git commits.
- [ ] Add meaningful RED compatibility/browser-portability tests before implementation. Preserve the source grammar and error classes, exact fallback SHA-256 bytes and lower-case hex prefix, Los Angeles all-day23:59 and frozen hosted-UTC floating/unknown-TZID/DTSTAMP behavior. No silent VTIMEZONE improvement. Include Unicode/folding, malformed sibling, empty/all-malformed, duplicated identities and private-link sanitation.
- [ ] Extract a pure Canvas core and keep synchronous Node/account wrapper behavior. Browser adapter uses asynchronous Web Crypto with explicit guest-UTC floating conversion. Reuse Ed parsing/projection and retain unsafe-number/raw-count/visibility/membership guards and UTC-schema validation.
- [ ] Implement whole-result byte/count/schema/duplicate checks after bounded UTF-8 decode. Abort/check before and after expensive/async steps; never truncate. Return the current validated DTO only, no intermediates.
- [ ] Add a standalone real Chromium/Firefox parity verifier serving only fixed synthetic fixtures/bundled actual parser over an owned loopback server; no app dev server, browser globals changed outside contexts or credential/provider access. Test UTC/Los Angeles/Asia-Kolkata with fixed golden results. Browser build must fail on Node/server-only imports (no stubs); baseline-only Node golden generation may stub server-only.
- [ ] Focused unit/account parser tests and browser parity pass. Write report/logs; root obtains independent task review and commits only owned files.

## Task 2 — Lightweight relay, receipt and approval server

**Ownership:** new `src/lib/guest/sources/wire.ts`; `src/lib/guest/server/source-handler.ts`; new `server/read-receipt.ts`, `server/source-approval.ts`, `server/source-relay.ts`; `server/policy.ts`; `src/lib/abuse/keys.ts`; `src/lib/http/bounded-body.ts` (add bytes reader without changing existing UTF-8 behavior); new approve route; existing three source routes only if needed. Tests: `tests/integration/guest-source-api.test.ts`, new `guest-source-approval.test.ts`; new `tests/unit/guest-read-receipt.test.ts`, `guest-source-wire.test.ts`; `tests/unit/bounded-body.test.ts` and `guest-admission.test.ts` for added behavior. Do not edit public normalized contracts, parser/client files or existing cap-signing implementation.

- [ ] RED v2 read/approval behavior, v1 cheap rejection and invalid capability/receipt zero-SQL/provider assertions before implementation. Keep disabled flag before runtime creation; direct handlers retain source-specific transport error mapping and no-store headers.
- [ ] Implement wire types/schemas/headers/metadata decoder exactly above. Add only the new key purpose; existing vectors remain unchanged.
- [ ] Implement bounded bytes relay with original deadline, status/redirect/provider fences and no normalization/parser import. Mint receipt with only remaining original time and capability expiry. Internal config corruption maps to fixed infrastructure error.
- [ ] Implement approval with structural/signature/session/correlation/expiry validation before D1, exact shared-global claim, then one current-provider lookup and final clock check. Validate ingress/network even though no additional network claim is charged. No provider fetch, nonce, receipt persistence or credential reflection.
- [ ] Prove tamper/canonical encoding/wrong audience/session/request/course, future/expired clocks, late budget/lookup resolution, pause/re-enable, replay/global-budget sharing, no heavy-v1 fallback, no account SQL and cancellation. Extend byte-reader tests including stalled cancel/lying content-length.
- [ ] Focused server/capability/admission/body tests pass; report inputs/actual RED/GREEN. Root independent review/commit.

Tasks1 and2 are independent after these interfaces are frozen and may run concurrently. Only type imports cross the boundary until both are ready; root runs type generation/builds after both complete.

## Task 3 — Foreground parser worker and unchanged client facade

**Ownership:** `src/lib/guest/sync/transient-client.ts`; new `sync/source-parser-worker.ts`, `sources/source-parser.worker.ts`; worker message types if needed; `tests/component/guest-transient-client.test.tsx`; new `tests/unit/guest-parser-worker.test.ts`; affected guest E2E files and `tests/e2e/fixtures/guest-session.ts`; actual guest privacy copy with root-coordinated exact file; Playwright testMatch only for added cases. Do not edit store/registry/merge algorithms or server/parser internals without root coordination.

- [ ] RED two-call protocol, body/header/correlation bounds, error handling and asynchronous worker cancellation/stale results before implementation. Keep bootstrap/end behavior and source method signatures.
- [ ] Validate existing v1 input then construct v2 wire JSON; consume bounded raw bytes and canonical metadata, match correlation first, transfer only context/bytes to a dedicated worker. Validate strict normalized result, approve receipt, match ack, then resolve for existing registry acceptance.
- [ ] One source clock/signal across all stages. Before each fetch/job and after each await check clock/signal; timeout maps to source network code, explicit abort to interruption. No approval retry/renewal; no worker error/raw text leaks. Terminate/deregister on success/error/cancel/creation failure. Per-job IDs reject wrong/duplicate messages.
- [ ] Add real worker/browser tests in Chromium/Firefox including wrong body, no Worker, expiry, Stop, reset/import, disconnect/replacement, lease takeover and session change. Preserve current source/onboarding/status/reload/backup/account-separation E2E behavior; update v1 mocked responses into v2 fixtures without bypassing approval. Raw-reflection marker must be absent from DOM/public storage/export/diagnostics.
- [ ] Update plain-language privacy disclosure consistently with the approved memory boundary; retain explicit remember choice and tab-close limitations. Both Next and Vinext worker assets load under existing CSP; no relaxed eval/blob policy.
- [ ] Focused component/unit and affected browser tests pass; root independent review/commit.

## Task 4 — Honest diagnostics, integrated verification and release handoff

**Ownership:** source-native/hosted scripts and declarations under `scripts/lib/guest-hosted-*`, native guest verifier/fixtures, local source measurement tool, relevant diagnostic tests, production/secret boundary checks, CI steps if adding parity command, deployment docs. Root assigns a fresh worker after Tasks1–3 and freezes exact file set. No account/private credentials or live cloud actions.

- [ ] Adapt actual wire validation for raw responses and approval, bundle the actual portable parser from verified retained source and identify that Node-simulated client separately from browser proof. Count all22 physical requests in the analogous complete baseline; report both-call status/headers and projection provenance, never fabricate an HTTP normalized response. No hidden/retried calls. Expected fixture reads10, anonymous admission rows37 (subject to actual native proof), protected21/owned22 unchanged.
- [ ] Update route/schema/file inventories and exact computed-module pins only with matching code/hash evidence; do not weaken H1/H2 immutability, egress/observability/header/cookie/cancellation or unknown-table checks. Preserve failed historical runs and null/reason metric limits.
- [ ] Prove raw/approval/parse failures and global-pool denial do not accept partial datasets. Preserve accepted v1 backup/storage compatibility and account/source/calendar regression coverage. Update local measurements to measure the actual new pipeline with truthful CPU-location labels.
- [ ] Root runs full units, lint/types, both builds, affected/full browser checks and sealed native/retention/provider/safety graph appropriate to changed inputs. Recheck key vectors, exposure patterns, worker assets, exact frozen package/provenance and rollback compatibility. No old source receipt is promoted.
- [ ] Whole-branch independent ECC/security review, fix/re-review, publish PR and require normal CI before merge. Prepare a fresh finite22-request hosted measurement packet and owned cleanup for separate authorization. Guest-off release/activation, retention/cadence and real-provider acceptance remain their existing separate gates.

## Definition of this increment's completion

The approved implementation is complete when the foreground worker/client, lightweight server protocol and diagnostics are integrated, actual regressions and required CI/reviews pass, and the reviewed branch is merged. This does not claim 10ms hosted feasibility, production deployment, scheduled maintenance, physical retention or guest activation. Those require the remaining release evidence and explicit operator decisions.
