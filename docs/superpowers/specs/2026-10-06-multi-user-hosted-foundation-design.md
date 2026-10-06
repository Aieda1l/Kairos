# Kairos Milestone 6 — Multi-user Hosted Foundation Design

**Date:** 2026-10-06  
**Status:** Awaiting written-spec review  
**Branch:** `feat/milestone-6-multi-user-hosted-foundation`  
**Production domain:** `https://mykairos.me`

## 1. Goal

Convert Kairos from a personal localhost application into a production-capable, multi-user web application that can be hosted primarily on Cloudflare's free tiers.

Milestone 6 is an architectural foundation milestone. It is complete when multiple authenticated users can use the same hosted Kairos deployment while their assignments, source connections, settings, credentials, calendar destinations, OAuth transactions, and generated-event mappings remain strictly isolated.

This milestone does **not** attempt a broad public launch. It makes the application safe and operable as a hosted multi-user service so a later public-beta milestone can focus on onboarding, abuse controls, provider verification, extension-store distribution, monitoring, and launch polish.

## 2. Product intent and success criteria

Kairos should become a web application a student can visit at `https://mykairos.me`, sign into, connect their own sources and calendar destinations, and use without sharing any application state with another Kairos user.

Success means:

1. `mykairos.me` is the canonical production origin.
2. Signed-out visitors can reach a public product homepage plus privacy and terms pages.
3. Authenticated application routes require a Kairos session.
4. Kairos supports independent user accounts through Google and Microsoft sign-in.
5. Signing into Kairos is distinct from granting Google Calendar or Microsoft Calendar permissions.
6. Production persistence uses Cloudflare D1 instead of a local `better-sqlite3` file.
7. Every user-owned row is scoped to exactly one Kairos user.
8. Database constraints prevent a child record owned by one user from being attached to a parent record owned by another user.
9. Every server-side repository/service entry point requires authenticated user scope rather than trusting a user ID supplied by the browser.
10. Sensitive source/calendar credentials are encrypted by Kairos before they are stored in D1.
11. Google/Microsoft calendar OAuth transactions are durable, expiring, one-time, and bound to the initiating user.
12. The Firefox bridge works on localhost for development and on `https://mykairos.me` in production without accepting arbitrary web origins.
13. Automated tests prove that one user cannot read, mutate, sync, disconnect, or enumerate another user's records.
14. Existing source and calendar synchronization behavior remains functionally equivalent for an authenticated user.
15. The hosted runtime can be built for Cloudflare Workers and exercised in CI before deployment.
16. Existing personal local credentials are **not** silently uploaded or migrated into the hosted service.

## 3. Hosting architecture

### 3.1 Primary deployment target

Kairos will target:

- Cloudflare Workers for the full-stack application runtime;
- Cloudflare D1 for relational persistence;
- Cloudflare-managed HTTPS/custom-domain routing for `mykairos.me`;
- Cloudflare secret bindings for application secrets and credential-encryption keys.

The current application is Next.js 16. Cloudflare currently recommends `vinext` for running existing Next.js applications on Workers. Milestone 6 therefore uses `vinext` as the primary deployment adapter, subject to an explicit compatibility gate before the migration is considered complete.

The compatibility gate must:

1. run the current vinext compatibility checker against the repository;
2. record any unsupported Next.js or Node APIs;
3. remove the known `better-sqlite3` runtime dependency from production code by moving persistence to D1;
4. prove a Workers-targeted production build in CI.

If a confirmed vinext incompatibility remains after removing Node-only persistence, the implementation may use Cloudflare's supported OpenNext adapter as a fallback without changing the product architecture. That fallback is an implementation ruling, not permission to change the D1/tenant/authentication design.

### 3.2 Canonical origin

Milestone 6 deliberately uses one public production origin:

`https://mykairos.me`

This avoids premature subdomain/cookie complexity. The same application serves:

- public landing page at `/`;
- legal pages such as `/privacy` and `/terms`;
- authenticated dashboard routes such as `/upcoming`, `/calendar`, `/assignments`, and `/sources`;
- authentication callbacks;
- Google/Microsoft calendar callbacks.

A future milestone may move the application to `app.mykairos.me`, but Milestone 6 must not require that split.

### 3.3 Development and staging

Local development remains supported on `http://localhost:3000`.

Production credentials, production OAuth registrations, and production D1 are separate from local/test configuration. Provider testing must not reuse production secrets in CI.

A dedicated public staging hostname is optional for Milestone 6. A Workers preview URL or protected staging route is sufficient as long as production secrets and data are not reused.

## 4. Authentication model

### 4.1 Kairos account authentication

Kairos will use Auth.js with its Cloudflare D1 adapter.

Initial sign-in providers:

- Google;
- Microsoft.

The purpose of these providers is **Kairos identity only**. Sign-in requests only identity scopes needed for authentication/profile display.

Calendar access remains a separate, contextual authorization flow initiated from **Sources → Calendar destinations**.

Example:

```text
Sign in with Google
  -> identity scopes only

Connect Google Calendar
  -> calendar.app.created + offline access
```

A user can therefore sign into Kairos with Microsoft and connect Google Calendar, sign in with Google and connect iCloud, or use any other supported combination.

### 4.2 Authentication-provider registrations

Production login registrations and calendar integrations are treated as separate clients/app registrations where practical.

Environment names should make the distinction explicit, for example:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_MICROSOFT_ID`
- `AUTH_MICROSOFT_SECRET`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_TENANT`

The exact Auth.js provider-specific variable names may differ, but the configuration boundary must preserve separate identity and calendar grants.

### 4.3 Session boundary

Authenticated server code resolves a `UserScope` from the server-side session.

Representative interface:

```ts
export type UserScope = {
  userId: string;
};

export async function requireUserScope(): Promise<UserScope>;
```

Client requests must never choose the effective `userId`.

A body/query/path field named `userId` must not be used to authorize access to user-owned data. If an administrative feature is introduced later, it requires a separate explicit authorization design.

Session cookies must be secure in production, HTTP-only, and scoped to the canonical origin with an appropriate SameSite policy. Mutation routes remain same-origin and authenticated; Kairos does not enable wildcard CORS for application APIs.

## 5. Tenant-isolated persistence model

### 5.1 Ownership strategy

Every domain record that represents one student's Kairos state has an explicit `user_id`.

At minimum this includes:

- source connections;
- source credentials;
- source courses;
- assignments;
- assignment submission status;
- source sync status;
- assignment links;
- calendar connections;
- calendar credentials;
- calendar event links;
- per-user app settings;
- calendar/source OAuth requests where applicable.

Auth.js's own user/account/session tables remain managed according to the adapter schema.

### 5.2 Defense in depth

Tenant isolation is enforced twice:

1. **Application layer:** repository/service functions require `UserScope` and include `user_id` in reads and writes.
2. **Database layer:** composite uniqueness/foreign-key relationships prevent cross-user parent/child associations.

Representative source schema:

```sql
CREATE TABLE source_connections (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ...,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE assignments (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  ...,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES source_connections(user_id, id)
    ON DELETE CASCADE
);
```

Equivalent owner-preserving foreign keys apply to calendar connections/event links and source child tables.

This deliberately duplicates `user_id` on child records. The duplication makes tenant ownership explicit in queries and lets SQLite/D1 reject a cross-tenant relationship even if application code contains a bug.

### 5.3 Settings

The current globally keyed `app_settings` model becomes per-user.

Representative key:

```sql
PRIMARY KEY (user_id, key)
```

The timezone and `calendar_hide_submitted` settings therefore belong to the signed-in user.

### 5.4 Query contract

Repository interfaces must make scope hard to omit.

Prefer:

```ts
listAssignments(db, scope)
getSourceConnection(db, scope, sourceId)
saveCalendarCredential(db, scope, connectionId, secret)
```

over global helpers that rely on callers to add a tenant filter manually.

For IDs supplied by a client, a missing record and a record owned by another user should normally produce the same not-found response. APIs must not reveal whether another user's object ID exists.

## 6. D1 migration and local development

### 6.1 Runtime database

Production code stops opening a filesystem SQLite database. `better-sqlite3` is not part of the Workers runtime path.

Application persistence moves behind an asynchronous database/repository boundary backed by the D1 binding.

The migration should preserve the semantics of the current SQL schema where possible, but the old synchronous database API is not preserved merely to minimize edits.

### 6.2 Local development

Local development should use a local D1-compatible environment rather than silently switching back to a different production persistence model.

Unit tests may mock narrow repository interfaces where appropriate. Database integration tests must exercise the actual D1/SQLite schema semantics, including foreign keys and tenant constraints.

### 6.3 Existing local database

Milestone 6 does **not** upload `.data/assignments.sqlite`, source credentials, refresh tokens, or app-specific passwords into hosted Kairos.

Production begins with a clean account. Existing users reconnect sources and calendar destinations intentionally.

A later import tool may migrate non-secret assignment history, but that is out of scope.

## 7. Credential protection

### 7.1 Secrets requiring application-level encryption

Before persistence, Kairos encrypts at least:

- Canvas private iCal feed URL;
- Ed API token;
- Google Calendar refresh token;
- Microsoft Calendar refresh token;
- Apple/iCloud app-specific password.

Provider client secrets and Kairos encryption keys are never stored in D1; they remain deployment secrets.

### 7.2 Encryption design

Use Workers Web Crypto with AES-256-GCM.

The stored envelope is versioned so future rotation is possible. A representative serialized form is:

```text
v1.<key-id>.<iv-base64url>.<ciphertext-base64url>
```

Associated authenticated data binds the ciphertext to its purpose and owner, for example:

```text
kairos:v1:<user-id>:<credential-kind>:<connection-id>
```

That prevents an encrypted credential blob from being copied to another user's row or another credential type and still decrypting successfully.

The first deployment may have one active encryption key, but decryption must dispatch by envelope version/key ID rather than assuming an unversioned global key forever.

Encryption/decryption failures fail closed and surface only a stable sanitized error code.

### 7.3 Logging rules

Existing credential redaction rules continue and become production requirements.

Never log or expose:

- plaintext credential values;
- encrypted credential envelopes;
- OAuth authorization codes;
- PKCE verifiers;
- provider access or refresh tokens;
- Canvas feed URLs;
- authenticated Canvas/Gradescope HTML;
- session cookies;
- raw authorization headers.

## 8. Durable calendar OAuth transactions

### 8.1 Why the current registry changes

The current Google/Microsoft calendar PKCE registry is stored in a process-global `Map`. Workers instances are disposable and requests can land on different instances, so process-local OAuth state is not a valid hosted design.

### 8.2 Persistent request model

Introduce a short-lived `oauth_requests` table.

Representative columns:

```text
id/state_hash
user_id
provider
encrypted_code_verifier
connection_id nullable
return_to
redirect_uri
created_at
expires_at
consumed_at nullable
```

Rules:

- store a cryptographic hash of the browser-visible random state rather than the raw state when practical;
- bind every request to the initiating `user_id`;
- approximately 10-minute expiry;
- one-time atomic consumption;
- provider must match;
- callback session user must match the initiating user;
- expired/consumed/mismatched state fails closed;
- callback does not reveal whether a state belonged to another account.

The PKCE verifier is itself sensitive and is encrypted at rest until one-time consumption.

### 8.3 Production redirect URIs

Production calendar callbacks are:

```text
https://mykairos.me/api/calendars/google/callback
https://mykairos.me/api/calendars/microsoft/callback
```

Localhost callbacks remain separately registered for development.

Google uses a Web application OAuth client and the existing narrow `calendar.app.created` scope.

For Microsoft hosted calendar authorization, the calendar registration moves from the current desktop/public-client configuration to a **Web** redirect registration. Token redemption occurs on the server. PKCE remains in use; the confidential web-app credential is stored only as a deployment secret.

## 9. Source synchronization in a multi-user service

### 9.1 Canvas iCal

The saved private feed URL belongs to one user and is decrypted only inside that user's server-side sync operation.

A source sync endpoint derives ownership from the authenticated session and cannot accept another user's source connection ID as authority.

### 9.2 Ed

The Ed token is encrypted at rest and decrypted only for the owning user's sync.

The existing read-only provider behavior remains unchanged.

### 9.3 Canvas submission status and Gradescope

These integrations intentionally keep authenticated website access in the user's Firefox browser.

The hosted server does not receive Canvas/Gradescope cookies, passwords, raw authenticated pages, CSRF tokens, or browser authorization headers.

Normalized extension results are submitted through the signed-in `mykairos.me` page and are persisted only to the authenticated Kairos account.

## 10. Firefox extension production origin

The Firefox extension currently injects the Kairos bridge only into local origins.

Milestone 6 allows exactly:

- `http://localhost:3000`;
- `http://127.0.0.1:3000`;
- `https://mykairos.me`.

The manifest and bridge origin allowlist must stay synchronized and tests must fail if an arbitrary origin is accepted.

The page/extension bridge continues to validate:

- same-window message source;
- exact `event.origin === window.location.origin`;
- protocol schemas;
- request IDs.

No wildcard `https://*` Kairos host permission is introduced.

The extension still returns only normalized Canvas/Gradescope data. The authenticated web session—not extension data—determines which Kairos account receives that result.

Preparing an AMO-signed/public extension is a Milestone 7 launch task; Milestone 6 only makes the extension production-origin compatible and testable.

## 11. Public pages and authenticated routing

### 11.1 Public routes

At minimum:

- `/` — product description and sign-in entry point;
- `/privacy` — what Kairos stores, why, retention/deletion, third-party services, credential handling;
- `/terms` — service terms and unofficial/non-UW status;
- Auth.js sign-in/callback routes;
- calendar provider callbacks, which still require valid user-bound OAuth state/session checks.

The homepage must clearly state that Kairos is an independent project and not an official University of Washington service.

### 11.2 Protected routes

Dashboard/product routes require authentication.

An unauthenticated browser attempting to open them is redirected to sign-in with a safe internal return target.

API routes that read or mutate user state return an authentication error rather than falling back to global/default data.

`returnTo` values are restricted to safe same-origin application paths to avoid open redirects.

## 12. Account lifecycle

Users can sign out without deleting data.

Milestone 6 also provides an account-deletion operation with explicit confirmation.

Deletion behavior:

1. authenticate/reconfirm the current Kairos user;
2. remove that user's local source/calendar credentials and OAuth transactions;
3. cascade-delete their assignments, courses, source connections, event mappings, settings, and Auth.js-owned account/session data as appropriate;
4. invalidate the current session;
5. do not silently delete third-party calendars or unrelated provider data.

The UI tells users to use **Remove generated events** before account deletion if they want Kairos-generated remote events removed. Provider-side access can also be revoked at Google/Microsoft/Apple.

Account deletion must never accept an arbitrary target user ID from the client.

## 13. Background behavior

Milestone 6 does **not** add always-on scheduled source synchronization.

Reasons:

- Canvas submission status and Gradescope depend on the user's signed-in browser session;
- introducing cron/background schedules changes provider load, retry behavior, privacy expectations, and cost;
- tenant isolation/authentication is the priority of this milestone.

Existing stale-on-visible and manual sync behavior remains the baseline.

A later milestone may add carefully scoped scheduled jobs for server-capable sources (Canvas iCal, Ed) and outbound calendars.

## 14. Error and failure behavior

Hosted multi-user errors remain sanitized and stable.

New classes should cover at least:

- unauthenticated session;
- tenant-scoped record not found;
- credential decrypt failure;
- OAuth request expired/consumed/mismatched;
- production configuration missing;
- deployment/database unavailable.

Cross-tenant access attempts should not reveal target existence.

A D1/provider failure for one user must not alter another user's rows.

A failed credential replacement preserves the previous known-good encrypted credential until the replacement has validated successfully, matching existing local behavior.

## 15. Security test requirements

Tenant-isolation tests are a release gate, not optional coverage.

For each important resource/API, create fixtures for at least two users (Alice and Bob) and prove:

- Alice can read her record;
- Bob cannot read Alice's record;
- Bob cannot update Alice's record;
- Bob cannot delete/disconnect Alice's record;
- Bob cannot trigger a source/calendar sync using Alice's connection ID;
- Bob cannot enumerate Alice's IDs through list endpoints;
- Bob cannot attach one of his records to Alice's parent row;
- an OAuth state created by Alice cannot be consumed from Bob's session;
- encrypted credential ciphertext cannot be moved between users/connections and still decrypt;
- account deletion for Alice leaves Bob's data intact.

Database tests must additionally prove the composite foreign keys reject cross-tenant associations even when repository safeguards are bypassed.

The normal feature suite must still cover existing Canvas, Gradescope, Ed, Google, Microsoft, and iCloud semantics after tenancy is introduced.

## 16. CI and deployment gates

Milestone 6 extends CI with:

1. existing Vitest suite;
2. lint;
3. typecheck;
4. Firefox extension build/tests;
5. Playwright E2E;
6. standard Next.js production build while local compatibility is retained;
7. Cloudflare/vinext compatibility check;
8. Workers-targeted production build;
9. D1 migration validation from an empty database;
10. tenant-isolation integration tests;
11. prohibited credential/logging pattern review.

Production deployment is not allowed from a branch that has not passed the complete gate.

The deploy workflow should use GitHub environment secrets or Cloudflare deployment credentials and should never echo them.

Automatic deployment from `main` may be enabled only after the first manual production deployment and rollback path are validated.

## 17. DNS and production configuration

The Namecheap registration remains the domain registrar.

Cloudflare may become the authoritative DNS provider by assigning nameservers for `mykairos.me`. The implementation/deployment runbook must inventory and preserve any pre-existing DNS records before changing nameservers.

Required production configuration includes:

- Cloudflare account/project identifiers needed by deployment;
- D1 binding and migration configuration;
- Auth.js secret and provider credentials;
- calendar provider client credentials;
- Kairos data-encryption key;
- canonical base URL `https://mykairos.me`.

No real production secret is committed to the repository, fixtures, screenshots, issue comments, or chat.

## 18. Explicit non-goals for Milestone 6

Milestone 6 does not include:

- public marketing launch or broad student invitation;
- billing/subscriptions;
- admin impersonation;
- collaboration/shared courses;
- mobile-native applications;
- notification infrastructure;
- background cron synchronization;
- Chrome/Chromium extension support;
- automatic migration of existing local credentials;
- AMO publication/signing workflow;
- analytics/telemetry beyond the minimum operational logging needed to diagnose server failures;
- a custom arbitrary CalDAV server connector;
- multi-region data residency controls.

These may be considered later after the multi-user security boundary is proven.

## 19. Milestone acceptance

Milestone 6 is complete only when all of the following are demonstrated:

1. Two separate test users can authenticate and use the same deployed application.
2. Their dashboards contain independent source/settings/calendar state.
3. Cross-user API attempts fail closed and do not disclose record existence.
4. D1 composite constraints reject cross-user relationships.
5. Sensitive saved credentials are not plaintext in D1 and decrypt only under the correct owner/purpose context.
6. Google and Microsoft calendar OAuth state survives a Worker-instance boundary and cannot be consumed by another user.
7. Google, Microsoft, and iCloud calendar sync still pass deterministic tests under user scope.
8. Canvas/Gradescope extension workflows operate from `https://mykairos.me` while continuing to reject unapproved origins.
9. Production callback URLs use `https://mykairos.me`.
10. Public homepage/privacy/terms pages are accessible signed out, while dashboard/API state is protected.
11. Account deletion removes only the current user's Kairos-held data.
12. CI passes both the normal application suite and Workers/D1 deployment gates.
13. A production or production-like Workers deployment successfully serves the application over HTTPS.

## 20. Follow-up milestone

After Milestone 6, the next milestone should be **Public Beta Readiness**.

That follow-up can cover:

- Google production OAuth/brand verification;
- production Microsoft registration hardening;
- Mozilla signing/AMO publication;
- rate limits and abuse protection;
- operational monitoring/alerts;
- onboarding and account-management polish;
- production support/recovery documentation;
- optional scheduled sync for server-capable providers;
- an initial invite/beta rollout.

## 21. External architecture constraints verified during design

The design intentionally tracks current platform guidance as of 2026-10-06:

- Cloudflare recommends vinext as the default path for existing Next.js applications on Workers, while documenting OpenNext as an alternative path.
- Auth.js provides a Cloudflare D1 adapter.
- D1 encrypts stored objects at rest and uses TLS in transit; Kairos still adds application-level encryption for third-party credentials.
- Google production OAuth web applications require owned-domain HTTPS redirect URIs and a public homepage/privacy-policy surface.
- Microsoft distinguishes Web redirect registrations from mobile/desktop public clients; hosted web-app token redemption is server-side and supports PKCE.

These external platform choices must be rechecked during implementation if their documented behavior changes.
