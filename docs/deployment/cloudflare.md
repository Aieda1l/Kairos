# Kairos Cloudflare Deployment Runbook

This runbook prepares the Milestone 6 hosted acceptance deployment. Checked-in Cloudflare account and D1 identifiers are placeholders; real identifiers belong in the deployment environment, not committed configuration.

## Production resources

1. Create a production D1 database for Kairos and a separate preview/test D1 database. Do not reuse the production database for previews or CI.
2. Bind the production database as `DB` in the production Worker environment.
3. Apply the migrations through Wrangler's D1 migration workflow. `0001_auth.sql` and `0002_kairos_tenant_schema.sql` establish identity and tenant storage; `0003_identity_token_minimization.sql` clears unused identity-provider token fields while preserving account links, sessions, and encrypted calendar grants.
4. Keep the checked-in placeholder database IDs distinct between preview and production. Supply the real production database identifier through the controlled deployment workflow.

## Required production configuration

Non-secret canonical values:

- `KAIROS_APP_URL=https://mykairos.me`
- `AUTH_URL=https://mykairos.me`

Configure these secret/provider values in the production deployment secret store without printing or committing their values:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET` when required by the Google registration
- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_TENANT`
- `KAIROS_CREDENTIAL_KEY_V1`

Deployment credentials such as the Cloudflare account ID, API token, and real D1 database ID must also remain outside tracked files. Use placeholders when documenting commands.

## Pre-deploy gate

Run the complete hosted verification before deployment. At minimum this includes the application test suite, lint, typecheck, D1 migration verification, Firefox extension build, Next compatibility build, vinext/Workers build, and Playwright E2E suite.

Use `npm ci` with the committed lockfile for reproducible installs. See `security-review-2026-10-10.md` for the documented build-only dependency advisory exception. Production configuration must keep query-string redaction enabled; persistent observability is disabled. Runtime diagnostics must contain fixed categories/statuses only.

Build the Workers target with:

```text
npm run build:vinext
```

The generic vinext deployment command is:

```text
npm run deploy:cloudflare
```

For production, dispatch `.github/workflows/deploy-production.yml`. Its temporary
Wrangler config substitutes the real production D1 ID, points `main` at the
generated `dist/server/index.js`, sets `no_bundle: true`, and adds ESModule
rules for `**/*.js` and `**/*.mjs`. It also preserves the `mykairos.me`
custom-domain route, existing Workers.dev/preview URL settings, and remote
secret bindings (`--keep-vars`). Direct Wrangler deployment with the source
specifier `vinext/server/fetch-handler` fails because it is not a disk entry
point; omitting the ESModule rules leaves generated imports out of the upload.
Do not replace checked-in placeholders with real account/database identifiers.

## Manual smoke and rollback prerequisites

Before directing normal traffic to a new deployment:

1. Confirm the production D1 migrations completed successfully.
2. Verify `/`, `/privacy`, and `/terms` while signed out.
3. Verify Google and Microsoft Kairos sign-in with production callback URLs.
4. Verify one authenticated dashboard request reads only the signed-in user's D1 state.
5. Verify Google/Microsoft calendar authorization callbacks use `https://mykairos.me` exactly.
6. Verify the Firefox bridge communicates only with the exact production origin.
7. Record the current known-good Worker deployment identifier before promotion.

If smoke checks fail, route traffic back to the recorded known-good Worker deployment and investigate before retrying. Do not automatically advance traffic after a failed migration or deployment.

## Hosted integration troubleshooting

For Microsoft sign-in `AADSTS700016`, compare the client ID in the Microsoft authorization request with the **Application (client) ID** in the Microsoft Entra app registration. Verify the app supports the intended account types and that the tenant allows consent. Microsoft sign-in uses `AUTH_MICROSOFT_ENTRA_ID_ID`; Microsoft Calendar is a separate OAuth registration using `MICROSOFT_CALENDAR_CLIENT_ID`. Their registered web redirects are `https://mykairos.me/api/auth/callback/microsoft-entra-id` and `https://mykairos.me/api/calendars/microsoft/callback` respectively.

For Microsoft sign-in returning `OAuthCallbackError` after account consent, inspect the sanitized Worker warning `Kairos sign-in failed` or `Kairos sign-in authorization rejected`. Only fixed provider error codes are logged. `invalid_client` usually means the Entra application is sending an incorrect or expired **client secret value**, or that the client ID, secret, and tenant are from different registrations. Verify the **Web** platform registration and exact callback URL above. Auth.js may also fail for other reasons, so do not treat the callback page alone as proof of an invalid secret. Never enable verbose OAuth token/body logging in production.

For Microsoft **Calendar** connection failures, inspect the sanitized `Kairos Microsoft Calendar connection failed` warning. `stage=token_exchange` means the Calendar app's authorization code could not be redeemed; the `Kairos Microsoft Calendar token exchange failed` warning reports HTTP status, a fixed error category, and only the numeric `aadstsCode` when provided. Verify the Calendar app's exact Web redirect URL `https://mykairos.me/api/calendars/microsoft/callback`, tenant, secret value, and whether the authorization flow is being restarted. `stage=calendar_setup` means the token exchange completed, but Calendar setup failed. If `Kairos Microsoft Graph calendar request denied` reports HTTP 403, check the Calendar registration's **delegated** `Calendars.ReadWrite` Microsoft Graph permission, granted user/admin consent, and the signed-in account's supported Outlook/Exchange mailbox. HTTP 401 at Graph means the access token was rejected. Signing in to Kairos and validating the Calendar app credentials independently does not establish delegated Graph access. Never record callback URLs with codes, raw token responses, Graph response messages, or private credentials in diagnostics.

Entra **Application (client) IDs** are UUIDs (for example, `00000000-0000-0000-0000-000000000000`); **client secret values** are different credentials. The Microsoft Calendar OAuth configuration now rejects non-UUID client IDs before constructing a sign-in URL. If a client secret was previously placed in `MICROSOFT_CALENDAR_CLIENT_ID`, treat it as exposed in the browser URL/history: revoke that secret and generate a new one, then set `MICROSOFT_CALENDAR_CLIENT_ID` to the Application (client) ID and `MICROSOFT_CALENDAR_CLIENT_SECRET` to the new secret. Check `AUTH_MICROSOFT_ENTRA_ID_ID` separately for Kairos sign-in.

If Google Calendar reports `403: access_denied` with an app still in testing, add the account to the calendar OAuth project's test users or complete the provider's production verification. Google sign-in and Google Calendar can use separate OAuth clients. The calendar redirect must be `https://mykairos.me/api/calendars/google/callback`.

For Apple Calendar, create a writable calendar named **Kairos** in iCloud Calendar before connecting. The Worker can discover and sync that collection, but Cloudflare Workers rejects the CalDAV `MKCALENDAR` method. When no writable Kairos calendar exists, the connection flow instructs the user to create one and reconnect.

Run `npm run verify:workerd` for a local Wrangler/workerd smoke test of Ed, Google Calendar, Microsoft Graph, iCloud, and Canvas feed fetching. It sends deliberately invalid credentials to the four authenticated providers and verifies that the request reaches an HTTP/auth response instead of failing at the Workers fetch boundary. Canvas uses a local fixture to test successful downloads, HTTP 401/403 mapping, and redirects. A passing probe does not establish that real account credentials, Canvas feed URLs, hosting-network access, or upstream provider settings are valid.

Canvas and Ed server requests emit sanitized Worker warnings under `Kairos source request failed` with only the provider, failure category (`http`, `transport`, or `timeout`), and numeric HTTP status when available. Canvas 401 suggests a rejected feed URL; 403 may also indicate a hosting-network restriction. Ed `transport` means fetch was rejected before a response (including a possible blocked redirect); `timeout` means no response arrived before the deadline. Confirm issues in the Workers logs and compare direct upstream behavior without sharing or logging tokens, feed URLs, request headers, or upstream response bodies.

Canvas requires an identified `User-Agent` on outbound requests, as described in [Instructure's enforcement announcement](https://community.instructure.com/en/discussion/658205/enforcing-user-agent-header-for-canvas-api-requests/p1). Workers does not provide one by default. Kairos now sends `Kairos/0.1 (+https://mykairos.me)` for feed tests and synchronization. A controlled request to a deliberately invalid UW Canvas feed returned 403 without this header and reached feed validation (400) with it. The workerd fixture checks this header through a redirect as well. If a private feed still fails, compare its signed-out browser behavior with the hosted connection test; the header fix does not prove every feed is valid or every network is allowed.

To tail the production Worker, run `npx wrangler tail --env production --config ./wrangler.deploy.local.jsonc --format pretty`. Omit the explicit Worker name: with this named-environment configuration, passing `kairos-production` as well makes Wrangler look for `kairos-production-production`. Tail output includes request URLs and can contain OAuth codes, so share only sanitized integration log fields.

For a Graph 401 after a completed token exchange, the UI now reports that Outlook rejected calendar access rather than suggesting a callback mismatch. The Graph warning records an allowlisted `providerCode` (including `UnknownError`), a fixed `reason` (`invalid_audience`, `token_expired`, `malformed_token`, or `unspecified`), and `responseFormat` (`json` or `non_json`). These are diagnostic categories, not raw provider messages. Investigate the returned category before changing scopes, credentials, or tenant settings.

For a **personal Outlook account**, set `MICROSOFT_CALENDAR_TENANT=common` for personal and work/school accounts, or `consumers` for personal accounts only. The Calendar app registration must support the matching account types. Authorizing a personal account through the app's default directory UUID can issue tokens for its directory identity and then fail at Graph calendar access with 401; see [Microsoft's explanation](https://learn.microsoft.com/en-us/answers/questions/5632672/persistent-401-error-with-no-explanation). The directory UUID requested by `scripts/verify-microsoft-credentials.ps1` is for its **app-only credential probe**, and is not a recommendation to use that UUID for personal delegated Calendar OAuth. Restart the connection after changing the authority; existing grants and pending authorization codes are not repaired by the setting change.
