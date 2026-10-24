# Hybrid Guest Anonymous Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver bounded account-free Canvas/Ed reads protected by a short-lived anti-abuse capability, with no saved server coursework/credentials.

**Architecture:** New guest-only boundaries use fixed-source response transports and the existing D1 anonymous rate-event table. Hosted services/ownership are not guest entrypoints; their signatures and behavior remain intact.

**Tech Stack:** Existing TypeScript/Zod/Web Crypto, native fetch/streams, D1, Vitest and sealed workerd fixtures.

**Spec:** [Approved design](../specs/2026-10-24-hybrid-local-guest-mode-design.md). **Contracts:** [Parent plan](2026-10-24-hybrid-local-guest-mode.md), F1 first.

## Global Constraints

- No account/session/source/credential/assignment/draft/OAuth/bridge/owner rows; only HMAC admission events with `user_id:null` may be written.
- Exact Canvas origin `https://canvas.uw.edu`; Ed fixed `https://us.edstem.org/api/` resources; no caller-selected headers or arbitrary proxy.
- 16,384 request bytes, 4096-character secrets, 32-digit course IDs; one 15-second deadline through fetch/body/normalization; all parent byte/item/output caps apply.
- Capability 30 minutes; host-only Secure/HttpOnly/Strict cookie; new purpose-separated `guest-capability` subkey, existing account derivation unchanged.
- Budgets/600 seconds: bootstrap network 10; read network 60/session 30/global 60. Guest-global is not a ceiling on earlier D1 charges or distributed bootstrap costs.

## Review Focus

Stalled streams, denial-side costs, alternate ports/redirects, capability-purpose confusion and accidentally entering account ownership need explicit tests. Native elapsed/Node parser CPU must never be labeled deployed Workers CPU.

### S1: Extract response transports and add bounded guest readers

**Files:** Create `src/lib/http/bounded-body.ts`, `src/lib/guest/sources/{limits,deadline,errors,canvas,ed}.ts`, `src/lib/sources/canvas-ical/transport.ts`, `src/lib/sources/ed/transport.ts`, `tests/helpers/guest-source-fixtures.ts`; modify existing Canvas `fetch-feed.ts` and Ed `client.ts` only to delegate transport; test `tests/unit/{bounded-body,guest-canvas,guest-ed}.test.ts` plus existing `canvas-fetch-feed.test.ts`, `ed-client.test.ts`.

**Interfaces:** `readBoundedUtf8(stream, {maxBytes,signal}):Promise<string>` and `readBoundedJson(...):Promise<unknown>` throw `BoundedBodyError` with code `BODY_TOO_LARGE | INVALID_UTF8 | INVALID_JSON | BODY_ABORTED`. `fetchCanvasFeedResponse(url:URL,fetchImpl:typeof fetch,signal:AbortSignal):Promise<Response>` and `fetchEdResponse(token:string,resource:{kind:"user"}|{kind:"lessons";courseId:string},fetchImpl:typeof fetch,signal:AbortSignal):Promise<Response>`. These response transports enforce URL/header/redirect behavior but leave final HTTP status/error mapping and body consumption in their hosted or guest caller. Guest `readGuestCanvas(input,context)`, `readGuestEdCourses(input,context)`, `readGuestEdLessons(input,context)` consume F1 request types and return F1 normalized success DTOs. `context={fetchImpl,requestId,checkedAt,signal,assertProviderCurrent:()=>Promise<void>}`; its injected fetch wrapper checks the provider before each actual dispatch/redirect.

- [ ] **Step 1 — Write RED reader/source tests.** Assert exact byte limit succeeds/one byte over fails, split multibyte UTF-8 decodes, invalid UTF-8/JSON fails, missing/lying Content-Length is irrelevant, stalled `reader.read()` aborts, and cancellation cleanup cannot hang. Assert Canvas 5,001 events/2,001 assignments and Ed 501 courses/1,001 visible lessons fail without truncation; 150-course discovery fixture remains valid. Pin no alternate Canvas port, redirect escape or Ed redirect/token forwarding; normalized output excludes raw profile/secret fields structurally.
  Core assertions for `guest readers enforce actual streamed bytes and whole-operation abort`:
  ```ts
  await expect(readBoundedUtf8(fiveBytes,{maxBytes:4,signal})).rejects.toMatchObject({code:"BODY_TOO_LARGE"});
  await expect(stalledReadAfterAbort).rejects.toMatchObject({code:"BODY_ABORTED"});
  expect(edRequests).toHaveLength(1);
  expect(canvasRequests.length).toBeLessThanOrEqual(6);
  ```
- [ ] **Step 2 — Verify RED.** `npm test -- tests/unit/bounded-body.test.ts tests/unit/guest-canvas.test.ts tests/unit/guest-ed.test.ts` must fail on the missing limits/behavior.
- [ ] **Step 3 — Implement bounded transport.** Preserve `fetchCanvasFeed(url,fetchImpl?)`, `EdApiClient` constructor/methods and existing hosted HTTP/error behavior. Guest consumers alone choose streamed bounds. Use existing server parsers/Node SHA-256; no browser parser rewrite. Share the 15-second signal across redirects/body, check before/after synchronous parse, cap raw collections before expensive loops and output before returning. Check provider state before every dispatch/Canvas redirect and before result publication. Never await body cancellation indefinitely.
- [ ] **Step 4 — Verify GREEN.** Repeat focused tests plus `npm test -- tests/unit/canvas-fetch-feed.test.ts tests/unit/ed-client.test.ts tests/integration/hosted-source-boundary.test.ts` and `npm run typecheck`.
- [ ] **Step 5 — Commit.** Stage S1 files only; commit `feat: add bounded guest source transports`.

### S2: Add guest capability, anonymous policy and session endpoints

**Files:** Create `src/lib/guest/server/{types,policy,capability,runtime,request,json,session}.ts`, `src/app/api/guest/session/route.ts`, `src/app/api/guest/session/end/route.ts`; extend explicit subkey purpose in `src/lib/abuse/keys.ts`; test `tests/unit/guest-capability.test.ts`, `guest-admission.test.ts`, `tests/integration/guest-session-api.test.ts`. No migration or account budget-policy edit.

**Interfaces:** `GuestServerRuntime=AbuseRuntime & {guestEnabled:boolean;guestPolicy:GuestPolicy;now:()=>number}`; `resolveGuestServerRuntime(env:Record<string,unknown>,fetchImpl?:typeof fetch):GuestServerRuntime`, server-only `getGuestServerRuntime():Promise<GuestServerRuntime>`. `GuestPolicy={bootstrapNetwork:RateBudget;readNetwork:RateBudget;readSession:RateBudget;readGlobal:RateBudget}`. `GuestRateSubject` explicitly distinguishes bootstrap-network/read-network/read-session/read-global; it uses `D1RateLimitRepository.consume` with null user, not account `RateSubject`. `mintGuestCapability(runtime,nowMs):Promise<{value:string;expiresAt:string}>`, `verifyGuestCapability(value,runtime,nowMs):Promise<GuestCapability>`, `enforceGuestReadAdmission(runtime,{network,sessionId}):Promise<void>`.

- [ ] **Step 1 — Write RED session/policy tests.** Pin exact production cookie attributes/name and rejection of duplicate names, invalid/canonical encoding, wrong version/audience/purpose/signature, expired token, issuance more than 30 seconds in the future and expiry not exactly issuance+1,800,000 ms. Assert existing abuse-key vectors unchanged, and guest token cannot serve an auth attempt. Pin guest budgets 10/30/60/60 over 600 seconds, network→session→global order, earlier charges retained on later denial, no fetch on denial/storage failure and no invented user. Require exact Origin and guest action `guest_sync`; old `auth_sign_in` proof cannot mint guest capability.
  Core assertions for `guest capability and policy cannot authorize account work`:
  ```ts
  expect(claims.expMs-claims.iatMs).toBe(1_800_000);
  expect(defaults.readSession).toEqual({limit:30,windowSeconds:600});
  expect(setCookie).toContain("__Host-kairos-guest-sync=");
  expect(setCookie).toContain("Path=/");
  expect(upstreamAfterDenial).toHaveBeenCalledTimes(0);
  ```
- [ ] **Step 2 — Verify RED.** `npm test -- tests/unit/guest-capability.test.ts tests/unit/guest-admission.test.ts tests/integration/guest-session-api.test.ts` must fail before implementation.
- [ ] **Step 3 — Implement boundaries.** Sign bounded strict payload `{v:1,sid,aud,iatMs,expMs}` using a random 32-byte sid and the new subkey purpose; verify through Web Crypto, not string comparison. Reject cookie values over 1,024 bytes. Runtime resolves feature/config without account/session lookup. Require strict JSON bootstrap `{schemaVersion:1,requestId,turnstileToken}`; return version/requestId/checkedAt/expiresAt with Set-Cookie, never its value. Session end accepts `{}` and clears only guest cookie, not rate events. Production uses `__Host-kairos-guest-sync`; guarded HTTP loopback uses `kairos-guest-sync-dev` and is never accepted in production. Trusted ingress follows current normalization/`cf-worker` rejection; loopback identity is server-selected only under the existing explicit local configuration. All errors/no-store responses are fixed and bounded.
- [ ] **Step 4 — Verify GREEN.** Repeat tests plus `npm test -- tests/unit/abuse-keys.test.ts tests/unit/turnstile.test.ts tests/integration/hosted-source-boundary.test.ts` and `npm run typecheck`. Assert account rate classes/overrides and Auth.js endpoints retain their prior contract.
- [ ] **Step 5 — Commit.** Stage S2 files only; commit `feat: protect anonymous guest reads without accounts`.

### S3: Wire the three transient source endpoints and guarded local fixtures

**Files:** Create `src/lib/guest/server/source-handler.ts`, the three approved route files under `src/app/api/guest/sources/{canvas/feed,ed/courses,ed/lessons}/route.ts`, and `src/lib/testing/guest-transport.ts`; test `tests/integration/guest-source-api.test.ts`, `guest-no-account-writes.test.ts`, `tests/unit/guest-fixture-boundary.test.ts`.

**Interfaces:** `createGuestSourceHandler(operation:"canvas-feed"|"ed-courses"|"ed-lessons",runtimeFactory?:()=>Promise<GuestServerRuntime>):(request:Request)=>Promise<Response>`. It parses the corresponding F1 schema, validates capability/origin/budget/control state, invokes S1 and emits a validated bounded DTO. Local fixture transport is returned only by the same triple gate as existing local fixtures: E2E_FIXTURES=1, explicit loopback runtime/ingress and canonical localhost/127.0.0.1 origin.

- [ ] **Step 1 — Write RED route tests.** Without preparing an account, assert a valid guest cookie permits all three reads and writes only null-user rate rows. Snapshot all account/source/credential/coursework/draft/request/owner tables before/after and assert identical rows. Assert existing account cookies neither authorize nor select data. Reject GET, media/body/extra fields, forged origin, wrong capability, paused provider, control-version drift, disabled feature, source credential errors and oversized result with correct no-store/fixed-error behavior. Synthetic secret markers in exceptions must not appear in response/log structures.
  Core assertions for `anonymous source reads persist only admission metadata`:
  ```ts
  expect(afterProtectedTables).toEqual(beforeProtectedTables);
  expect(admissionRows.every(row=>row.user_id===null)).toBe(true);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(foreignOriginResponse.status).toBe(403);
  ```
- [ ] **Step 2 — Verify RED.** `npm test -- tests/integration/guest-source-api.test.ts tests/integration/guest-no-account-writes.test.ts tests/unit/guest-fixture-boundary.test.ts` must fail on absent routes/boundaries.
- [ ] **Step 3 — Implement wiring.** Keep route files thin. Disabled feature fails before loading expensive source/config/data. Check control version before dispatch/redirect and before output; no held `operation_locks`. Use exact POST bodies from F1, 401 only for missing/expired guest capability, 422 for provider credential/result errors, 429+Retry-After for budgets and 503 for protection storage/control failure. Source credentials are request-local, never keys or values in D1. The fixture handles synthetic guest Siteverify proof/action and pinned provider URLs; preserve existing auth fixture behavior and reject unexpected fixture outbound traffic.
- [ ] **Step 4 — Verify GREEN.** Repeat tests plus existing `tests/integration/hosted-source-boundary.test.ts` and `tenant-scope-contract.test.ts`, `npm run typecheck`, `npm run verify:hosted`.
- [ ] **Step 5 — Commit.** Stage S3 files only; commit `feat: expose bounded hybrid guest source reads`.

### S4: Verify native transport/admission and preliminary capacity honestly

**Files:** Create `scripts/verify-workerd-guest-sources.mjs`, `scripts/measure-guest-source-parsers.mjs`, `tests/helpers/guest-workerd-fixtures.mjs`, `docs/deployment/guest-capacity-readiness.md`; modify `.github/workflows/milestone-2-ci.yml` to run the sealed native guest check after Workers build.

**Interfaces:** Native script emits `GUEST_NATIVE_TRANSPORT_PASSED` only when every case succeeds and `externalRequests:0`. Separate parser benchmark emits `GUEST_LOCAL_PARSER_MEASUREMENTS` with `evidenceType:"node-process-cpu"`; it never labels values deployed Worker CPU. Write timestamped receipts under ignored `artifacts/guest-source-capacity/` with source ref, fixture bytes/counts/output size, elapsed time and explicit admission read/write metrics.

- [ ] **Step 1 — Write failing native scenarios.** Use the existing sealed Miniflare pattern (`cf:false`, telemetry off, outbound fixture worker). Cases cover valid/escaped redirects, at most six Canvas and one Ed HTTP request, empty/partial data, no-length overflow, stalled body abort, malformed UTF-8, near-cap payloads, provider pause/version change and independent service admission contention. Include distributed bootstrap and global denial after earlier charges; assert no protected-table writes and record all D1 costs.
  Required native assertions for `sealed guest transport and denial accounting`:
  ```js
  assert.equal(report.externalRequests,0);
  assert(report.results.every(result=>result.ok===true));
  assert.equal(report.protectedRowsWritten,0);
  assert.equal(report.deniedTraffic.admittedEvents,2); // earlier network/session charges before global denial
  assert.equal(report.deniedTraffic.upstreamRequests,0);
  ```
- [ ] **Step 2 — Verify RED.** Run `node scripts/verify-workerd-guest-sources.mjs`; expect a failed scenario until the missing native behavior is implemented, never a live provider call.
- [ ] **Step 3 — Finish harness/fixes.** Import actual guest handlers, source transports and schemas, not copied algorithms. Bind synthetic D1/config/keys and fully intercept external fetch. Use deterministic parser generators rather than committed megabyte blobs. Readiness document marks actual hosted CPU, denied-traffic capacity, physical retention and operator live acceptance OPEN until measured; no maintenance activation or billing change is included.
- [ ] **Step 4 — Verify GREEN.** Run the native script, parser benchmark, `npm run build:vinext` and existing `node scripts/verify-workerd-provider-completion.mjs`; inspect case count/status/zero external requests. Do not claim local elapsed or Node CPU satisfies the Free limit.
- [ ] **Step 5 — Commit.** Stage S4 files only; commit `test: verify native guest boundaries and capacity evidence`.
