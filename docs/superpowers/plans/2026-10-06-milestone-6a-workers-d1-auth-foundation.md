# Milestone 6A — Workers, D1, and Authentication Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Cloudflare Workers/vinext runtime, D1 schema, Auth.js Google/Microsoft identity layer, and durable authenticated `UserScope` without yet migrating every existing Kairos domain service off legacy SQLite.

**Architecture:** Keep the current application behavior intact while introducing the production runtime and identity foundation beside it. D1 becomes the authoritative store for Auth.js and the future multi-tenant domain schema; existing global SQLite feature code remains explicitly legacy until Plan 6B migrates it, and production deployment stays gated until that migration is complete.

**Tech Stack:** Next.js 16, TypeScript, vinext, Cloudflare Workers, Wrangler, Cloudflare D1, Auth.js/`next-auth`, `@auth/d1-adapter`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-multi-user-hosted-foundation-design.md`

## Global Constraints

- Canonical production origin is exactly `https://mykairos.me`.
- Production persistence is Cloudflare D1; no filesystem SQLite may be used on the Workers runtime path.
- Initial Kairos sign-in providers are Google and Microsoft.
- Kairos identity authorization is separate from Google/Microsoft calendar authorization.
- Client input never selects the effective authenticated `userId`.
- Google and Microsoft identities are not automatically linked merely because they report the same email address.
- Local development must exercise a D1-compatible environment; production secrets are never reused in CI.
- Existing local `.data/assignments.sqlite` credentials are not uploaded to hosted Kairos.
- Production deployment remains disabled until Plans 6A, 6B, and 6C are complete.

## Review Focus

- A second OAuth provider reporting the same email as an existing account must fail closed rather than silently linking; Task 3 adds the config test.
- An unauthenticated session must never yield a synthetic/default user scope; Task 3 adds the explicit rejection test.
- A D1 migration rerun must remain idempotent and preserve previously inserted rows; Task 2 adds a double-apply verification.
- Traditional Next.js build compatibility must not mask a vinext incompatibility; Task 1 runs and records both compatibility/build checks.
- Cloudflare environment bindings must be absent from client bundles; Task 1 adds a server-only import/config assertion.

---

### Task 1: Add the vinext/Workers runtime and D1 binding

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `vite.config.ts`
- Create: `wrangler.jsonc`
- Create: `docs/superpowers/compatibility/2026-10-06-vinext-check.md`
- Create: `tests/unit/cloudflare-runtime-config.test.ts`

**Interfaces:**
- Consumes: existing Next.js 16 App Router project.
- Produces: scripts `dev:vinext`, `build:vinext`, `deploy:cloudflare`, D1 binding name `DB`, database name `kairos`, and a documented compatibility result for later tasks.

- [ ] **Step 1: Write the failing runtime-config test**

Create `tests/unit/cloudflare-runtime-config.test.ts` with assertions that:
- `package.json` contains `dev:vinext` and `build:vinext`;
- `wrangler.jsonc` declares one D1 binding named `DB` with database name `kairos`;
- `vite.config.ts` imports vinext and Cloudflare Vite support;
- no client-side file imports `cloudflare:workers`.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/unit/cloudflare-runtime-config.test.ts`  
Expected: FAIL because vinext/Workers configuration does not exist yet.

- [ ] **Step 3: Record the pre-migration compatibility check**

Run: `npx vinext check` and save the exact report summary in `docs/superpowers/compatibility/2026-10-06-vinext-check.md`.

Expected: the report may flag the known Node/`better-sqlite3` path; any additional blocking vinext incompatibility must be recorded as a ruling before implementation continues. If vinext itself is blocked independently of legacy SQLite, use the spec-approved OpenNext fallback instead of silently changing the hosting architecture.

- [ ] **Step 4: Initialize vinext for Cloudflare**

Run: `npx vinext init --platform=cloudflare --legacy-wrangler-cloudflare-init`.

Retain the generated `vite.config.ts`, add/update `wrangler.jsonc` so the binding is exactly `DB` and the database name is `kairos`, and keep normal Next.js scripts available for the compatibility gate.

Add `deploy:cloudflare` using `npx @vinext/cloudflare deploy`.

- [ ] **Step 5: Run runtime verification**

Run:
- `npm test -- tests/unit/cloudflare-runtime-config.test.ts`
- `npm run build`
- `npm run build:vinext`

Expected: config test PASS; both builds either PASS or the only remaining vinext blocker is the explicitly documented legacy SQLite runtime, which Plan 6B removes. Do not accept unrelated vinext errors.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore vite.config.ts wrangler.jsonc docs/superpowers/compatibility/2026-10-06-vinext-check.md tests/unit/cloudflare-runtime-config.test.ts
git commit -m "build: add Cloudflare Workers runtime"
```

### Task 2: Add explicit D1 migrations and migration verification

**Files:**
- Create: `migrations/0001_auth.sql`
- Create: `migrations/0002_kairos_tenant_schema.sql`
- Create: `scripts/verify-d1-migrations.mjs`
- Create: `tests/integration/d1-schema-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: D1 binding/database name from Task 1.
- Produces: Auth.js tables `users`, `accounts`, `sessions`, `verification_tokens`; tenant-ready Kairos tables with explicit `user_id`; scripts `db:migrate:local` and `db:verify`.

- [ ] **Step 1: Write the failing schema-contract test**

Create `tests/integration/d1-schema-contract.test.ts` that reads the migration SQL and asserts:
- all four Auth.js adapter tables exist;
- `source_connections` has `PRIMARY KEY (user_id, id)` and `UNIQUE (user_id, kind)`;
- `assignments` has a composite FK to `source_connections(user_id, id)`;
- `calendar_connections`, `calendar_event_links`, `app_settings`, and request-state tables carry `user_id`;
- `app_settings` has `PRIMARY KEY (user_id, key)`;
- no credential column is named as if plaintext storage were intentionally permanent (credential envelopes are finalized in 6B).

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/integration/d1-schema-contract.test.ts`  
Expected: FAIL because D1 migration files do not exist.

- [ ] **Step 3: Create the migrations**

Use the current `@auth/d1-adapter` schema for Auth.js table names/columns in `0001_auth.sql`.

In `0002_kairos_tenant_schema.sql`, create the tenant-owned equivalents of the current Kairos domain tables. Include owner-preserving composite keys/FKs for:
- source connections/credentials/courses;
- assignments/submission state/sync state/assignment links;
- calendar connections/credentials/event links;
- settings;
- durable browser-sync request state;
- durable calendar OAuth request state.

Production starts from an empty D1 database; do not write a migration that imports local `.data` files.

- [ ] **Step 4: Add local migration/verification scripts**

Add:
- `db:migrate:local`: `npx wrangler d1 migrations apply kairos --local`
- `db:verify`: `node scripts/verify-d1-migrations.mjs`

`verify-d1-migrations.mjs` must apply migrations to an isolated local Wrangler persistence directory, insert Alice and Bob rows, prove a valid same-user FK succeeds, prove a cross-user FK fails, rerun migrations, and prove the Alice/Bob rows remain.

- [ ] **Step 5: Run schema verification**

Run:
- `npm test -- tests/integration/d1-schema-contract.test.ts`
- `npm run db:verify`

Expected: PASS; cross-user FK insertion is rejected; migration reapplication preserves existing rows.

- [ ] **Step 6: Commit**

```bash
git add migrations scripts/verify-d1-migrations.mjs tests/integration/d1-schema-contract.test.ts package.json
git commit -m "feat: add tenant-ready D1 schema"
```

### Task 3: Add Auth.js and the authenticated UserScope boundary

**Files:**
- Create: `src/lib/auth/config.ts`
- Create: `src/lib/auth/user-scope.ts`
- Create: `auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `tests/unit/auth-config.test.ts`
- Create: `tests/unit/user-scope.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: D1 `DB` binding and Auth.js tables from Task 2.
- Produces:
  - `type UserScope = { userId: string }`
  - `requireUserScope(getSession?: () => Promise<Session | null>): Promise<UserScope>`
  - Auth.js exports `handlers`, `auth`, `signIn`, `signOut`
  - `createAuthConfig(db: D1Database, env: AuthEnvironment): NextAuthConfig`

- [ ] **Step 1: Write failing user-scope tests**

`tests/unit/user-scope.test.ts` must prove:
- a session with `session.user.id="alice"` yields `{userId:"alice"}`;
- null session rejects with a stable unauthenticated error;
- a session missing a durable user ID rejects rather than synthesizing one.

- [ ] **Step 2: Write failing Auth configuration tests**

`tests/unit/auth-config.test.ts` must prove:
- only Google and Microsoft identity providers are configured;
- the D1 adapter is configured;
- no option enables unsafe automatic account linking by email;
- identity provider scope configuration does not include Google Calendar or Microsoft `Calendars.ReadWrite` scopes.

- [ ] **Step 3: Run the tests to verify RED**

Run: `npm test -- tests/unit/user-scope.test.ts tests/unit/auth-config.test.ts`  
Expected: FAIL because the auth boundary does not exist.

- [ ] **Step 4: Implement Auth.js configuration**

Install `next-auth` and `@auth/d1-adapter`.

Implement `createAuthConfig(db, env)` with Google and Microsoft identity-only providers. Keep provider client secrets in environment bindings only. Do not enable automatic provider linking.

Implement root `auth.ts` by loading the server-side `DB` binding and secrets, then exporting the standard Auth.js handlers/session helpers.

- [ ] **Step 5: Implement `requireUserScope`**

Use the server-side session as the sole source of `userId`. Define one stable auth error class/code for unauthenticated application APIs; do not accept a client-supplied user ID.

- [ ] **Step 6: Run auth tests**

Run: `npm test -- tests/unit/user-scope.test.ts tests/unit/auth-config.test.ts`  
Expected: PASS.

- [ ] **Step 7: Run type/build checks**

Run:
- `npm run typecheck`
- `npm run build:vinext`

Expected: PASS without bundling server secrets into client code.

- [ ] **Step 8: Commit**

```bash
git add auth.ts src/lib/auth src/app/api/auth .env.example package.json tests/unit/auth-config.test.ts tests/unit/user-scope.test.ts
git commit -m "feat: add hosted user authentication"
```

### Task 4: Establish the tenant-scope test harness and 6A gate

**Files:**
- Create: `tests/helpers/test-users.ts`
- Create: `tests/integration/tenant-scope-contract.test.ts`
- Modify: `.github/workflows/milestone-2-ci.yml`
- Modify: `docs/superpowers/ROADMAP.md`

**Interfaces:**
- Consumes: D1 schema and `UserScope` from Tasks 2–3.
- Produces: shared Alice/Bob fixtures for Plan 6B and CI gates for D1 migration + Workers build.

- [ ] **Step 1: Write the failing tenant-scope contract test**

Create Alice/Bob fixtures and a contract test that:
- proves distinct user IDs/sessions remain distinct;
- proves a user scope can never be constructed from request JSON alone;
- applies the tenant schema and confirms owner-preserving composite FKs reject an Alice-child/Bob-parent association.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/integration/tenant-scope-contract.test.ts`  
Expected: FAIL until the helper/test database wiring exists.

- [ ] **Step 3: Implement the shared test helpers**

Keep helpers test-only. They may create mock Auth.js session objects and invoke the local D1 verification harness, but must not introduce a production bypass for authentication.

- [ ] **Step 4: Extend CI**

Add exact gates:
- `npm run db:verify`
- `npm run build:vinext`

Keep existing Vitest, lint, typecheck, extension, E2E, standard build, and prohibited-credential checks.

Do not add a production deployment step yet.

- [ ] **Step 5: Run the complete 6A verification set**

Run:
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run db:verify`
- `npm run build`
- `npm run build:vinext`

Expected: all PASS. If the legacy SQLite runtime is still the only vinext blocker, it must be explicitly documented and the branch must remain non-deployable until Plan 6B removes it.

- [ ] **Step 6: Update roadmap execution status**

Change Milestone 6 wording from “implementation not started” to “implementation in progress — 6A foundation complete” only after the verification set passes.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/test-users.ts tests/integration/tenant-scope-contract.test.ts .github/workflows/milestone-2-ci.yml docs/superpowers/ROADMAP.md
git commit -m "test: gate hosted authentication foundation"
```
