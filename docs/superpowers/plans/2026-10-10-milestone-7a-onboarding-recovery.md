# Milestone 7A Onboarding and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give new users resumable optional setup and established users direct dashboard access with targeted recovery.

**Architecture:** Reuse the existing dashboard providers/cards and user-scoped D1 settings. Store revision-checked onboarding state and encrypted secret candidates separately from working connections; derive health from current repositories. Guard dashboard entry with a server-owned pathname and retain safe OAuth return paths through setup.

**Tech Stack:** React, vinext/Next.js, Auth.js, D1, existing AES-GCM envelopes, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-public-beta-readiness-design.md`, sections 4-6 and 15. Parent: `2026-10-10-milestone-7-public-beta.md`.

## Global Constraints

- Only account authentication is mandatory. Every integration step is skippable.
- Order: timezone, Firefox install/verify, Canvas feed, optional Canvas submission status, optional Gradescope, optional Ed, optional calendar, finish into Upcoming.
- Back/resume preserves entered or connected state; failed replacements preserve working credentials and prior assignment/status data.
- Established users bypass onboarding. Recovery/setup prompts are compact and nonblocking.
- UW-first; no arbitrary Canvas institution, email-domain eligibility, or automatic identity account linking.
- Never echo a stored secret or envelope into API, HTML, browser storage, bridge payload, or log.

## Review Focus

1. An established account has no sources: Task 1 backfills every pre-cutover user, not merely connected users.
2. A new user returns from identity OAuth to a deep dashboard link: Task 3 guards all dashboard entries and excludes onboarding to avoid loops.
3. Back/reload loses a secret candidate or saves it over the working credential: Task 2 tests encrypted draft reuse and failed candidate validation.
4. Multi-tab edits/OAuth departures overwrite progress: Tasks 1-3 use revision compare-and-swap and persist before departure.
5. Parser/storage outages erase data or demand reconnect: Tasks 4-5 test failure-safe commits and cause-specific guidance.

## Task 1: User-scoped progress and the cutover migration

**Files:** Create `migrations/0004_onboarding_state.sql`, `src/lib/onboarding/types.ts`, `src/lib/onboarding/state.ts`, `src/lib/db/d1/repositories/onboarding.ts`, `src/app/api/settings/onboarding/route.ts`, `tests/unit/onboarding-state.test.ts`, `tests/integration/onboarding-repository.test.ts`, `tests/integration/onboarding-api.test.ts`. Modify migration loading and transactional `batch()` in `tests/helpers/d1-test-db.ts`; coordinate with 7B's `0005` migration and `scripts/verify-d1-migrations.mjs`.

**Interfaces:**
- `OnboardingStep = "timezone" | "firefox" | "canvas" | "submission-status" | "gradescope" | "ed" | "calendars" | "finish"`.
- `OnboardingState = {version: 1; revision: number; status: "active" | "deferred" | "completed"; currentStep: OnboardingStep; skipped: IntegrationStep[]; drafts: {timeZone?: string; gradescopeCourseIds?: string[]; edCourseIds?: string[]}}`; `IntegrationStep` excludes timezone/finish. No secrets in this JSON.
- `OnboardingCommand = {type: "visit"; step: OnboardingStep} | {type: "skip"; step: IntegrationStep} | {type: "save-draft"; drafts: OnboardingState["drafts"]} | {type: "defer" | "resume" | "finish"}`.
- `D1OnboardingRepository(db, scope).ensureInitialized(): Promise<OnboardingState>`, `.get(): Promise<OnboardingState | null>`, `.apply(command: OnboardingCommand, expectedRevision: number): Promise<OnboardingState>`.
- GET onboarding returns current state; PATCH applies a validated command/revision. Stale writes: HTTP 409 `ONBOARDING_CONFLICT`; no lost edits.

- [ ] Red tests: `empty_pre_cutover_user_bypasses`, `post_cutover_user_starts_active`, `initialization_is_idempotent`, `tenant_state_isolated`, `stale_revision_preserves_progress`, `completed_state_cannot_reopen_accidentally`.
- [ ] Run `npm test -- tests/unit/onboarding-state.test.ts tests/integration/onboarding-repository.test.ts tests/integration/onboarding-api.test.ts`; new assertions fail.
- [ ] Store JSON under `app_settings.key='onboarding'`; initialize via insert-if-absent and update via revision/value compare-and-swap. Bound payload/array sizes and validate timezone/course-ID formats.
- [ ] Backfill **all users present at migration cutover** as completed and preserve their existing submission refresh behavior. `users` has no creation timestamp; do not infer age from source presence. New users initialize active, with optional submission refresh disabled.
- [ ] Correct test D1 batches to transactionally roll back on any statement failure. Load all ordered migrations; test pre-cutover seeding separately instead of seeding users after all migrations and assuming they are established.
- [ ] Run targeted tests and `npm run db:verify`; review proposed commit `feat(onboarding): persist tenant-scoped setup progress`.

## Task 2: Privately saved candidate inputs

**Files:** Create `src/lib/db/d1/repositories/onboarding-drafts.ts`, `src/lib/onboarding/draft-service.ts`, `src/app/api/settings/onboarding/draft/route.ts`, `tests/integration/onboarding-drafts.test.ts`. Modify `src/lib/security/credential-types.ts` and `tests/integration/hosted-credential-privacy.test.ts`; coordinate common connection services with Task 4 and admission with 7B.

**Interfaces:**
- `SecretDraft = {kind: "canvas"; feedUrl: string} | {kind: "ed"; token: string} | {kind: "caldav"; username: string; secret: string}`.
- `saveOnboardingDraft(runtime: SourceRuntimeContext, draft: SecretDraft): Promise<{kind: SecretDraft["kind"]; saved: true}>`.
- `useOnboardingDraft(runtime: SourceRuntimeContext, kind: SecretDraft["kind"], action: "test" | "connect"): Promise<Response>` delegates to the same admission/connection services as ordinary connect/test routes; it cannot bypass rate limits or provider switches.
- PUT draft saves; GET returns availability/kind metadata only; POST tests/connects; DELETE discards. No plaintext/envelope response.

- [ ] Red tests: `back_and_reload_can_reuse_saved_candidate`, `failed_candidate_keeps_working_credential`, `cross_user_draft_access_rejected`, `drafts_never_appear_in_public_html_api_storage_or_bridge`, `finishing_clears_candidates`.
- [ ] Run `npm test -- tests/integration/onboarding-drafts.test.ts tests/integration/hosted-credential-privacy.test.ts`; new behaviors fail.
- [ ] Add `onboarding_draft` purpose. Store bounded encrypted candidates in separate `app_settings` keys, using context `onboarding:<kind>` and the user's AAD. Include these envelopes in 7C rotation. Never reuse live-credential keys for candidate inputs.
- [ ] Wizard keeps visible input edits in memory on Back and saves before leaving a step/OAuth departure. On reload show “Saved privately” with reuse/replace/discard controls rather than return the secret. Clear after successful connect, explicit discard, or finish; account deletion cascades through settings.
- [ ] Run targeted privacy/reuse tests; review proposed commit `feat(onboarding): preserve encrypted setup candidates`.

## Task 3: Wizard, route guard, and integration opt-in

**Files:** Create `src/app/(dashboard)/onboarding/page.tsx`, `src/features/onboarding/onboarding-wizard.tsx`, `src/features/onboarding/firefox-setup-step.tsx`, `src/features/settings/timezone-control.tsx`, `src/app/api/settings/submission-status/route.ts`, `tests/component/onboarding-wizard.test.tsx`. Modify `src/app/(dashboard)/layout.tsx`, `src/proxy.ts`, `src/lib/auth/return-to.ts`, `src/lib/db/d1/repositories/settings.ts`, `src/features/sources/canvas-source-card.tsx`, `src/features/sources/gradescope-source-card.tsx`, `src/features/sources/ed-source-card.tsx`, `src/features/sources/calendar-destinations.tsx`, `src/features/sources/icloud-calendar-card.tsx`, and `src/features/submission-status/submission-status-provider.tsx`; extend their existing component tests. Integrator owns proxy/callback edits shared with 7B.

**Interfaces:**
- `resolveDashboardEntry(state: OnboardingState, pathname: string): "/onboarding" | null`; active users on dashboard routes go to onboarding; deferred/completed users remain; onboarding itself never redirects to itself.
- Proxy overwrites inbound `x-kairos-pathname` with its own validated `request.nextUrl.pathname` on exact dashboard/onboarding matcher entries. Shared layout reads it; no client-supplied header may suppress the guard. Verify request-header forwarding in both Next compatibility and vinext/workerd before relying on it.
- `CanvasSourceCard({connection, onConnected?}: {connection: SourceConnection | null; onConnected?: (connection: SourceConnection) => Promise<void>}): React.JSX.Element`; default retains Sources navigation; onboarding callback persists progress then refreshes onboarding/provider state.
- `D1SettingsRepository.getCanvasSubmissionStatusEnabled(): Promise<boolean>` and `.setCanvasSubmissionStatusEnabled(enabled: boolean): Promise<void>`; normal authenticated preference API.
- Firefox step consumes 7C `getFirefoxDistribution()` and existing `pingKairosExtension()`. OAuth start accepts a validated `/onboarding` return target; callbacks preserve it on success/denial/error, with fixed error codes.

- [ ] Red tests cover ordered steps, Back preservation, one-source finish, all skips, absent Firefox, explicit submission opt-in, defer/resume, spoofed path header, authenticated deep-link entry, completed users, and no redirect loop.
- [ ] Run `npm test -- tests/component/onboarding-wizard.test.tsx tests/integration/onboarding-api.test.ts`; route/guard tests must also exercise real proxy forwarding.
- [ ] Render the ordered wizard with Back/Continue/Skip and “Save for later”. Finish requires no integration. Skipping preserves any working connections. New users opt into browser submission refresh only on its optional step; established users retain prior behavior.
- [ ] Reuse cards/providers and draft service; persist state before OAuth. Use a real signed AMO link when available, otherwise truthful pending availability plus Skip. Firefox absence cannot block Canvas feed/Ed setup.
- [ ] Keep timezone control reusable and keyboard/mobile accessible; accept valid IANA zones beyond the current five preset options. Return to Upcoming after completion.
- [ ] Run component/API/route tests and targeted browser smoke; review proposed commit `feat(onboarding): add resumable optional first-run setup`.

## Task 4: Failure-safe connection replacement

**Files:** Create `src/lib/sources/canvas-ical/connection-service.ts`, `tests/integration/hosted-connection-recovery.test.ts`. Modify Canvas connect route, `src/lib/ed/discovery-service.ts`, `src/lib/gradescope/discovery-service.ts`, `src/lib/calendar/connection-service.ts`, affected D1 connection/credential/course/assignment repositories, and existing hosted source/calendar tests. Coordinate 7B durable sync ownership around candidate operations.

**Interfaces:**
- `connectCanvas(runtime: SourceRuntimeContext, input: {feedUrl: string; label?: string}): Promise<{connection: SourceConnection; sync: SyncSummary}>`.
- Repository statement-building methods return `D1PreparedStatementLike` for one atomic `db.batch()` covering related metadata/envelopes/assignments/course selections; preserve existing public async methods where callers still need them.
- The draft and ordinary APIs consume the same validated service functions, with one admission debit and one resource owner per operation.

- [ ] Red tests inject invalid replacement feed, second-fetch/parser failure, invalid Ed/iCloud candidate, encryption failure, middle-of-batch failure, and remote-calendar absence. Assert old credentials, data, selections, links/remote IDs, and successful freshness remain usable.
- [ ] Run `npm test -- tests/integration/hosted-connection-recovery.test.ts`; regression failures reproduce actual pre-commit replacement risks.
- [ ] Canvas fetches/parses/normalizes the candidate before storing it; commit the accepted snapshot once rather than overwrite first and then refetch. Keep ordinary partial-sync retention behavior.
- [ ] Ed validates/discovers before an atomic credential/course/metadata commit. Preserve user course selection through rediscovery. Apply atomic local discovery/selection commits for Gradescope.
- [ ] Calendar validates authorization/writable remote calendar before atomically replacing credential/metadata. Retain connection IDs/event mappings. Missing remote calendar requires an explicit recovery decision before recreation; do not delete remote data to compensate for local D1 failure.
- [ ] Run existing hosted privacy/source/calendar regression tests; review proposed commit `fix(connections): retain working state through failed replacement`.

## Task 5: Returning-user prompts and account settings

**Files:** Create `src/lib/recovery/presentation.ts`, `src/features/recovery/recovery-prompts.tsx`, `src/lib/account/account-summary.ts`, `src/features/settings/settings-content.tsx`, `tests/unit/recovery-presentation.test.ts`, `tests/component/recovery-prompts.test.tsx`. Modify settings page/dashboard layout, source/calendar providers/cards, `src/app/sign-in/page.tsx`, and `tests/component/settings.test.tsx` centrally.

**Interfaces:**
- `getAccountSummary(db: D1DatabaseLike, scope: UserScope): Promise<{name: string | null; email: string | null; identityProvider: "google" | "microsoft" | "unknown"}>`; only this user's selected account fields, never provider account IDs/tokens/session rows.
- `RecoveryNotice = {key: string; message: string; action: "connect" | "verify-extension" | "sign-in-and-retry" | "retry" | "reconnect" | "recreate"; href?: string; retryAfterSeconds?: number}`; presentation derives only from validated stable codes.
- Rate/service errors consume 7B's safe codes and bounded Retry-After; no automatic rapid retry loop.

- [ ] Red tests: storage/hosting outage offers Retry, not Reconnect; expired authorization offers Reconnect; missing remote calendar explains recreation; parser failure explains retained data; missing extension prompts only when relevant; unrelated controls stay usable; identity summary never crosses users.
- [ ] Run recovery/settings/card tests; new behaviors fail.
- [ ] Add compact dismissible no-source/resume/no-successful-sync/reconnect prompts without redirecting returning users. Map signed-out tabs to sign-in-and-retry, parse failures to preserved-data guidance, provider throttling to bounded backoff, and service failures to temporary unavailability.
- [ ] Settings shows authenticated identity/provider, timezone, source/destination summaries, extension health, reconnect guidance, existing sign out and deletion controls.
- [ ] Use the same generic message for `OAuthAccountNotLinked` and ordinary sign-in failure; do not disclose email/provider association. Preserve separate identity/calendar consent and no automatic linking.
- [ ] Run targeted component/privacy tests; review proposed commit `feat(recovery): add targeted setup and connection guidance`.

## Task 6: Browser regression and integration

**Files:** Modify `tests/e2e/helpers.ts`, existing connector/isolation/sign-out/privacy browser suites, and `playwright.config.ts`. Create `tests/e2e/first-run-onboarding.spec.ts`.

**Interfaces:** `prepareFixtureUser(context: BrowserContext, user?: "alice" | "bob", onboarding?: "new" | "completed"): Promise<void>`; established connector tests default completed by calling the normal authenticated onboarding API. Submission suites enable their real preference through its API. New-user tests retain active state.

- [ ] Add browser scenarios for resume/Back, all skipped, Canvas-only, absent extension, denied calendar consent, failed replacement, established empty account, two-user progress isolation, and direct dashboard entry.
- [ ] Observe new cases fail; implement fixture adaptation through ordinary APIs. Never suppress onboarding/challenge/admission in production code with `E2E_FIXTURES`.
- [ ] Run targeted Chromium/Firefox tests then the integrated parent gate. Update metadata-path/static safety tests only for intentional changes. Keep timeouts bounded; do not run a Next build while the E2E dev server writes generated types.
- [ ] Fresh reviewer validates optional setup and retained tenant/privacy behavior; review proposed commit `test(onboarding): cover first-run and returning-user flows`.

## Research decisions

ECC planner inspected current routing/providers/repositories and found no account creation timestamp, a Canvas overwrite-before-refetch window, and a nontransactional test `batch()` helper. These are covered explicitly above. D1 state uses atomic application SQL, not eventually consistent Workers KV: [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/).
