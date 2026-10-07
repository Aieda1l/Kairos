# Kairos Cloudflare Deployment Runbook

This runbook prepares the Milestone 6 hosted acceptance deployment. Checked-in Cloudflare account and D1 identifiers are placeholders; real identifiers belong in the deployment environment, not committed configuration.

## Production resources

1. Create a production D1 database for Kairos and a separate preview/test D1 database. Do not reuse the production database for previews or CI.
2. Bind the production database as `DB` in the production Worker environment.
3. Apply `migrations/0001_auth.sql` and `migrations/0002_kairos_tenant_schema.sql` through Wrangler's D1 migration workflow before serving production traffic.
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

Build the Workers target with:

```text
npm run build:vinext
```

The deployment path is based on the existing vinext command:

```text
npm run deploy:cloudflare
```

For production, the manual deployment workflow must substitute the real production D1 binding into a temporary deployment configuration and target the production environment. Do not replace checked-in placeholders with real account/database identifiers.

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
