# Milestone 6C — Production Boundary and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the production boundary for `mykairos.me`: public/protected routing, account deletion, hosted OAuth origins, Firefox production-origin support, CI/deployment gates, and production-like multi-user acceptance.

**Architecture:** Build on the fully tenant-scoped D1 system from Plans 6A–6B. Public pages remain unauthenticated, dashboard/API state requires `UserScope`, production callback/origin rules are exact and environment-driven, the extension trusts only localhost plus `https://mykairos.me`, and deployment remains a controlled external action after all automated gates pass.

**Tech Stack:** Next.js/vinext, Auth.js, Cloudflare Workers + D1, Firefox WebExtension MV3, GitHub Actions, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-multi-user-hosted-foundation-design.md`

## Global Constraints

- Canonical production origin is exactly `https://mykairos.me`.
- Public routes are limited to homepage, privacy/terms, Auth.js routes, and valid OAuth callbacks; user data routes require authentication.
- Safe return targets are same-origin application paths only.
- Account deletion can target only the current authenticated user.
- Deletion must not silently delete third-party calendars.
- Firefox Kairos bridge accepts only localhost/127.0.0.1 development origins and `https://mykairos.me`.
- Production/provider secrets live outside the repository and must never be echoed by CI.
- Automatic production deployment is not enabled until a manual deployment and rollback path are validated.
- Real hosted provider smoke tests use real accounts/credentials outside committed fixtures and chat.

## Review Focus

- A malicious `returnTo=https://evil.example` or protocol-relative target must never redirect off-origin; Task 1 adds tests.
- Account deletion racing another request must not leave another user's rows deleted or current-user sessions alive; Task 2 adds isolation/session tests.
- A lookalike origin such as `https://mykairos.me.evil.example` must never activate the extension bridge; Task 4 adds exact-origin tests.
- A preview deployment must not accidentally use production D1/secrets; Task 5 adds configuration assertions.
- A failed database migration/deployment must not automatically advance production traffic; Task 6 keeps deploy gated and adds dry-run/rollback checks.

---

### Task 1: Add public pages, protected routing, and safe return targets

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/privacy/page.tsx`
- Create: `src/app/terms/page.tsx`
- Create: `src/app/sign-in/page.tsx`
- Create: `src/lib/auth/return-to.ts`
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/layout.tsx`
- Create: `tests/unit/safe-return-to.test.ts`
- Create: `tests/component/public-pages.test.tsx`
- Modify: `tests/component/dashboard-states.test.tsx`

**Interfaces:**
- Consumes: Auth.js helpers and `requireUserScope` from Plan 6A.
- Produces `safeReturnTo(input:string|null, fallback="/upcoming"): string`.

- [ ] **Step 1: Write failing return-target tests**

Assert allowed values such as `/upcoming` and `/sources?tab=calendar` pass; reject absolute URLs, `//evil.example`, encoded protocol-relative forms, backslash tricks, and non-application schemes to `/upcoming`.

- [ ] **Step 2: Write failing public/protected route tests**

Assert:
- homepage renders product/unofficial-UW statement and sign-in actions without a session;
- privacy/terms render signed out;
- dashboard layout requires a valid scope and does not render user data when unauthenticated.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/unit/safe-return-to.test.ts tests/component/public-pages.test.tsx tests/component/dashboard-states.test.tsx`  
Expected: FAIL.

- [ ] **Step 4: Implement public shell and route protection**

Replace root redirect with a public homepage. Keep copy factual and concise; do not claim official UW affiliation or unsupported compliance.

Resolve scope before any dashboard D1 reads. Use `safeReturnTo` everywhere a sign-in or OAuth flow carries a return target.

- [ ] **Step 5: Run GREEN**

Run the same tests.  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app src/lib/auth/return-to.ts tests/unit/safe-return-to.test.ts tests/component
git commit -m "feat: add hosted public and protected routes"
```

### Task 2: Add self-service account deletion

**Files:**
- Create: `src/lib/account/delete-account.ts`
- Create: `src/app/api/account/route.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/features/account/delete-account-control.tsx`
- Create: `tests/integration/account-deletion.test.ts`
- Modify: `tests/component/settings.test.tsx`

**Interfaces:**
- Consumes: D1, `UserScope`, Auth.js session tables.
- Produces `deleteCurrentAccount(db, scope): Promise<void>` and authenticated `DELETE /api/account`.

- [ ] **Step 1: Write failing deletion tests**

Seed Alice/Bob with source/calendar/settings/request/session rows. Assert:
- deleting Alice removes all Alice-owned Kairos rows and Alice Auth.js account/session rows;
- Bob remains untouched;
- client cannot pass a target user ID;
- third-party remote calendar deletion is not attempted;
- deleted Alice session no longer authenticates.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/account-deletion.test.ts tests/component/settings.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement transactional deletion**

Delete by current `scope.userId` only. Prefer FK cascades for domain rows; explicitly remove Auth.js rows where adapter schema does not cascade as needed. Require an explicit destructive confirmation field that is not a user ID.

- [ ] **Step 4: Add settings UI**

Explain that remote provider data/calendars are not silently removed and direct users to **Remove generated events** before deletion if desired.

- [ ] **Step 5: Run GREEN**

Run same tests.  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/account src/app/api/account src/app/(dashboard)/settings/page.tsx src/features/account tests
git commit -m "feat: add hosted account deletion"
```

### Task 3: Make production OAuth origins/configuration exact and hosted-safe

**Files:**
- Modify: `src/lib/calendar/local-oauth-origin.ts` (rename to `oauth-origin.ts` if clearer)
- Modify: `src/lib/calendar/google/oauth.ts`
- Modify: `src/lib/calendar/microsoft/oauth.ts`
- Modify: `src/app/api/calendars/google/start/route.ts`
- Modify: `src/app/api/calendars/microsoft/start/route.ts`
- Modify: `.env.example`
- Modify: `tests/unit/google-calendar-oauth.test.ts`
- Modify: `tests/unit/microsoft-calendar-oauth.test.ts`
- Modify: `tests/integration/calendar-oauth-api.test.ts`

**Interfaces:**
- Produces `getOAuthRedirectUri(requestUrl, callbackPath, env): string` supporting only:
  - local `http://localhost[:port]` / `http://127.0.0.1[:port]` in development;
  - exact configured `https://mykairos.me` in production.

- [ ] **Step 1: Write failing origin tests**

Assert production generates:
- `https://mykairos.me/api/calendars/google/callback`
- `https://mykairos.me/api/calendars/microsoft/callback`.

Reject HTTP production, sibling/lookalike hosts, embedded credentials, protocol-relative paths, and arbitrary forwarded/request hosts.

- [ ] **Step 2: Run RED**

Run OAuth unit/integration tests.  
Expected: FAIL while helper is localhost-only.

- [ ] **Step 3: Implement exact environment-driven origin**

Use a configured canonical application URL rather than trusting incoming host headers for production callback construction.

Keep Google Web app secret optional only where provider configuration permits; require Microsoft confidential Web client secret for production calendar token redemption as decided in the spec.

- [ ] **Step 4: Run GREEN**

Run OAuth suites.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar src/app/api/calendars .env.example tests
git commit -m "feat: support hosted calendar oauth origins"
```

### Task 4: Add the production Kairos origin to the Firefox bridge

**Files:**
- Modify: `extension/firefox/manifest.json`
- Modify: `extension/firefox/src/content/kairos-bridge.ts`
- Modify: `extension/firefox/tests/manifest.test.ts`
- Create: `extension/firefox/tests/kairos-bridge-origin.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces one shared/duplicated-but-test-locked allowlist containing exactly:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - `https://mykairos.me`.

- [ ] **Step 1: Write failing manifest/origin tests**

Assert:
- manifest content-script matches include `https://mykairos.me/*`;
- bridge allowlist includes exact production origin;
- no wildcard `https://*`, `<all_urls>`, cookie, history, downloads, or webRequest permission;
- lookalike origins are rejected.

- [ ] **Step 2: Run RED**

Run: `npm test -- extension/firefox/tests/manifest.test.ts extension/firefox/tests/kairos-bridge-origin.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement exact origin support**

Keep event source/origin/schema/request-ID validation unchanged.

Update README development vs hosted-extension instructions without claiming AMO distribution (that is Milestone 7).

- [ ] **Step 4: Run GREEN**

Run:
- origin/manifest tests;
- `npm run build:extension`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension README.md
git commit -m "feat: allow hosted Kairos extension bridge"
```

### Task 5: Add production configuration validation and deployment runbook

**Files:**
- Create: `src/lib/platform/production-config.ts`
- Create: `tests/unit/production-config.test.ts`
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Create: `docs/deployment/cloudflare.md`
- Create: `docs/deployment/dns.md`

**Interfaces:**
- Produces `validateProductionConfig(env): ProductionConfig` that requires canonical URL, `AUTH_URL=https://mykairos.me`, D1 binding, Auth.js provider configuration, calendar clients, and key identifiers without logging values.

- [ ] **Step 1: Write failing production-config tests**

Assert missing required names yield stable configuration errors containing variable names but never configured values. Assert `AUTH_URL` and the canonical application URL are exactly `https://mykairos.me` in production. Assert preview/test configuration cannot reference the production D1 database ID in checked-in config.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/production-config.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement validation and docs**

`docs/deployment/dns.md` must instruct the operator to inventory existing Namecheap DNS records before nameserver changes and never paste secret values into the repo/chat.

`docs/deployment/cloudflare.md` documents D1 creation/migrations, secret names, vinext build/deploy command, and manual smoke/rollback prerequisites. Use placeholders for account/database IDs.

- [ ] **Step 4: Run GREEN**

Run unit test and secret-pattern scan.  
Expected: PASS with no real secret-like values committed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform tests/unit/production-config.test.ts wrangler.jsonc .env.example docs/deployment
git commit -m "docs: add production deployment configuration"
```

### Task 6: Extend CI with tenant/D1/Workers deployment gates

**Files:**
- Modify: `.github/workflows/milestone-2-ci.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `scripts/verify-production-safety.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `verify:hosted` script and a manually triggered production deployment workflow that does not auto-run on branch pushes.

- [ ] **Step 1: Write the failing safety verifier**

`verify-production-safety.mjs` must fail if:
- E2E fixture mode is enabled for production config;
- production source imports `better-sqlite3`;
- extension production origin is missing or wildcarded;
- required CI commands are absent;
- deploy workflow is automatically triggered from arbitrary feature branches;
- checked-in production config contains real secret values instead of bindings/placeholders.

Add a unit/integration invocation test if useful.

- [ ] **Step 2: Run RED**

Run: `node scripts/verify-production-safety.mjs`  
Expected: FAIL before CI/deploy workflow is complete.

- [ ] **Step 3: Extend feature CI**

Required sequence:
- install;
- Vitest;
- lint;
- typecheck;
- D1 migration verification;
- Firefox extension build;
- E2E;
- standard Next build if still supported;
- vinext Workers build;
- dynamic-dashboard verification;
- production-safety verifier;
- prohibited credential/permission scan.

- [ ] **Step 4: Add manual production deployment workflow**

Use GitHub environment secrets and explicit `workflow_dispatch`. Apply remote D1 migrations only in the production job, build vinext, then deploy. Do not print secrets. Keep automatic deployment disabled until a manual deployment/rollback is proven.

- [ ] **Step 5: Run local verifier and workflow syntax checks**

Run:
- `node scripts/verify-production-safety.mjs`
- complete local CI command set.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows scripts/verify-production-safety.mjs package.json
git commit -m "ci: gate hosted production deployment"
```

### Task 7: Add deterministic two-user hosted E2E coverage

**Files:**
- Create: `tests/e2e/multi-user-isolation.spec.ts`
- Modify: `tests/e2e/canvas-onboarding.spec.ts`
- Modify: `tests/e2e/gradescope-sync.spec.ts`
- Modify: `tests/e2e/calendar-sync.spec.ts`
- Modify: `playwright.config.ts`
- Modify: test fixture routes under `src/app/api/test-fixtures/**/route.ts`

**Interfaces:**
- Consumes: Auth.js test-session fixture mechanism that is enabled only when `E2E_FIXTURES=1`.
- Produces deterministic Alice/Bob browser sessions without any production auth bypass.

- [ ] **Step 1: Write failing two-user E2E**

Prove:
- Alice and Bob each see only their own seeded assignment/source/calendar state;
- known Alice IDs cannot be acted upon from Bob's browser;
- sign-out removes access to dashboard;
- extension bridge fixture results persist only to the signed-in user.

- [ ] **Step 2: Run RED**

Run: `npm run test:e2e -- --grep "multi-user isolation"`  
Expected: FAIL.

- [ ] **Step 3: Add fixture-only auth/session setup**

Fixture auth/session routes must return 404 unless `E2E_FIXTURES=1`; production-safety verifier must reject enabling this in deployment config.

- [ ] **Step 4: Run GREEN**

Run full Playwright suite.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e playwright.config.ts src/app/api/test-fixtures
git commit -m "test: cover hosted multi-user isolation"
```

### Task 8: Complete automated verification and prepare the manual hosted acceptance gate

**Files:**
- Create: `docs/deployment/acceptance-milestone-6.md`
- Modify: `README.md`
- Modify: `docs/superpowers/ROADMAP.md`

**Interfaces:**
- Consumes: all 6A–6C outputs.
- Produces exact manual acceptance checklist for Google/Microsoft sign-in, Google/Microsoft/iCloud calendar hosted flows, extension at `mykairos.me`, account deletion, and rollback.

- [ ] **Step 1: Write the acceptance checklist**

Include two independent users and require:
- independent dashboards/data;
- cross-user attempts fail;
- hosted Google and Microsoft identity sign-in;
- hosted Google/Microsoft calendar connect/reconnect/sync;
- hosted iCloud CalDAV connect/sync;
- extension bridge at production origin;
- account deletion only removes current user;
- no plaintext credential visible in D1/API/UI/logs;
- rollback procedure.

No real credential values belong in the checklist.

- [ ] **Step 2: Run the complete automated gate**

Run:
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run db:verify`
- `npm run build:extension`
- `npm run test:e2e`
- `npm run build`
- `npm run build:vinext`
- `node scripts/verify-dynamic-dashboard-build.mjs`
- `node scripts/verify-production-safety.mjs`.

Expected: all PASS.

- [ ] **Step 3: Update README/roadmap to “automated implementation complete, hosted acceptance pending”**

Do not mark Milestone 6 complete until the external/manual acceptance checklist passes.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment/acceptance-milestone-6.md README.md docs/superpowers/ROADMAP.md
git commit -m "docs: prepare hosted milestone 6 acceptance"
```

- [ ] **Step 5: Stop for the external deployment/credential gate**

Production DNS changes, Cloudflare resource creation, secret entry, OAuth-console updates, real-account sign-ins, and actual deployment are external/security-sensitive side effects. The executor must present the exact checklist and obtain the user's explicit go-ahead before performing or guiding those account changes.

After the user completes/passes the hosted acceptance, record only pass/fail evidence and non-secret identifiers in docs; never store credentials.
