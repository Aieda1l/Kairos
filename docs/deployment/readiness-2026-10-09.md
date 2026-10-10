# Milestone 6 Production Integration Readiness — 2026-10-09

This is a limited, non-secret evidence record, not hosted acceptance sign-off.
The 2026-10-09 investigation did not deploy, mutate remote data, or commit.
The subsequent 2026-10-10 production release is recorded below. The hosted
acceptance checklist remains open in `acceptance-milestone-6.md`.

## Hosted observations (before deploying local changes)

- `https://mykairos.me`, `/privacy`, and `/terms` returned HTTP 200.
- Signed-out requests to `/upcoming`, `/sources`, `/assignments`, `/calendar`,
  and `/settings` returned HTTP 307 redirects to `/sign-in`.
- `/api/test-fixtures/canvas-feed` returned HTTP 404, consistent with hosted
  fixtures being disabled.
- The Cloudflare production Worker secret-name listing contained the expected
  11 provider, authentication, and credential-key names. Secret **values** were
  not inspected. The production D1 migration listing reported no pending
  migrations, and the expected credential tables were queryable.
- Read-only aggregate D1 queries found **no stored values** in the Canvas, Ed,
  OAuth refresh-token, or iCloud credential-envelope fields. They therefore
  cannot establish that real persisted credentials are encrypted correctly.
- A publicly available Google holiday iCalendar feed returned HTTP 200 and
  valid calendar data when fetched directly. Posting its public URL to the
  currently deployed Canvas connection-test endpoint also returned HTTP 200
  and `ok: true`. This establishes that hosted generic HTTPS calendar fetching
  works; it does **not** explain the private Canvas feed's reported HTTP 403.
- The then-deployed Canvas connection-test route accepted that request without a
  user session. Inspection also found the Ed connection-test route did not
  check for a session before making upstream requests. Both routes were
  subsequently guarded and deployed on 2026-10-10.

Pre-release production baseline (public/signed-out routes verified; no full
authenticated acceptance): deployment `65422dba-b299-4211-93bf-a81389471568`,
version `d321e188-d77c-4c32-8fe6-ec9ee49a4ebf`, created
`2026-10-09T22:56:11Z`. This is the recorded rollback target if needed.

## Local verification of current working tree

- Vitest: **481 passing tests in 98 files**.
- Typecheck: passed.
- ESLint: 0 errors, 7 existing warnings.
- Firefox extension + Next compatibility production build: passed.
- vinext/Workers production build: passed.
- Playwright browser E2E: **6 passing tests** (Chromium and Firefox).
- Real workerd provider-client probe: passed, including Canvas HTTP 200,
  401/403, and redirect fixture handling. Invalid credentials were used for
  Ed, Google Calendar, Microsoft Graph, and CalDAV; their reported provider
  errors are expected and are not live credential acceptance.

## Production release and hosted smoke — 2026-10-10

- Production Worker: `kairos-production`; domain: `https://mykairos.me`.
  Deployed version `b9902b96-c4ef-4a7c-83d5-35747f87f088`, deployment
  `c84bf195-88b6-47a8-a6cc-79a1bb553a5f`. Production D1 had no pending
  migrations; no production schema migrations were applied during this release.
- The build was published from the reviewed, **uncommitted working tree**;
  existing uncommitted changes were preserved and no Git commit was made.
  The manual deployment workflow was updated to upload the generated
  `dist/server/index.js` with ESModule rules and the existing custom domain,
  Workers.dev, and preview URL settings. `--keep-vars` preserved remote secrets.
- An initial deployment attempt was rejected by Cloudflare error 10021 because
  the generated module graph was omitted. It did not publish a Worker version.
  Including the 248 generated modules fixed the packaging error. A successful
  first release temporarily disabled Workers.dev/preview URLs; the subsequent
  release above restored both settings.
- Fresh local verification: 481 Vitest tests passed (98 files), typecheck
  passed, ESLint reported zero errors and seven warnings, real workerd provider
  probes passed, and the vinext production build completed. The first Playwright
  run passed five of six tests; `calendar-sync.spec.ts` hit the default 30 s
  timeout, then passed when rerun alone with a 90 s limit (29.8 s execution).
  The default-timeout E2E flake warrants follow-up.
- Hosted smoke on the final Worker version: `/`, `/privacy`, `/terms`, and
  `/sign-in` returned HTTP 200; all five protected dashboard routes returned
  307; `/api/auth/providers` returned 200; `/api/test-fixtures/canvas-feed`
  returned 404; a generated client asset and the Workers.dev homepage returned
  200. Signed-out POSTs to both `/api/sources/canvas/test` and
  `/api/sources/ed/test` returned **401 `AUTH_REQUIRED`**.
- These checks establish public routing, fixture isolation, unauthenticated
  source-test access control, and module/asset load. They do not establish
  production provider OAuth, authenticated tenant isolation, provider sync,
  encrypted persisted credentials, deletion, or private Canvas feed access.

## Outstanding hosted acceptance checks

1. With an authorized private Canvas test feed, compare only its HTTP outcome
   in the authorized browser with its result from the authenticated hosted
   Kairos connection test. Capture sanitized status and reason only. If the
   browser succeeds and Worker receives 403, investigate Canvas's network or
   request-policy treatment before changing headers. Do not log the feed URL,
   tokens, response body, or request headers.
2. Use two real test identities to complete the hosted identity, tenant
   isolation, Ed, extension, Google/Microsoft/iCloud calendar, credential
   non-exposure, account-deletion, and rollback checks from the acceptance
   checklist. No stored credential envelopes were present during this read-only
   probe, so live encrypted-storage verification is still outstanding.

**Status: production deployed and signed-out smoke passed; full hosted
acceptance remains pending.**

## October 10 — Canvas User-Agent and personal Outlook authority

- Captured sanitized live failures from version `380d96d0-8f56-41fa-be51-42d2c5600fdc`: Canvas upstream HTTP 403; Microsoft Graph GET HTTP 401 at `stage=calendar_setup`. Microsoft authorization-code redemption succeeded, so a callback/secret failure was not the failing stage.
- The user confirmed that the private Canvas feed downloads while signed out. A controlled request to a deliberately invalid UW Canvas feed returned 403 without a User-Agent and 400 (feed validation) with `Kairos/0.1 (+https://mykairos.me)`. Canvas's [published policy](https://community.instructure.com/en/discussion/658205/enforcing-user-agent-header-for-canvas-api-requests/p1) requires the header. Feed tests and synchronization now include it, and workerd checks it through a redirect.
- Added allowlisted Graph rejection categories and a callback failure stage in the UI redirect. A completed token exchange followed by Graph 401 now prompts investigation of Outlook access rather than a redirect mismatch. Provider messages, tokens, and private URLs remain absent from diagnostics.
- The user confirmed a personal Microsoft account with working Outlook Calendar and said Calendar OAuth used the default directory's tenant ID. Changed the remote `MICROSOFT_CALENDAR_TENANT` setting to `common`, consistent with [Microsoft's explanation of this failure](https://learn.microsoft.com/en-us/answers/questions/5632672/persistent-401-error-with-no-explanation). Updated the credential probe's instructions: its app-only UUID requirement is not a recommendation for personal delegated OAuth.
- Verification: 498 unit/integration/component tests passed; typecheck, hosted verification, workerd probes, and production build passed; lint has zero errors and seven existing warnings. The Calendar Playwright scenario passed. The Canvas Playwright trace showed navigation starting 27 ms after Sync Now, before the successful sync response, followed by cancellation during router refresh. The test now awaits sync completion before navigation and its targeted rerun passed. A dev-server Network connection lost warning still appeared in the passing run; this is not evidence of a hosted provider failure.
- Published code as `8fa0558f-2f21-43b1-88e4-c3eabb0de445` at 10:36 UTC using `--keep-vars`. Updating the Calendar authority produced active version `2b61e00b-b0d7-4eeb-b9b8-46c760464f16` at 10:38 UTC. The previous release reference is `380d96d0-8f56-41fa-be51-42d2c5600fdc`; reverting it also reverts the Canvas fix and Calendar configuration.
- Confirmed 100% traffic on the latest version, custom-domain and D1 binding preservation, all 11 secret names, public HTTP 200 responses, protected signed-out redirects/401s, and disabled fixture routes. No production database reset or schema migration was performed.
- The user retried against the deployed fixes and confirmed **both Canvas and Microsoft Calendar connections succeed**. This verifies the reported connection failures for that production identity. Full two-user Milestone 6 acceptance, including calendar synchronization and tenant isolation, remains pending. Changes remain in the existing uncommitted working tree.

## October 10 — Sign-out navigation and synchronization report

- The user reports that calendar synchronization works. Provider-by-provider duplicate prevention, deadline updates, reconnection, and cross-user calendar checks have not yet been individually recorded; the acceptance checklist distinguishes this report from complete calendar sign-off.
- Added a Sign out control to the desktop sidebar, its collapsed icon layout, and the mobile navigation menu. It uses the existing Auth.js client sign-out flow and redirects to `/sign-in`, ending the Kairos database session and clearing the session cookie.
- Browser verification exposed unhandled authentication errors in the calendar/timezone settings APIs. Both GET and PUT now use the existing authenticated runtime resolver and return 401 `AUTH_REQUIRED` for signed-out callers.
- Verification: **502 tests in 100 files passed**, including the navigation and settings authentication regressions; typecheck, hosted safety verification, production build, and diff checks passed; lint has zero errors and seven existing warnings. **Six sign-out browser cases passed**, covering desktop, collapsed, and mobile navigation in Chromium and Firefox. These use isolated D1 test sessions and verify old-cookie replay rejection, protected-route/API rejection, preservation of tenant data after signing back in, and continued access for the other user.
- Deployed version **`8929c5e8-32bc-4a59-87d7-5c6812e5be37`** at **2026-10-10 21:20 UTC** using `--keep-vars`; 100% traffic confirmed. The immediately preceding release, with user-confirmed Canvas/Microsoft connectivity, is `2b61e00b-b0d7-4eeb-b9b8-46c760464f16`.
- Hosted smoke: public/sign-in/provider endpoints returned 200; protected `/upcoming` redirected to sign-in; calendar/timezone settings GET and PUT returned 401; an anonymous CSRF-protected sign-out returned 200 with `/sign-in` as its destination; both test-fixture probes returned 404. The first sidebar asset probe immediately after deployment returned 404; the subsequent probe of the same asset and mobile navigation asset returned 200. All 11 secret names remain present. No production database schema or user data was reset.
- Hosted logout acceptance for two real production identities, the remaining isolation/security/deletion checks, and complete Milestone 6 sign-off remain pending. The release remains in the existing uncommitted working tree.

## October 10 — Subsequent user-confirmed hosted acceptance

- The user explicitly confirmed that **two-user isolation**, **sign-in and logout**, **account deletion**, and **sources plus the Firefox extension** pass in production. These functional areas are recorded as user-confirmed passes, updating the earlier pending status. The report does not supply a provider/user matrix or individual negative-security-probe results.
- Calendar synchronization was already reported working. Per-provider duplicate prevention, deadline updates, reconnection, and iCloud coverage remain unspecified in the acceptance record.
- A read-only D1 aggregate check found one Canvas feed envelope, one Ed token envelope, two calendar refresh-token envelopes, and 21 OAuth PKCE verifier envelopes. **All 25 present values matched the expected versioned envelope structure; zero invalid-format values were found.** No raw credential values, ciphertext, user identifiers, or private URLs were returned. No iCloud password rows were present to inspect. This verifies stored format, not full API/page/log credential non-exposure or cryptographic authenticity of every value.
- Rechecked production version `8929c5e8-32bc-4a59-87d7-5c6812e5be37` at 100% traffic. This is the currently user-confirmed functional production release. The source tree remains uncommitted at base Git revision `ff349e986ed0dec8854cbd6d2db729037fdae892`; that commit alone does not reproduce the release.
- Milestone 6 final sign-off remains pending the remaining credential/privacy and OAuth security checks, detailed calendar edge-case coverage, and release/rollback evidence reconciliation. No code deployment, production data mutation, account deletion, or database rollback was performed during this acceptance-record update.
