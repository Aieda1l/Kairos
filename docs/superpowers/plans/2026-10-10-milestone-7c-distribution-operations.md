# Milestone 7C Distribution and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Produce a reviewable AMO release and operational evidence that Kairos can safely run a public beta.

**Architecture:** Keep the existing extension identity and exact origin allowlist, with deterministic runtime/reviewer packages. Use bounded structured events and constant health probes with platform dashboards and a scheduled synthetic workflow. Publish truthful contact/legal/recovery guidance and prove deployment, rollback, and key rotation without exporting plaintext user data.

**Tech Stack:** Firefox MV3/esbuild, TypeScript, vinext/Workers/D1, Vitest/Playwright, GitHub Actions, Cloudflare Email Routing.

**Spec:** `docs/superpowers/specs/2026-10-06-public-beta-readiness-design.md`, sections 7-9 and 11-18. Parent: `2026-10-10-milestone-7-public-beta.md`.

## Global Constraints

- AMO listing selected by the user; a signed/reviewed public artifact is required, not a temporary add-on.
- Keep stable extension ID `kairos-local@kairos`; increasing the version must not change identity.
- No arbitrary Canvas hosts, Chromium extension, `<all_urls>`, cookie/history/downloads/webRequest permissions.
- Operational logs contain no assignment/course content, credentials/envelopes, codes/verifiers, cookies, private URLs, email, or raw provider responses.
- Health checks must not touch or enumerate user data. No internal admin dashboard.
- Support/security aliases reach a monitored destination before public beta.
- Rollback uses compatible Worker versions and forward-only migrations; old encryption keys remain available until all dependent envelopes expire or are re-encrypted.
- No compliance certification, availability guarantee, or approval claim without evidence.

## Review Focus

1. Firefox older than native consent support silently transmits data: Task 1 raises the public minimum to Firefox 140 and tests manifest/consent install behavior.
2. Release archives contain fixtures, `.env`, dependencies, or private build state: Task 1 allowlists exact runtime and reviewer inputs; archive sentinel tests inspect every member.
3. Untrusted exception fields or caller correlation IDs leak PII: Task 3 serializes a fixed event schema and server-generated IDs only; adversarial redaction tests.
4. Storage exhaustion prompts credential replacement or incomplete writes: Task 4 injects D1 failure before/after batch boundaries and verifies safe service errors and original data.
5. Key rotation races credential replacement or code rollback: Task 5 uses dual-key decryption, compare-and-swap envelope updates, resumable rotation, and a compatible live rollback record.

## Task 1: AMO-ready package and install descriptor

**Files:** Modify `extension/firefox/manifest.json`, `scripts/build-firefox-extension.mjs`, `extension/firefox/tests/manifest.test.ts`, `package.json`, `package-lock.json`, `.gitignore`. Create `scripts/package-firefox-extension.mjs`, `extension/firefox/AMO.md`, `extension/firefox/amo-metadata.json`, `src/lib/extension-distribution.ts`, `tests/unit/extension-package.test.ts`, `tests/unit/extension-distribution.test.ts`. Integrate `.github/workflows/milestone-2-ci.yml` centrally.

**Interfaces:**
- Consumes: existing bridge schemas and runtime bundles; exact production origin `https://mykairos.me`.
- Produces: `getFirefoxDistribution(config: {listingUrl?: string}): {state: "pending" | "available"; installUrl: string | null; minimumVersion: 140}`; only validated `https://addons.mozilla.org/...` links accepted. 7A consumes this; no guessed listing URL.
- Produces: `npm run package:extension` -> ignored `artifacts/firefox/` runtime ZIP, reviewer source ZIP, SHA-256 manifest; `npm run lint:extension` -> Mozilla `web-ext@10.7.0` pinned as a dev dependency. Official npm metadata checked 2026-10-10 requires Node >=20/npm >=8, compatible with Kairos Node >=22. Do not depend on a changing `npx latest`.

- [ ] Red tests: `runtime_archive_contains_only_manifest_icons_popup_and_five_bundles`, `reviewer_archive_has_complete_protocol_sources_and_lockfile`, `archives_exclude_env_fixtures_and_credentials`, `manifest_preserves_id_and_origins`, `missing_or_foreign_listing_link_stays_pending`.
- [ ] Run `npm test -- extension/firefox/tests/manifest.test.ts tests/unit/extension-package.test.ts tests/unit/extension-distribution.test.ts`; new behaviors fail.
- [ ] Set version `0.4.0`, desktop minimum `140.0`, and native required declaration `websiteContent`. The inspected protocol transmits coursework/status/grades and resource IDs, not names/emails/account IDs or credentials; those fields fit website content. If Mozilla review requires another category, amend declaration/listing/policy together and rerun install consent acceptance. Never declare `none` for this bridge. Do not add optional telemetry.
- [ ] Package via exact file allowlists with reproducible paths/timestamps. Keep output readable and reviewer source sufficient to reproduce identical bundled files using the lockfile. Include shared `src/lib/extension-protocol/` modules actually imported by the extension.
- [ ] Document actual fields, tabs permission purpose, read-only source behavior, exact origins, no cookie/password export, build instructions, and signed-install/update procedure in AMO material. Keep website/AMO/policy declarations consistent.
- [ ] Run targeted tests, `npm run build:extension`, `npm run lint:extension`, `npm run package:extension`; inspect archives/checksums and exercise native install consent. Submit only after reviewer artifact/metadata are ready and the Mozilla account exists.
- [ ] Review and stage exact files; proposed commit `feat(extension): prepare signed Firefox beta distribution`. Actual signing/listing acceptance is recorded separately.

## Task 2: Public contact, legal truth, and provider approval material

**Files:** Modify `src/app/page.tsx`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `README.md`. Create `src/app/support/page.tsx`, `src/app/security/page.tsx`, `src/lib/public-contacts.ts`, `docs/deployment/public-beta-providers.md`, `docs/deployment/public-beta-support.md`. Tests: `tests/component/public-beta-pages.test.tsx`. Coordinate homepage/auth controls with 7A/7B.

**Interfaces:**
- Produces: public `/support` and `/security` instructions and validated domain alias links. Public copy must not assert monitoring/delivery until routing is tested.
- Consumes: 7A identity/settings behavior and 7B challenge/log/control behavior; policies describe the final implementation.

- [ ] Red component tests: `public_pages_explain_UW_first_open_identity_optional_calendar`, `policy_describes_identity_data_without_identity_tokens`, `security_page_discourages_credentials_in_public_issues`, `contact_links_never_publish_personal_destination`.
- [ ] Run `npm test -- tests/component/public-beta-pages.test.tsx`; new assertions fail.
- [ ] Replace placeholder privacy copy with stored account identity/coursework/source/settings/calendar data, encrypted credentials, normalized extension data, provider/Cloudflare processing, documented log retention, deletion scope/backups, and revocation steps. State that deleting Kairos does not necessarily revoke provider consent or remove remote generated events; verify actual behavior before wording.
- [ ] State beta limits and unofficial/non-UW relationship in Terms. Use plain support/security reporting instructions, no invented legal guarantees.
- [ ] Correct README's stale Milestone 6 status, SQLite/plaintext storage, Microsoft public-client flow, and iCloud calendar creation claims; separate historical local behavior from current hosted instructions.
- [ ] Prepare exact identity/calendar callback/scopes/audience matrix. Keep Google `calendar.app.created` and Microsoft delegated `Calendars.ReadWrite`/`offline_access`; verify identity scopes against code. Document Google published state separately from any required verification. Microsoft uses confidential **Web** redirects with secret value, `common`, and compatible account audience.
- [ ] Prepare Cloudflare inbound setup: select a monitored destination privately, verify it, add explicit `support@mykairos.me` and `security@mykairos.me` rules, test inbound delivery. Do not replace existing MX records without inspecting existing mail configuration. No outbound transactional system.
- [ ] Run component/browser checks and verify provider revocation/deletion with real authorized accounts; record labels/outcomes only. Review proposed commit `docs(product): publish beta privacy and support guidance`.

## Task 3: Structured diagnostic events and protected log persistence

**Files:** Create `src/lib/operations/events.ts`, `src/lib/operations/context.ts`, `tests/unit/operational-events.test.ts`, `tests/integration/operational-privacy.test.ts`. Modify `src/lib/auth/diagnostics.ts`, `src/lib/sources/upstream-diagnostics.ts`, `src/lib/calendar/microsoft/oauth.ts`, `src/app/api/calendars/microsoft/callback/route.ts`, `src/lib/platform/source-api-runtime.ts`, `src/lib/platform/calendar-api-runtime.ts`, `wrangler.jsonc`, `scripts/verify-production-safety.mjs`; integrate event emission with routes touched by 7B centrally.

**Interfaces:**
- Produces: `createOperationContext(action: OperationAction, releaseId?: string): {requestId: string; action: OperationAction; releaseId: string}` using a fresh UUID and bounded SHA/version value, never the request URL or supplied trace string.
- Produces: `runWithOperationContext<T>(context: OperationContext, work: () => Promise<T>): Promise<T>` and `getOperationContext(): OperationContext | null` via Workers-compatible AsyncLocalStorage. Auth handlers/server actions and operation wrappers establish the context; global Auth.js logger reads it instead of retaining mutable cross-request state. Test concurrent requests cannot share correlation context.
- Produces: `emitOperationEvent(context: OperationContext, outcome: {code: OperationCode; result: "ok" | "rejected" | "error"; provider?: "google" | "microsoft" | "caldav" | "canvas" | "gradescope" | "ed"; status?: number; durationMs?: number}): void`. Fixed action/code enums cover auth, credential connect/test, source/calendar sync, rate rejection, service unavailable, and health. No arbitrary message/details/error object.

- [ ] Red tests inject email/token/private-feed/assignment/HTML/exception/query/header sentinels into unknown fields and malformed enum/status/ID values; serialized output must contain none. Test valid success/failure codes and generated correlation IDs.
- [ ] Run `npm test -- tests/unit/operational-events.test.ts tests/integration/operational-privacy.test.ts`; new tests fail.
- [ ] Implement fixed allowlist serialization and one event per outcome. Refactor existing sanitized diagnostics to the same schema without logging thrown errors or provider responses. Do not serialize runtime/auth/session objects.
- [ ] Keep persistent logs off during development. Prepare a preview-only configuration with invocation logs disabled, query redaction enabled, traces disabled, and application event retention documented. Verify stored platform metadata and uncaught framework errors with non-secret canaries before enabling production persistence. If platform records private URL/PII despite settings, keep that sink disabled and use a filtered alternative; do not merely claim redaction.
- [ ] Run redaction tests, `npm run verify:hosted`, workerd event probes, and preview persistence canary. Document retention and privileged raw-tail limits. Review proposed commit `feat(ops): add privacy-preserving diagnostic events`.

## Task 4: Health, failure visibility, and capacity procedures

**Files:** Create `src/lib/operations/health.ts`, `src/app/api/health/route.ts`, `scripts/check-production-health.mjs`, `.github/workflows/production-health.yml`, `docs/deployment/monitoring.md`, `tests/unit/production-health.test.ts`, `tests/integration/service-unavailable.test.ts`. Modify `.github/workflows/deploy-production.yml`, `src/app/(dashboard)/error.tsx`, `src/lib/platform/source-api-runtime.ts`, `src/lib/platform/calendar-api-runtime.ts`, and `scripts/verify-production-safety.mjs` centrally.

**Interfaces:**
- Produces: `checkServiceHealth(db: D1DatabaseLike): Promise<"ok" | "unavailable">` with constant `SELECT 1 AS ok`, 3-second response deadline and sanitized failure; no session/keyring/user repositories. A deadline returns unavailable without pretending a D1 operation can be forcibly cancelled.
- Produces: `GET /api/health` -> HTTP 200 `{"status":"ok"}` or HTTP 503 `{"status":"unavailable"}`, `Cache-Control: no-store`. No binding identifiers, configuration field lists, token state, or user counts.
- Produces: synthetic script accepts only the expected canonical origin, 10-second timeout, no redirects/body logging; nonzero exit on failure. Workflow every 15 minutes plus manual dispatch, minimal read permissions, one concurrent check.

- [ ] Red tests: `health_never_queries_user_tables_or_auth`, `health_failure_returns_only_service_status`, `quota_failure_is_service_unavailable_without_reconnect`, `synthetic_rejects_redirect_or_unexpected_payload`.
- [ ] Run targeted health/service-error tests; new cases fail.
- [ ] Implement health and synthetic checks; add post-deploy smoke and clear failing job outputs containing only fixed code/status. Preserve manual deployment until the rollback drill succeeds. Include `KAIROS_RELEASE_ID` as a nonsecret artifact revision through the temporary deployment config.
- [ ] Map known D1/storage-unavailability boundaries to safe service errors, without catching away NEXT_REDIRECT/auth control flow. Preserve atomic batch behavior; do not render reconnect actions for storage or hosting failures. Uncatchable Worker quota termination is handled by platform fail-closed settings and monitoring, not an application promise.
- [ ] Document Workers/D1 request, CPU, read/write/storage dashboards; daily review and 70%/90% operational thresholds with response actions. Confirm the actual plan, available alert types, and verified notification destination. GitHub check/deploy failure notifications must reach the monitored operator; a workflow file alone is not evidence of operational alerting.
- [ ] Run targeted tests and a synthetic success/failure exercise. Record actual dashboard/notification checks without account identifiers. Review proposed commit `feat(ops): add production health and failure visibility`.

## Task 5: Incident response, key rotation, and rollback

**Files:** Create `docs/deployment/incident-response.md`, `src/lib/security/keyring-environment.ts`, `src/lib/security/credential-rotation.ts`, `scripts/rotate-credentials.mjs`, `scripts/rotate-credentials-cli.ts`, `scripts/lib/d1-maintenance-client.mjs`, `scripts/set-abuse-control.mjs`, `scripts/maintain-abuse-state.mjs`, `scripts/recover-operation.mjs`, `.github/workflows/production-maintenance.yml`, `tests/unit/keyring-environment.test.ts`, `tests/integration/credential-rotation.test.ts`, `tests/integration/abuse-maintenance.test.ts`. Modify `src/lib/platform/source-runtime.ts`, `src/lib/platform/production-config.ts`, `.env.example`, `docs/deployment/cloudflare.md` centrally.

**Interfaces:**
- Produces: `credentialKeyringFromBindings(env: Record<string, unknown>): CredentialKeyring`; default active ID `v1`, allow explicit `v2` with both `KAIROS_CREDENTIAL_KEY_V1` and `KAIROS_CREDENTIAL_KEY_V2`, each exactly 32 decoded bytes. Envelope format version remains `v1`; encryption key ID is separate.
- Produces: `rotateStoredCredentials(db: D1DatabaseLike, keyring: CredentialKeyring, options: {batchSize: number; dryRun: boolean}): Promise<{scanned: number; rotated: number; conflicts: number; failed: number; remaining: number}>`; all failures/counts sanitized, no plaintext or envelopes returned/logged.
- CLI bundles its TypeScript entry with esbuild into ignored `artifacts/maintenance/`, then executes it as a Node child inheriting the environment. Its D1 adapter uses the fixed Cloudflare REST query endpoint with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_D1_DATABASE_ID` supplied through the local process environment; key material also comes from that environment. Validate IDs, prohibit redirects, bound timeout, never log provider bodies or SQL params. Invocation: `node scripts/rotate-credentials.mjs --dry-run`, then `node scripts/rotate-credentials.mjs --apply --batch-size=50`. No command-line secrets, disk/plaintext export, or public rotation API.
- Maintenance CLIs share that bounded REST client. `set-abuse-control.mjs --key=auth:initiation --enabled=false --apply` validates an allowlisted key and atomically increments control version. `maintain-abuse-state.mjs --apply --batch-size=100` deletes only expired indexed rate events/Sync All runs and safely expired request metadata; hourly protected production workflow plus manual dispatch, sanitized counts only. Exclude running/uncertain ownership rows from cleanup. Rate records expire after their 600/3600-second enforcement window; the hourly sweep normally bounds retained history to two hours, with outage retention stated honestly.
- `recover-operation.mjs` defaults to dry-run and accepts the target user/owner nonce through private process environment; explicit `--apply --settlement-confirmed` is permitted only after the documented prior-work termination/outcome reconciliation. CAS the exact uncertain owner, never a broad lock reset. The script cannot prove settlement itself and must say so; ordinary users receive retained-data/support guidance while uncertain remote writes are checked.

- [ ] Red tests prove mixed v1/v2 reads, new v2 writes, wrong active/missing key fail safely, dry-run leaves rows unchanged, rotation resumes without duplicates, concurrent credential replacement is preserved, and both users remain decryptable.
- [ ] Maintenance tests prove unknown controls reject, toggles increment versions, cleanup cannot remove live attempts/runs/locks, wrong-owner recovery does not alter state, and output contains no row content, credential, user ID, or addressing.
- [ ] Run targeted keyring/rotation tests; new behaviors fail.
- [ ] Load dual-key bindings without changing existing ciphertext semantics. Rotate known envelope columns for Canvas/Ed, OAuth refresh tokens, iCloud secrets, unexpired OAuth PKCE state, and 7A's encrypted `onboarding_draft` settings with the original user/purpose/context AAD. Use compare-and-swap against the old envelope; bounded batches, stop on decrypt failure. Do not remove v1 merely because the active key is v2.
- [ ] Runbook covers triage, 7B admission/provider switches, deployment/Auth/provider credential rotation, evidence preservation, notification decisions, and reopening. For key rotation: deploy dual-read/new-write support, re-encrypt and verify remaining old-key count plus pending request expiry, and restrict rollback to dual-key-capable builds. Preserve old keys in secure backups for any retained database recovery point.
- [ ] Extend deployment runbook with build/config/secret-name validation, additive migration, artifact/source identity, smoke, current/prior version capture, rollback and forward restore. Record an actual controlled production rollback only after preflight confirms schema/key compatibility and authorized test accounts are available.
- [ ] Run targeted tests/workerd keyring probes; review proposed commit `feat(security): support safe credential-key rotation and recovery`.

## Task 6: Integrated launch acceptance and independent reviews

**Files:** Create `docs/deployment/acceptance-milestone-7.md`, `docs/deployment/readiness-milestone-7.md`. Modify `docs/superpowers/ROADMAP.md`, `README.md`, feature CI and deploy gates centrally.

**Interfaces:** Consumes all 7A/7B/7C deliverables and the exact final deployed revision/signed-extension checksum. Produces evidence for each of the spec's 23 acceptance conditions, with unresolved external items explicitly pending.

- [ ] Run the parent plan's integrated automated gates; adapt CI branch trigger to M7 and validate extension/reviewer package as artifacts.
- [ ] Complete real two-account hosted onboarding/identity/source/calendar/revocation/deletion acceptance; include rate admission and kill-switch smoke, native extension install/update, inbound aliases, monitoring failure exercise, and live rollback/restore.
- [ ] Obtain fresh code/security reviews using ECC; run repository security-audit and production-readiness-review. Resolve Critical/Important issues and record justified non-launch dependency exceptions accurately.
- [ ] Keep broad homepage promotion and M7 completion pending until every external gate passes. Present final reviewed diff/messages before commits required by ECC; then finalize the evidence and milestone state.

## Primary sources checked 2026-10-10

- [Mozilla native consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/): desktop native consent starts at Firefox 140; declarations are required for new extensions. Coursework transmitted to the site is website content; the final taxonomy follows the actual fields.
- [Mozilla signing/distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) and [reviewer source](https://extensionworkshop.com/documentation/publish/source-code-submission/): release installation requires signing, and bundled code needs reproducible reviewer source.
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) and [sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification): retain the narrow actual scope; confirm console classification/verification rather than infer it from a published toggle.
- [Microsoft Web redirect rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url) and [app registration security](https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration).
- [Cloudflare email routing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/): rules require a verified destination; unverified rules stay disabled.
- [Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/): invocation logs can be disabled; stored console/errors/metadata still require a canary review.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing/usage](https://developers.cloudflare.com/d1/platform/pricing/): free-tier request/CPU and daily read/write ceilings need monitoring. Recheck actual account plan and limits before launch.
- [Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/): code rollback is separate from database/key compatibility.
