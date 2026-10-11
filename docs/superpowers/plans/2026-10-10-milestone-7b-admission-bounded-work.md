# Milestone 7B Admission and Bounded Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Enforce challenge verification, tenant/provider budgets, duplicate-work exclusion, and emergency controls on every public or expensive operation.

**Architecture:** Use D1 atomic admission for exact rolling 600/3600-second budgets; native Workers rate bindings support only shorter, location-local windows and may add burst protection. Guard both Auth.js route handlers and server actions before OAuth begins. Share server-owned operation context across common services and retain durable ownership through bridge completion and remote calendar reconciliation.

**Tech Stack:** TypeScript, Auth.js, Cloudflare Workers/D1/Turnstile, Web Crypto, Vitest, Playwright, workerd.

**Spec:** `docs/superpowers/specs/2026-10-06-public-beta-readiness-design.md`, sections 6, 10, 15-17. Parent: `2026-10-10-milestone-7-public-beta.md`.

## Global Constraints

- Public auth initiation: 20 per 10 minutes, coarse trusted client/network key plus provider.
- Credential test/connect: 10 per 10 minutes, user plus provider; discovery/refresh and saved onboarding candidates share this bucket.
- Source manual sync: 12 per 10 minutes, user plus source.
- Calendar manual sync: 12 per 10 minutes, user plus destination.
- Sync All: 6 per 10 minutes, user. Deletion confirmation: 5 per hour, user.
- Turnstile verifies auth initiation server-side before OAuth; normal authenticated reads and logout remain usable.
- No automatic cross-provider account linking, email-domain eligibility, client-supplied budgets/user identity, or production fixture bypass.
- Stable errors and bounded Retry-After; logs/storage contain no raw IP, email, credential, private URL, OAuth material, or assignment content.
- Duplicate actions join, reject, or coalesce; elapsed lock time alone does not prove remote work settled.

## Review Focus

1. GET/POST/server actions bypass the widget: Task 2 tests real route/action entry points and zero Auth.js invocation on failed admission.
2. Concurrent callers or boundary bursts exceed budgets: Task 1 uses atomic rolling-window SQL and independent workerd requests.
3. Worker interruption or abandoned browser work allows stale writes: Task 4 preserves owner/fencing and requires safe recovery before reacquisition.
4. Sync All starts work before admission or reuses a forged run: Task 5 rejects before source/extension dispatch and claims each user-bound step once.
5. Provider shutdown/reopen revives old callbacks: Task 2 uses versioned controls and callback stamps; ordinary sessions/deletion/local disconnect survive.

## Task 1: Durable budgets, controls, and runtime contract

**Files:** Create `migrations/0005_abuse_controls.sql`, `src/lib/abuse/types.ts`, `src/lib/abuse/policy.ts`, `src/lib/abuse/keys.ts`, `src/lib/abuse/guard.ts`, `src/lib/platform/abuse-runtime.ts`, `src/lib/db/d1/repositories/rate-limits.ts`, `src/lib/db/d1/repositories/abuse-controls.ts`, `src/lib/db/d1/repositories/operation-locks.ts`, `src/lib/db/d1/repositories/sync-all-runs.ts`, `tests/unit/abuse-policy.test.ts`, `tests/unit/abuse-keys.test.ts`, `tests/integration/abuse-rate-limits.test.ts`. Integrate production config, `.env.example`, migration verification, and transactional test helper centrally with 7A.

**Interfaces:**
- `AbuseRuntime = {db: D1DatabaseLike; hmacKey: Uint8Array; turnstileSecret: string; appOrigin: string; hostname: string; fetchImpl: typeof fetch}`; `getAbuseRuntime(): Promise<AbuseRuntime>` loads Worker bindings lazily.
- New bindings: public `KAIROS_TURNSTILE_SITE_KEY`; secret `KAIROS_TURNSTILE_SECRET_KEY`; dedicated 32-byte base64url `KAIROS_ABUSE_KEY_V1`. Derive distinct HMAC subkeys/namespaces for rate keys and auth-attempt signatures; do not reuse credential encryption keys.
- `RateDecision = {allowed: true} | {allowed: false; retryAfterSeconds: number}`.
- `D1RateLimitRepository.consume({keyHash, userId, limit, windowSeconds}: {keyHash: string; userId: string | null; limit: number; windowSeconds: number}): Promise<RateDecision>`; only trusted policy code selects limit/window.
- `enforceBudget(runtime: AbuseRuntime, subject: RateSubject): Promise<void>`; discriminated `RateSubject` contains class plus server-derived actor/provider/owned resource.
- `D1AbuseControlRepository.get(key: ControlKey): Promise<{enabled: boolean; version: number}>`; `abuseErrorResponse(error: unknown): Response | null` maps typed failures only.

- [ ] Red tests pin all six exact budgets, allowed N/rejected N+1, staggered rolling expiry, 599999/600000 and 3599999/3600000 ms boundaries, concurrent independent callers, user/provider/resource isolation, and denied-attempt no-window-extension.
- [ ] Run policy/key/D1 admission tests; new behaviors fail.
- [ ] Add `abuse_rate_events(event_id PK, key_hash, user_id nullable FK/cascade, admitted_at_ms, purge_after_ms)` with key/time and purge indexes; `abuse_controls(control_key PK, enabled, version, updated_at_ms)`; durable lock/run/step tables from Tasks 4-5; add calendar `oauth_requests.control_version DEFAULT 0`. Migration is additive and leaves 0001-0004 unchanged.
- [ ] Admission is one conditional `INSERT ... SELECT` with DB time and count in `(now-window, now]`; `meta.changes` decides admission. Never read-count/write in separate JavaScript steps. On denial derive retry from the oldest live event; clamp HTTP/body retry to 1-3600 seconds. Store only admitted attempts, including failed credentials/challenge; denied attempts add no row.
- [ ] HMAC validated edge client addressing and provider; normalize IPv4 and IPv6 `/64`, never arbitrary forwarded headers. Shared-network false positives are expected; no raw addressing is retained. Keep the HMAC namespace stable across deployments while events remain live.
- [ ] Return `429 RATE_LIMITED` with `retryAfterSeconds`, `Retry-After`, and no-store; D1 admission outage returns `503 ABUSE_STORAGE_UNAVAILABLE` before upstream work. Expired event/run cleanup is 7C-owned, at least daily with bounded indexed batches; running/uncertain locks are never purged automatically.
- [ ] Run targeted tests and migration verifier; review proposed commit `feat(abuse): enforce durable tenant and provider budgets`.

## Task 2: Challenge-protected Auth.js entry and versioned shutdown

**Files:** Create `src/lib/auth/turnstile.ts`, `src/lib/auth/initiation.ts`, `src/features/auth/auth-initiation-form.tsx`, `src/lib/security/request-origin.ts`, `tests/unit/turnstile.test.ts`, `tests/integration/abuse-auth.test.ts`. Modify root `auth.ts`, sign-in page, auth catch-all route, auth config, `src/proxy.ts`, and calendar OAuth request/start/callback code centrally with 7A/7C.

**Interfaces:**
- `IdentityProvider = "google" | "microsoft-entra-id"`; `verifyTurnstile(input: {token: string; expectedAction: string; expectedHostname: string}, deps: {secret: string; fetchImpl: typeof fetch}): Promise<void>`.
- `enforcePublicAuthInitiation(runtime: AbuseRuntime, provider: IdentityProvider, headers: Headers, formData: FormData): Promise<AuthAttempt>`.
- `startPublicSignIn(provider: IdentityProvider, formData: FormData): Promise<AuthActionState>`; `guardAuthRequest(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response>`.
- Raw Auth.js signIn/handlers remain private in `auth.ts`; exports are guarded entry points, existing auth/session/signOut, and the public initiation action. No second public route can reach the private signIn function.

- [ ] Red tests cover missing/duplicate/forged/expired/spent/wrong-action/wrong-host tokens, oversized token, malformed Siteverify response, network/timeout, direct GET provider initiation, direct POST, actual server action, and no verification on normal session reads/logout.
- [ ] Run Turnstile/auth-route/action integration tests; new cases fail with zero OAuth calls.
- [ ] One shared guard orders canonical origin, allowlisted provider, emergency control, 20/600 budget, bounded Siteverify, then Auth.js. Token is nonempty/max 2048; require success and exact hostname/action `auth_google` or `auth_microsoft`. Use fixed Siteverify endpoint, 5-second fetch timeout, no redirects/body logging. Never cache a verification for reuse or accept a client “verified” header/cookie.
- [ ] Reject GET `/api/auth/signin/{provider}` with 405 `AUTH_INITIATION_REQUIRES_POST`; generic sign-in GET redirects to the custom page. Direct POST retains Auth.js CSRF checks; server actions retain framework checks plus explicit origin validation. Widget refreshes spent/expired tokens and uses managed/interaction-only appearance.
- [ ] Controls are `auth:initiation`, `auth:google`, `auth:microsoft-entra-id`, and separate `provider:canvas/gradescope/ed/google/microsoft/caldav`. Global initiation pause blocks starts but permits admitted callbacks. Disabling a specific identity provider blocks its starts and pending callbacks before exchange; increment provider control version on every change.
- [ ] After verified initiation, issue a signed ten-minute HttpOnly/Secure/SameSite=Lax auth-attempt cookie bound to provider/control version. Callback checks the stamp and unchanged enabled provider, then runs existing Auth.js OAuth/PKCE/state protections; clear stamp on completion. Use separate provider stamp names so an unrelated sign-in does not overwrite it silently.
- [ ] Calendar starts store provider control version in durable OAuth state; callbacks reject disabled/stale version before exchange/provisioning, including after reopening. Existing sessions, session reads, sign-out, deletion, and local disconnect stay available; remote provider work is paused.
- [ ] Extend proxy protection to auth initiation/sign-in actions and Sync All; exempt only exact supported callbacks where provider-bound callback checks apply. Preserve 7A's overwritten trusted pathname header. Integrate required Turnstile script/frame CSP hosts without weakening unrelated policy.
- [ ] Make account-link-related public errors generic. Run targeted tests/workerd route smoke; review proposed commit `feat(auth): protect OAuth initiation with Turnstile and shutdown controls`.

## Task 3: Shared provider enforcement and route coverage

**Files:** Create `src/lib/abuse/provider-operation.ts`, `tests/integration/abuse-api-coverage.test.ts`. Modify source test/connect/discovery/refresh/sync/start/complete routes for Canvas, Ed, Gradescope; calendar Google/Microsoft start/callback, iCloud test/connect, destination sync/remove-events, calendar sync-all; account deletion; 7A saved-draft test/connect; common services and client error presentation. Keep API routes for reads/local disconnect available.

**Interfaces:**
- `withProviderWork<T>(runtime: AbuseRuntime, scope: UserScope, input: {provider: IntegrationProvider; operation: "credential" | "manual-sync" | "source-write"; resourceId?: string; runId?: string}, work: (context: ProviderWorkContext) => Promise<T>): Promise<T>`.
- `ProviderWorkContext` is server-issued admission/control/ownership/guarded-fetch context, never constructed from headers/body. Nested service calls reuse it to avoid double charging. It consumes 7C operation correlation/events.

- [ ] Red coverage tests invoke every upstream route/service, exhaust the shared provider bucket through mixed regular/draft/discovery calls, attempt unauthenticated/foreign-owned IDs, and verify failed admission produces zero upstream work.
- [ ] Run `npm test -- tests/integration/abuse-api-coverage.test.ts`; new cases fail.
- [ ] Authenticate/authorize resources before tenant admission. Test/connect/refresh/discovery share 10/600. Starts charge once; callback/completion requires durable admission and does not charge twice. Deletion authentication precedes its 5/3600 confirmation budget, including invalid confirmation attempts.
- [ ] Wrap common service entry points, not just buttons/routes. Check controls before upstream work and before further scheduled calls; integrate safe retry/service codes into 7A recovery presentation. Preserve server return targets and original credential/data privacy.
- [ ] Run route/service regression tests; review proposed commit `feat(abuse): cover all provider and deletion entry points`.

## Task 4: Cross-instance ownership and recoverable uncertain work

**Files:** Create `src/lib/abuse/operation-lock.ts`, `tests/integration/abuse-operation-locks.test.ts`. Modify Canvas/Ed/Gradescope/submission sync/discovery services, `src/lib/db/d1/repositories/sync-requests.ts`, calendar reconcile/connection/provider-factory/post-source-sync and relevant assignment/status/credential/event-link repository mutations; preserve the legacy isolated test path only where existing tests still need it.

**Interfaces:**
- `OperationLock = {userId: string; operationKey: string; ownerNonce: string}`; `acquireOperation(runtime: AbuseRuntime, scope: UserScope, key: OperationKey): Promise<OperationLock>`; `releaseOperation(lock: OperationLock): Promise<boolean>`; `markOperationUncertain(lock: OperationLock): Promise<void>`.
- `operation_locks`: `(user_id, operation_key)` PK/FK cascade, owner nonce, `idle/running/uncertain` state, start/staleness timestamps, provider `not_before_ms`. Bridge request state includes the owning nonce; SQL mutations fence writes by that owner.

- [ ] Red tests hold remote work unresolved beyond staleness and prove another instance makes zero calls; cover different users/resources, old-owner release, duplicate/expired completion, connect-versus-sync and automatic-versus-manual reconciliation, Worker interruption, and ambiguous response recovery.
- [ ] Run D1 ownership tests; new cases fail.
- [ ] Acquire atomically only when absent or idle with cooldown elapsed. One lock per user/source and one per user/calendar provider covers connection, credential rotation, sync and remote removal. No TTL takeover for running work. Reject duplicates with `409 SYNC_IN_PROGRESS`; owner-only release after all remote work settles.
- [ ] Bridge starts hold ownership until completion; repeated/expired/foreign completion cannot write or release it. Mark abandoned/ambiguous work uncertain; return `409 SYNC_RECOVERY_REQUIRED` with truthful retained-data guidance.
- [ ] Release ordinary known read/validation failures after work settles. For uncertain calendar writes, reconcile deterministic IDs/transaction IDs/ETags before recovery. Do not promise provider-side exactly-once behavior after a transport ambiguity. Operator recovery in 7C must confirm prior settlement/termination and remote outcome; elapsed time alone is insufficient. This favors overlap prevention over automatic takeover and is a plan-review tradeoff.
- [ ] Fence all owned D1 writes by nonce in mutation SQL, including credentials and event links. Guard automatic post-source and all-destination reconciliation too; private internal calls cannot bypass controls/ownership.
- [ ] Retain four calendar event workers. On provider throttling stop scheduling additional calls, honor bounded Retry-After with default 60/max 3600 seconds, and persist cooldown. Catch/release or retain uncertain state consistently; do not strand locks on an ordinary validation rejection.
- [ ] Run targeted concurrency/idempotency/regression tests and a multi-request workerd probe; review proposed commit `feat(sync): bound concurrent provider work across Worker instances`.

## Task 5: Server admission before Sync All fan-out

**Files:** Create `src/app/api/sync-all/start/route.ts`, `tests/integration/abuse-sync-all.test.ts`. Modify `src/features/sync/connected-source-sync-controls.tsx`, source/extension/calendar providers, calendar sync-all route, and `tests/component/connected-source-sync-controls.test.tsx`.

**Interfaces:**
- `SyncAllStep = "canvas-deadlines" | "canvas-submissions" | "gradescope" | "ed" | "calendars"`.
- `startSyncAll(runtime: AbuseRuntime, scope: UserScope): Promise<{runId: string; expiresAt: string; steps: SyncAllStep[]}>`; eligible steps selected by the server.
- `claimSyncAllStep(runtime: AbuseRuntime, scope: UserScope, runId: string, step: SyncAllStep): Promise<void>` atomically claims one user-bound step.
- `sync_all_runs` stores user/run PK, expiry and eligible steps; `sync_all_steps` stores composite run FK plus once-only step claim. Run expiry is ten minutes.

- [ ] Red tests prove the seventh admission does zero source fetches/extension dispatch, valid use debits global bucket once, foreign/forged/expired run rejects, step replay rejects, and child resource budgets still apply.
- [ ] Run Sync All API/component tests; new behaviors fail.
- [ ] Client obtains server admission before any source request or extension message. Claims each admitted step once, then uses ordinary guarded source/destination services. Canvas deadlines/submissions share the Canvas 12/600 source bucket.
- [ ] Calendar-only sync-all without a run consumes the same user 6/600 bucket before fan-out. A valid run claims the prepaid calendar step once; each destination still consumes its 12/600 budget. Automatic post-source reconciliation uses provider controls, ownership/backoff, without a new manual Sync All debit.
- [ ] Run IDs and defer headers never waive admission/resource budgets or ownership. Run targeted tests; review proposed commit `feat(sync): admit Sync All before provider fan-out`.

## Task 6: Runtime verification and operational handoff

**Files:** Create `tests/e2e/auth-initiation.spec.ts`, `scripts/verify-workerd-abuse.mjs`. Extend existing draft/deletion/connector tests, production safety verifier, CI, and 7C incident/monitoring/privacy documents centrally.

**Interfaces:** `npm run verify:workerd:abuse` exercises atomic admission and unresolved-work exclusion using independent workerd requests and temporary isolated D1, never production credentials/data. Auth tests inject Siteverify fetch in unit/integration fixtures; any hosted/browser use of Cloudflare test keys is confined to the test environment and cannot disable verification/hostname/action checks in production.

- [ ] Add real browser entry tests for both sign-in actions and direct routes; configured controlled Turnstile test responses exercise valid flow, while invalid/missing responses prove no redirect/provider call. Verify local fixture configuration cannot be promoted to production.
- [ ] Run policy/D1/API/browser/workerd tests and parent integrated gates. SQLite alone is not concurrency evidence.
- [ ] Measure representative D1 reads/writes and rejection-path costs; document capacity implications and bounded indexed cleanup. Check shared-network UX and control outage behavior in controlled acceptance.
- [ ] Fresh security reviewer checks auth bypasses, origin/callback/stamp controls, tenant budgets/ownership, draft reuse, and service error redaction before scoped commit/release.

## Primary sources checked 2026-10-10

- [Workers rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): periods are 10/60 seconds and counters are location-local/permissive. They cannot substitute for the specified durable 600/3600-second admission.
- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [limits](https://developers.cloudflare.com/d1/platform/limits/): transactional batches and database query serialization support atomic admission; quota/call-volume checks remain necessary.
- [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): server validation is mandatory; tokens expire after 300 seconds and are single-use.
- [Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) and [CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
- [Cloudflare request header semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/): client addressing trust comes from the controlled edge ingress, not arbitrary forwarded values.

The selected rolling-window interpretation, shared Canvas child budget, and uncertain-work recovery policy are explicit review decisions. No Milestone 7 implementation has begun.
