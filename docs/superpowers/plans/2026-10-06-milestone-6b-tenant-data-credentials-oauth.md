# Milestone 6B — Tenant Data, Credentials, and Durable OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all Kairos domain data and synchronization behavior from global synchronous SQLite/process-local state to tenant-scoped asynchronous D1 repositories with encrypted credentials and durable one-time request/OAuth state.

**Architecture:** Replace the current `better-sqlite3` repositories in place with async D1 repositories that require `UserScope`. Source/calendar services and API routes receive scope from the authenticated session, never from request payloads. Sensitive credentials are AES-256-GCM envelopes bound to owner/purpose/connection, while browser-sync and calendar-OAuth state use D1 rows with expiry and atomic one-time consumption.

**Tech Stack:** TypeScript, Cloudflare D1, Workers Web Crypto, Auth.js `UserScope`, Vitest, existing Canvas/Gradescope/Ed/calendar adapters.

**Spec:** `docs/superpowers/specs/2026-10-06-multi-user-hosted-foundation-design.md`

## Global Constraints

- Every user-owned record is scoped by authenticated `user_id`.
- Composite database constraints must reject cross-user relationships even if repository safeguards are bypassed.
- Missing records and records owned by another user return the same normal not-found behavior.
- Sensitive source/calendar credentials are encrypted before D1 persistence.
- Ciphertext associated data binds owner, credential kind, and connection ID.
- OAuth/browser request state is expiring, one-time, durable across Worker instances, and user-bound.
- Source writes remain authoritative; calendar reconciliation failure does not roll them back.
- Existing provider semantics and secret non-exposure requirements remain unchanged.
- Do not migrate plaintext secrets from the old local SQLite file.

## Review Focus

- A valid object ID owned by Alice supplied from Bob's session must behave exactly like a nonexistent ID; Tasks 2, 3, 5, and 7 add explicit tests.
- Copying a credential envelope between users or credential kinds must fail authentication/decryption; Task 1 adds tamper/cross-context tests.
- Two Worker instances racing to consume the same OAuth/browser request must result in exactly one successful consumption; Task 4 adds atomic-consume tests.
- Rotated Google/Microsoft refresh tokens must replace the previous envelope atomically without exposing either value; Task 6 adds rotation tests.
- A failed replacement credential test must preserve the previous known-good encrypted credential; Tasks 5 and 6 add regression tests.

---

### Task 1: Add application-level credential encryption

**Files:**
- Create: `src/lib/security/credential-cipher.ts`
- Create: `src/lib/security/credential-types.ts`
- Create: `tests/unit/credential-cipher.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: server secret `KAIROS_CREDENTIAL_KEY_V1`.
- Produces:
  - `type CredentialKind = "canvas_feed_url" | "ed_api_token" | "google_refresh_token" | "microsoft_refresh_token" | "caldav_secret"`
  - `encryptCredential(input:{plaintext:string;userId:string;kind:CredentialKind;connectionId:string}, keyring:CredentialKeyring): Promise<string>`
  - `decryptCredential(input:{envelope:string;userId:string;kind:CredentialKind;connectionId:string}, keyring:CredentialKeyring): Promise<string>`
  - versioned envelope `v1.<key-id>.<iv-base64url>.<ciphertext-base64url>`.

- [ ] **Step 1: Write failing cipher tests**

Assert:
- encrypt/decrypt round trip;
- same plaintext produces different ciphertext due to random IV;
- wrong user, kind, connection, key, modified IV, or modified ciphertext rejects;
- plaintext never appears in envelope;
- unknown envelope version/key ID fails closed.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/credential-cipher.test.ts`  
Expected: FAIL because cipher does not exist.

- [ ] **Step 3: Implement AES-256-GCM envelope**

Use Web Crypto only. Bind AAD to `kairos:v1:<userId>:<kind>:<connectionId>`. Never log plaintext or envelopes.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/unit/credential-cipher.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/credential-cipher.ts src/lib/security/credential-types.ts tests/unit/credential-cipher.test.ts .env.example
git commit -m "feat: encrypt hosted credentials"
```

### Task 2: Rewrite source, assignment, settings, and submission repositories for D1 tenant scope

**Files:**
- Modify: `src/lib/db/repositories/source-connections.ts`
- Modify: `src/lib/db/repositories/source-credentials.ts`
- Modify: `src/lib/db/repositories/source-courses.ts`
- Modify: `src/lib/db/repositories/assignments.ts`
- Modify: `src/lib/db/repositories/submission-status.ts`
- Modify: `src/lib/db/repositories/settings.ts`
- Create: `tests/integration/d1-source-repositories.test.ts`
- Modify: `tests/integration/assignment-repository.test.ts`
- Modify: `tests/integration/settings-repository.test.ts`
- Modify: `tests/integration/source-connections.test.ts`
- Modify: `tests/integration/source-credentials.test.ts`
- Modify: `tests/integration/submission-status-repository.test.ts`

**Interfaces:**
- Consumes: `D1Database`, `UserScope`, credential cipher from Task 1.
- Produces async repository methods where every operation receives/owns `scope:UserScope`; credential getters return decrypted values only for the matching scope/context.

Representative signatures:
- `new SourceConnectionRepository(db, scope)`
- `getByKind(kind): Promise<SourceConnection|null>`
- `getById(id): Promise<SourceConnection|null>`
- `upsertCanvas(label): Promise<SourceConnection>`
- `new AssignmentRepository(db, scope)`
- `list(filters?): Promise<Assignment[]>`
- `upsertMany(connectionId, assignments, seenAt): Promise<{inserted:number;updated:number}>`
- `new SettingsRepository(db, scope)`
- `getTimeZone(): Promise<string>`
- `setTimeZone(timeZone): Promise<void>`.

- [ ] **Step 1: Write Alice/Bob failing repository tests**

For each repository family assert:
- Alice list/get only sees Alice rows;
- Bob cannot fetch/update/delete Alice row by known ID;
- Alice and Bob may each own a `canvas` connection despite `UNIQUE(user_id, kind)`;
- cross-user parent/child insert fails at D1 FK level;
- settings default independently per user;
- credential repository stores envelopes, never plaintext.

- [ ] **Step 2: Run RED**

Run the affected repository integration tests.  
Expected: FAIL because repositories are synchronous/global.

- [ ] **Step 3: Rewrite repositories to async D1**

All SQL includes `user_id` in selection/update/delete keys. Replace Node `crypto.randomUUID()` imports with Web-compatible `crypto.randomUUID()`.

Credential setters encrypt before D1 write; getters decrypt only with matching user/kind/connection.

- [ ] **Step 4: Run GREEN**

Run:
`npm test -- tests/integration/d1-source-repositories.test.ts tests/integration/assignment-repository.test.ts tests/integration/settings-repository.test.ts tests/integration/source-connections.test.ts tests/integration/source-credentials.test.ts tests/integration/submission-status-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/repositories tests/integration
git commit -m "refactor: scope source data to users"
```

### Task 3: Rewrite calendar repositories for D1 tenant scope

**Files:**
- Modify: `src/lib/db/repositories/calendar-connections.ts`
- Modify: `src/lib/db/repositories/calendar-credentials.ts`
- Modify: `src/lib/db/repositories/calendar-event-links.ts`
- Modify: `tests/integration/calendar-repositories.test.ts`
- Modify: `tests/integration/calendar-schema.test.ts`

**Interfaces:**
- Consumes: `D1Database`, `UserScope`, credential cipher.
- Produces async tenant-scoped `CalendarConnectionRepository`, `CalendarCredentialRepository`, `CalendarEventLinkRepository`.

- [ ] **Step 1: Write failing cross-user calendar tests**

Assert Bob cannot list/get/update/delete Alice calendar connection, cannot read Alice refresh token/iCloud secret, cannot adopt Alice event link, and D1 rejects Bob event link referencing Alice assignment/calendar.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/calendar-repositories.test.ts tests/integration/calendar-schema.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement async scoped repositories**

Persist Google/Microsoft refresh tokens as distinct credential kinds so AAD prevents cross-provider swapping. Encrypt only the iCloud secret; username/account label remains non-secret metadata.

- [ ] **Step 4: Run GREEN**

Run same command.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/repositories/calendar-* tests/integration/calendar-repositories.test.ts tests/integration/calendar-schema.test.ts
git commit -m "refactor: scope calendar data to users"
```

### Task 4: Replace process-local browser sync registries with durable D1 request state

**Files:**
- Modify: `src/lib/submission-status/request-registry.ts`
- Modify: `src/lib/gradescope/request-registry.ts`
- Modify: `src/lib/submission-status/sync-service.ts`
- Modify: `src/lib/gradescope/discovery-service.ts`
- Modify: `src/lib/gradescope/sync-service.ts`
- Create: `src/lib/db/repositories/sync-requests.ts`
- Modify: `tests/unit/gradescope-request-registry.test.ts`
- Modify: `tests/integration/submission-status-api-routes.test.ts`
- Modify: `tests/integration/gradescope-discovery-api.test.ts`
- Modify: `tests/integration/gradescope-sync-api.test.ts`

**Interfaces:**
- Consumes: D1 request-state table, `UserScope`.
- Produces:
  - `registerSyncRequest(db, scope, input): Promise<void>`
  - `consumeSyncRequest(db, scope, requestId, expectedKind, now): Promise<RegisteredSyncRequest|null>`
  - atomic one-time consumption scoped to `user_id`.

- [ ] **Step 1: Write failing durability/isolation tests**

Assert:
- request created by Alice cannot be consumed by Bob;
- request survives creation/consumption through separate repository instances;
- expired request returns null;
- two concurrent consumes produce exactly one payload and one null;
- kind mismatch fails closed without exposing ownership.

- [ ] **Step 2: Run RED**

Run the four named test files.  
Expected: FAIL while registries are Maps.

- [ ] **Step 3: Implement D1 request repository and adapt services**

Store normalized request payload JSON only; never store browser cookies/raw HTML. Use a D1 transaction/conditional update to mark `consumed_at` exactly once.

- [ ] **Step 4: Run GREEN**

Run the same tests.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/submission-status src/lib/gradescope src/lib/db/repositories/sync-requests.ts tests
git commit -m "feat: persist browser sync requests"
```

### Task 5: Migrate Canvas, Gradescope, and Ed services/API routes to authenticated tenant scope

**Files:**
- Modify: `src/lib/sync/sync-source.ts`
- Modify: `src/lib/ed/discovery-service.ts`
- Modify: `src/lib/ed/sync-service.ts`
- Modify: `src/lib/gradescope/discovery-service.ts`
- Modify: `src/lib/gradescope/sync-service.ts`
- Modify: `src/lib/submission-status/sync-service.ts`
- Modify: `src/app/api/sources/canvas/**/route.ts`
- Modify: `src/app/api/sources/ed/**/route.ts`
- Modify: `src/app/api/sources/gradescope/**/route.ts`
- Modify: `tests/integration/canvas-api-routes.test.ts`
- Modify: `tests/integration/ed-connection-api.test.ts`
- Modify: `tests/integration/ed-courses-api.test.ts`
- Modify: `tests/integration/ed-sync-api.test.ts`
- Modify: `tests/integration/gradescope-discovery-api.test.ts`
- Modify: `tests/integration/gradescope-sync-api.test.ts`
- Modify: `tests/integration/submission-status-api-routes.test.ts`

**Interfaces:**
- Consumes: `requireUserScope()`, async scoped repositories, durable sync requests.
- Produces tenant-safe source routes; service signatures accept `scope:UserScope` and never infer ownership from a connection ID.

- [ ] **Step 1: Add cross-user failing API cases**

For every source family assert:
- unauthenticated request returns auth error;
- Bob supplying Alice connection/course/request IDs receives ordinary not-found/inactive behavior;
- Alice succeeds;
- failed replacement token/feed validation preserves Alice's previous encrypted credential;
- Bob's data is unchanged.

- [ ] **Step 2: Run RED**

Run the named API integration tests.  
Expected: FAIL.

- [ ] **Step 3: Convert services and routes**

Load `db` and `scope` once per route. Await repositories/services. Keep Canvas/Gradescope browser payloads normalized exactly as before.

- [ ] **Step 4: Run GREEN**

Run source API/service suites.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync src/lib/ed src/lib/gradescope src/lib/submission-status src/app/api/sources tests/integration
git commit -m "feat: isolate source sync by user"
```

### Task 6: Replace calendar OAuth Map with durable, encrypted, user-bound OAuth requests

**Files:**
- Modify: `src/lib/calendar/oauth-registry.ts`
- Create: `src/lib/db/repositories/oauth-requests.ts`
- Modify: `src/lib/calendar/google/oauth.ts`
- Modify: `src/lib/calendar/microsoft/oauth.ts`
- Modify: `src/app/api/calendars/google/start/route.ts`
- Modify: `src/app/api/calendars/google/callback/route.ts`
- Modify: `src/app/api/calendars/microsoft/start/route.ts`
- Modify: `src/app/api/calendars/microsoft/callback/route.ts`
- Modify: `tests/unit/calendar-oauth-registry.test.ts`
- Modify: `tests/integration/calendar-oauth-api.test.ts`

**Interfaces:**
- Produces:
  - `registerOAuthRequest(db, scope, input, now): Promise<{state:string;codeChallenge:string}>`
  - `consumeOAuthRequest(db, scope, state, provider, now): Promise<RegisteredOAuthRequest|null>`
- Persists only a hash of browser-visible state when practical and an encrypted PKCE verifier.
- Consumption requires matching provider and session user and is atomic/one-time.

- [ ] **Step 1: Write failing hosted OAuth-state tests**

Assert Alice/Bob isolation, expiry, provider mismatch, separate Worker/repository instance durability, atomic double-consume, PKCE verifier non-plaintext storage, and safe internal `returnTo`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/calendar-oauth-registry.test.ts tests/integration/calendar-oauth-api.test.ts`  
Expected: FAIL while state is process-local.

- [ ] **Step 3: Implement D1 OAuth requests**

Hash state using SHA-256; encrypt PKCE verifier with credential/cipher infrastructure using a dedicated OAuth-state purpose if needed. Validate `returnTo` as a same-origin application path.

- [ ] **Step 4: Update Microsoft hosted token exchange config**

Add confidential Web client secret support for hosted Microsoft calendar token exchange while retaining localhost testability. Keep PKCE.

- [ ] **Step 5: Run GREEN**

Run same tests.  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar src/lib/db/repositories/oauth-requests.ts src/app/api/calendars tests
git commit -m "feat: persist calendar oauth requests"
```

### Task 7: Migrate calendar services, reconciliation, and routes to tenant scope

**Files:**
- Modify: `src/lib/calendar/connection-service.ts`
- Modify: `src/lib/calendar/provider-factory.ts`
- Modify: `src/lib/calendar/reconcile.ts`
- Modify: `src/lib/calendar/post-source-sync.ts`
- Modify: `src/app/api/calendars/**/route.ts`
- Modify: `src/app/api/settings/calendar/route.ts`
- Modify: `tests/integration/calendar-api.test.ts`
- Modify: `tests/integration/calendar-reconcile.test.ts`
- Modify: `tests/integration/calendar-source-hooks.test.ts`
- Modify: `tests/integration/settings-api-route.test.ts`

**Interfaces:**
- Consumes: async tenant calendar/source repositories and `UserScope`.
- Produces `reconcileCalendarConnection(db, scope, connectionId, options)` and `reconcileAllCalendars(db, scope, options)`.

- [ ] **Step 1: Add failing Alice/Bob calendar service/API tests**

Assert Bob cannot sync/disconnect/remove events from Alice destination even with exact ID; `sync-all` reconciles only the caller's destinations; source-triggered reconcile cannot cross users.

- [ ] **Step 2: Run RED**

Run the named calendar suites.  
Expected: FAIL.

- [ ] **Step 3: Convert calendar services/routes**

Await scoped repositories. Preserve per-provider failure isolation and refresh-token rotation. Never let an ID supplied in the request determine tenant scope.

- [ ] **Step 4: Run GREEN**

Run calendar suites.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar src/app/api/calendars src/app/api/settings/calendar/route.ts tests/integration
git commit -m "feat: isolate calendar sync by user"
```

### Task 8: Move dashboard reads to D1 scope and remove legacy SQLite runtime

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/(dashboard)/upcoming/page.tsx`
- Modify: `src/app/(dashboard)/calendar/page.tsx`
- Modify: `src/app/(dashboard)/assignments/page.tsx`
- Modify: `src/app/(dashboard)/sources/page.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/lib/assignments/queries.ts`
- Delete: `src/lib/db/client.ts`
- Delete: `src/lib/db/migrate.ts`
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `tests/component/dashboard-states.test.tsx`
- Modify: `tests/integration/assignment-queries.test.ts`
- Modify: `tests/integration/secret-exposure.test.ts`

**Interfaces:**
- Consumes: authenticated scope and all async D1 repositories.
- Produces no production import of `better-sqlite3`; dashboard renders only caller-owned state.

- [ ] **Step 1: Write failing tenant dashboard tests**

Render/load Alice and Bob data separately and assert no course/title/connection from the other tenant appears. Add a source scan asserting production `src/` contains no `better-sqlite3` import.

- [ ] **Step 2: Run RED**

Run component/query/secret tests.  
Expected: FAIL until pages are async/scoped and legacy client is removed.

- [ ] **Step 3: Convert dashboard reads and delete legacy runtime**

Resolve `requireUserScope()` before user-owned reads. Remove `better-sqlite3` from production dependencies (test-only use may remain only if still required by a legacy test; prefer removing it entirely).

- [ ] **Step 4: Run full 6B verification**

Run:
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run db:verify`
- `npm run build`
- `npm run build:vinext`
- `npm run test:e2e`

Expected: all PASS; vinext compatibility report has no Node/`better-sqlite3` blocker.

- [ ] **Step 5: Commit**

```bash
git add src tests package.json next.config.ts
git commit -m "refactor: complete tenant D1 migration"
```
