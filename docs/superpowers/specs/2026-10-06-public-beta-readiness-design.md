# Kairos Milestone 7 — Public Beta Readiness Design

**Date:** 2026-10-06  
**Status:** Approved design  
**Branch:** `feat/milestone-6-multi-user-hosted-foundation` (planning artifact; implementation branch will start after Milestone 6 merges)  
**Production domain:** `https://mykairos.me`

## 1. Goal

Prepare the hosted multi-user Kairos application from Milestone 6 for a real public beta.

Milestone 7 opens signup to anyone who can authenticate with Google or Microsoft. It does **not** restrict accounts to `@uw.edu` addresses and does not use an invite code. The product remains UW-first: Canvas browser integration continues to target `canvas.uw.edu`, the extension and documentation remain optimized for UW Seattle students, and general arbitrary-institution Canvas support is deferred.

This milestone is about launch safety, onboarding, provider production readiness, abuse resistance, extension distribution, operational visibility, privacy/support readiness, and controlled public availability. It does not broaden Kairos into a general education platform.

## 2. Product intent and success criteria

A first-time user should be able to visit `mykairos.me`, understand what Kairos is, sign in with Google or Microsoft, complete only the setup steps they want, and reach a useful dashboard without developer-only instructions.

A returning user should go directly to their dashboard and receive targeted recovery guidance when a source, calendar destination, browser extension, or provider authorization needs attention.

Success means:

1. Public signup is enabled for Google and Microsoft identities without invite codes or email-domain restrictions.
2. Kairos remains clearly UW-first and unofficial/non-UW.
3. First-run onboarding is understandable, skippable where possible, and does not force every integration.
4. Calendar permissions remain separate from Kairos login identity permissions.
5. Production Google OAuth branding/verification requirements are satisfied for the scopes Kairos actually requests.
6. Microsoft production app registrations and redirect configuration are hardened and documented.
7. The Firefox extension is Mozilla-signed and installable without `about:debugging`.
8. The extension has the required Firefox Manifest V3 data-collection declaration and accurately describes its behavior.
9. Public and expensive endpoints have layered abuse controls.
10. Operational logs and monitoring expose failures without exposing student data or credentials.
11. Privacy, terms, support, account deletion, and provider-revocation guidance are production-ready.
12. Deployment rollback and incident-response procedures are tested.
13. At least two independent real accounts complete the hosted end-to-end acceptance flow.
14. A final production-readiness and security review is green before public announcement.

## 3. Launch posture

Milestone 7 is a **security-first public beta**.

The implementation should optimize for a small-to-moderate number of real users while staying inside free infrastructure tiers where practical. The product may be publicly reachable and open to signup, but broad promotion must wait until the release gates in this spec pass.

There is no invite system. There is no UW email eligibility check. Kairos does not infer enrollment status from the authentication provider.

The launch switch is therefore operational rather than account-based:

- before release gates pass, production may be accessible for controlled acceptance testing;
- after gates pass, the homepage may advertise the public beta and normal signup remains open;
- if a severe incident occurs, signup initiation can be temporarily disabled without making existing user data inaccessible.

## 4. UW-first product boundary

Open signup does not change the current source scope.

Milestone 7 keeps:

- Canvas submission-status browser integration limited to `https://canvas.uw.edu/*`;
- Gradescope integration limited to the existing `www.gradescope.com` workflow;
- Ed integration as currently supported;
- Canvas private iCal feed onboarding as currently supported;
- UW-oriented copy where it accurately describes the intended beta audience.

The public homepage must say that Kairos is designed first for UW Seattle students while allowing anyone to create an account.

Milestone 7 does **not** add arbitrary Canvas domains, LMS discovery, institution profiles, or configurable Canvas host permissions.

## 5. First-run onboarding

### 5.1 Entry

A signed-out visitor sees a public homepage with:

- a concise product explanation;
- the unofficial/non-UW disclaimer;
- privacy and terms links;
- **Continue with Google**;
- **Continue with Microsoft**;
- a note that calendar access is optional and requested separately later.

After successful first sign-in, Kairos records onboarding state for that user and presents the setup flow.

### 5.2 Setup flow

Recommended sequence:

1. confirm timezone;
2. install or verify the Firefox extension;
3. connect Canvas deadlines through the private iCal feed;
4. optionally enable Canvas submission-status sync through a signed-in Canvas tab;
5. optionally connect Gradescope;
6. optionally connect Ed;
7. optionally connect Google, Microsoft, and/or iCloud calendar destinations;
8. finish into **Upcoming**.

Only account authentication is mandatory.

Every integration step is skippable. A user with only one connected source can finish onboarding and use Kairos.

The flow must preserve entered/connected state when the user moves backward or resumes later.

### 5.3 Returning users

Returning authenticated users normally go directly to **Upcoming**.

Kairos may show a compact setup/recovery prompt when:

- no source has ever been connected;
- the Firefox extension is required for an attempted action but unavailable;
- a provider authorization expired;
- a source has not successfully synced;
- a destination is in a reconnect-required state.

These prompts must not block unrelated parts of the application.

## 6. Authentication and account behavior

Milestone 6's tenant/session model remains authoritative.

Public-beta signup supports Google and Microsoft authentication with no invite code and no domain allowlist.

Important boundaries:

- sign-in identity scopes remain separate from calendar-write scopes;
- Kairos does not automatically merge accounts because Google and Microsoft report the same email;
- explicit cross-provider account linking remains out of scope unless separately designed;
- authentication failures do not reveal whether an email is already associated with another provider;
- account deletion remains self-service and user-scoped.

The account/settings page exposes:

- current authenticated identity/provider;
- timezone;
- connected sources;
- connected calendar destinations;
- extension status when detectable;
- reconnect/credential health;
- sign out;
- delete account.

Profile customization, usernames, social features, and public profiles are out of scope.

## 7. Google production readiness

Kairos must complete the production Google OAuth configuration required by the scopes it actually requests.

At minimum:

- the OAuth app identity matches the Kairos name/branding used on `mykairos.me`;
- `mykairos.me` ownership is verified as required by Google;
- the public homepage describes Kairos rather than acting only as a login page;
- the published privacy policy is linked from the homepage and the Google OAuth configuration;
- every requested Google scope is justified and kept to the minimum needed;
- sign-in scopes and Calendar scopes remain separate application flows/clients where practical;
- production redirect URIs exactly match deployed HTTPS callbacks;
- any required brand or sensitive-scope verification is completed before broad promotion;
- the verification/demo flow uses the same product and requested scopes that real users see.

If Google's classification of a requested scope changes, Kairos follows the stricter current verification requirement rather than relying on an old classification.

## 8. Microsoft production readiness

Production Microsoft identity and calendar registrations must be reviewed independently.

Requirements include:

- exact HTTPS redirect URIs for `mykairos.me`;
- separate identity and calendar permission intent in user-facing UX;
- only the delegated permissions Kairos needs;
- client credentials stored only as deployment secrets;
- tenant configuration matching the intended public-account audience;
- production consent screens and publisher/application metadata matching Kairos branding;
- documented rotation/revocation procedure for client credentials;
- hosted connect, reconnect, refresh-token rotation, and duplicate-prevention acceptance tests.

A configuration that works only with the developer's own tenant/account is not sufficient for public beta.

## 9. Firefox extension distribution

### 9.1 Signing

Release/Beta Firefox requires Mozilla-signed extensions. Milestone 7 therefore replaces temporary `about:debugging` installation as the normal user path.

The release extension must:

- retain a stable extension ID;
- pass Mozilla automated review and any required manual review;
- be signed through addons.mozilla.org;
- be listed on AMO unless self-distribution is intentionally chosen and documented;
- provide a normal install/update path for beta users.

AMO listing is the preferred path because it gives users standard discovery/update behavior.

### 9.2 Data collection declaration

The Manifest V3 `browser_specific_settings.gecko.data_collection_permissions` declaration is mandatory for new AMO submissions under current Firefox requirements.

Kairos must declare the narrowest truthful value. If the extension itself does not collect/transmit categories covered by Mozilla's declaration system beyond the explicit normalized bridge behavior, the manifest should declare that accurately rather than using a broader category for convenience.

The AMO listing/privacy disclosure and in-product explanation must agree with the actual extension behavior.

### 9.3 Permissions

The extension continues to avoid broad capabilities such as:

- `<all_urls>`;
- cookie API permission;
- history permission;
- downloads permission;
- webRequest interception.

Allowed application origins remain explicit. Arbitrary HTTPS origins are not accepted.

## 10. Abuse protection

### 10.1 Principles

Abuse controls should protect provider quotas and free-tier infrastructure without making ordinary student use feel rate-limited.

Controls are layered:

1. managed bot challenge for unauthenticated signup initiation;
2. per-user rate limits after authentication;
3. per-resource/provider concurrency limits inside sync logic;
4. existing idempotency/deduplication;
5. provider-aware backoff for upstream rate limiting.

Rate limits never depend on the user's email domain.

### 10.2 Turnstile

Use Cloudflare Turnstile on the public authentication initiation surface.

The preferred mode is a managed/invisible-as-possible challenge so normal users are not routinely asked to solve puzzles.

Server-side authentication initiation verifies the Turnstile token before starting a new public OAuth login.

Turnstile is not required for normal authenticated dashboard reads or every API request.

### 10.3 Rate-limit classes

Use Cloudflare Worker rate-limit bindings when compatible with the deployed plan/runtime. If a required binding is unavailable, the implementation plan must choose another server-side limiter without weakening the semantics below.

Initial configurable budgets:

| Class | Initial budget | Key |
| --- | --- | --- |
| Public auth initiation | 20 attempts / 10 min | coarse client/network key + provider |
| Provider credential test/connect | 10 attempts / 10 min | user + provider |
| Source-specific manual sync | 12 attempts / 10 min | user + source |
| Calendar-specific manual sync | 12 attempts / 10 min | user + destination |
| **Sync All** | 6 attempts / 10 min | user |
| Account deletion confirmation | 5 attempts / hour | user |

These are operational defaults, not API guarantees. They may be tuned without changing product semantics.

A rejected request returns a stable rate-limit error and a bounded retry-after value where appropriate. It must not reveal another user's activity.

### 10.4 Provider concurrency

A single user must not be able to fan out unlimited provider work.

Existing bounded calendar concurrency remains. Source sync orchestration should likewise prevent repeated concurrent requests for the same user/source from spawning duplicate upstream work.

Concurrent duplicate actions should join, reject, or coalesce rather than execute independently.

## 11. Operational logging and privacy

Production logs use structured events with:

- request/correlation ID;
- stable error/event code;
- route/action category;
- provider name when non-sensitive;
- coarse result/status;
- latency/duration where useful;
- deployment/version identifier.

Production logs must not contain:

- user assignment titles/content unless explicitly required for a narrowly scoped diagnostic and separately redacted;
- course names as routine telemetry;
- plaintext or encrypted credentials;
- OAuth authorization codes;
- PKCE verifiers;
- access/refresh tokens;
- Canvas private feed URLs;
- session cookies;
- authenticated Canvas/Gradescope HTML;
- authorization headers;
- raw provider response bodies.

User IDs should be omitted from ordinary external logging where possible. If correlation to a user is necessary for operational diagnosis, use a stable non-reversible diagnostic identifier rather than email address.

## 12. Monitoring and health

Milestone 7 does not build an internal admin dashboard.

Operational visibility comes from the hosting/deployment platforms plus explicit health checks.

Minimum monitoring:

- Cloudflare Worker error/request metrics;
- D1 error/limit monitoring;
- deployment status from GitHub Actions;
- scheduled synthetic check of a non-secret health endpoint;
- alerts for failed production deployment;
- alerts/visibility when free-tier D1/Workers capacity is approached or exhausted;
- provider-specific error-rate visibility using stable codes.

A health endpoint must not touch or enumerate user data.

The application must handle free-tier exhaustion as a service error, not corrupt or partially cross-write user state.

## 13. Support and contact

Before public beta, `mykairos.me` provides a clear support/contact path.

Preferred low-cost setup:

- `support@mykairos.me` routed through Cloudflare Email Routing to a monitored existing mailbox;
- `security@mykairos.me` routed separately or to the same monitored destination with a distinct rule.

Inbound routing is sufficient; Milestone 7 does not require outbound transactional email.

Do not expose a personal mailbox address publicly when a domain alias can be used.

Security-report instructions should discourage posting credentials, private Canvas feed URLs, or account data in public issue trackers.

## 14. Privacy, terms, and user control

The privacy policy becomes a launch artifact, not placeholder copy.

It must accurately describe:

- account identity data Kairos stores;
- assignment/source data stored;
- third-party credential/token handling;
- application-level encryption of sensitive credentials;
- browser-extension behavior;
- third-party providers used for authentication, calendars, hosting, and storage;
- operational logging/retention;
- why Kairos processes this data;
- account/data deletion behavior;
- how to revoke provider authorization;
- support/security contact paths;
- the unofficial/non-UW relationship.

Terms must include the intended beta nature of the service and the unofficial/non-UW disclaimer without claiming protections or guarantees the project cannot deliver.

The product must not claim FERPA, SOC 2, HIPAA, or other compliance certifications unless actually obtained and applicable.

## 15. Recovery UX

Expected failures receive targeted actions.

Examples:

- missing Firefox extension -> install/verify extension guidance;
- Canvas/Gradescope signed-out tab -> ask user to sign into that site and retry;
- parser/source change -> preserve prior data, explain source extraction failed;
- expired Google/Microsoft calendar authorization -> **Reconnect**;
- deleted remote Kairos calendar -> explain the remote calendar is missing before reconnect/recreate action;
- invalid iCloud app-specific password -> replacement flow that preserves the prior working credential until validation;
- provider rate limit -> retry guidance using bounded backoff;
- Kairos deployment/storage outage -> service-unavailable message that does not suggest reconnecting credentials unnecessarily.

Generic "something went wrong" pages are the fallback, not the normal recovery experience.

## 16. Incident response and emergency controls

The repository includes a concise production incident runbook.

It covers:

1. confirm/triage the incident without copying secrets into tickets/chat;
2. pause new signup initiation if necessary;
3. disable a provider integration if its credentials/client are compromised;
4. rotate Kairos deployment secrets and encryption keys according to the documented procedure;
5. revoke/rotate Google/Microsoft client credentials when required;
6. roll back to the last known-good Worker deployment;
7. preserve evidence without exporting plaintext user credentials;
8. determine whether affected users must be notified;
9. document remediation before reopening the affected path.

Emergency controls must not require deleting the production database.

Encryption-key rotation must preserve decryptability of existing versioned envelopes until re-encryption is complete.

## 17. Deployment and rollback

Public beta requires a repeatable production deployment runbook.

The runbook includes:

- exact production build command;
- D1 migration procedure;
- secret/config validation;
- deployment command/workflow;
- smoke checks after deployment;
- rollback to the prior Worker version;
- rules for forward-only database migrations;
- what to do if code rollback and schema rollback are incompatible.

Automatic production deployment from `main` is acceptable only after this process has been exercised manually at least once and rollback has been proven.

Database migrations should prefer additive/backward-compatible transitions so a previous application version can continue operating during rollback when practical.

## 18. Release acceptance

Milestone 7 is complete only when all of the following pass:

1. Open Google and Microsoft signup works for users not pre-added as invite/test users where provider policy permits production access.
2. No `@uw.edu` eligibility requirement exists.
3. The public site still describes Kairos as UW-first and unofficial/non-UW.
4. First-run onboarding can be completed with only one source and optional steps skipped.
5. Returning users bypass onboarding unless recovery/setup prompts are relevant.
6. Google production OAuth/brand verification required by the requested scopes is complete or the app is otherwise demonstrably in the provider-approved production state for public use.
7. Microsoft production identity/calendar registration passes hosted multi-account acceptance.
8. The Firefox extension is Mozilla-signed and installable through the chosen production distribution path.
9. The extension's data-collection declaration, AMO listing, privacy policy, and actual behavior agree.
10. Turnstile blocks auth initiation when verification is absent/invalid and does not gate normal authenticated reads.
11. Per-user/provider rate-limit tests cover allowed, rejected, reset, and cross-user isolation cases.
12. Duplicate concurrent sync requests cannot multiply provider work without bound.
13. Structured logs pass secret/PII redaction tests.
14. Health checks and deployment-failure visibility are operational.
15. `support@mykairos.me` and `security@mykairos.me` (or explicitly documented equivalents) reach a monitored destination.
16. Privacy policy and terms match the deployed behavior.
17. Account deletion and provider-revocation instructions are verified against a real hosted account.
18. Production rollback is exercised successfully.
19. At least two independent real users/accounts complete hosted end-to-end flows without sharing state.
20. Existing Google, Microsoft, and iCloud calendar real-account smoke tests pass in production configuration.
21. Existing Canvas, Gradescope, and Ed flows remain functional for the UW-first beta.
22. A final repository-wide security review finds no unresolved Critical/Important launch blocker.
23. A final production-readiness review gives a go decision before broad public announcement.

## 19. Explicit non-goals

Milestone 7 does not include:

- arbitrary/non-UW Canvas domains;
- automatic institution discovery;
- Chromium/Chrome extension support;
- billing/subscriptions;
- paid plans;
- collaboration/social features;
- admin impersonation;
- AI planning/prioritization;
- mobile-native applications;
- broad product analytics or ad tracking;
- notification infrastructure;
- scheduled always-on Canvas/Gradescope browser sync;
- guaranteed 24/7 SLA;
- FERPA/SOC 2/HIPAA certification;
- automated cross-provider account linking;
- marketing campaigns beyond opening the beta.

## 20. Follow-up direction

After Milestone 7, future roadmap work should be driven by actual beta evidence rather than precommitting a large feature list.

Likely candidates include:

- generalizing Canvas beyond UW;
- Chromium extension support;
- opt-in server-side scheduled sync for sources that do not require the browser;
- notifications;
- onboarding improvements discovered from beta use;
- cost/performance work if free-tier ceilings become material.

## 21. External constraints verified during design

The design reflects current platform guidance checked on 2026-10-06:

- Firefox release/beta installation requires Mozilla signing; AMO performs automated review and can require manual review.
- New Firefox extension submissions require `browser_specific_settings.gecko.data_collection_permissions`.
- Google production OAuth requires accurate app identity/branding, an owned-domain homepage, a published privacy policy, domain verification, and additional verification for sensitive/restricted scopes.
- Cloudflare Turnstile offers a free managed challenge suitable for public signup abuse resistance.
- Cloudflare Workers exposes route/resource-specific rate-limiting bindings; exact plan/runtime availability must be confirmed during implementation.
- Workers Free and D1 Free have hard capacity limits; D1 now rejects operations after daily free-tier row limits are exhausted, so beta operations must monitor those limits.
- Cloudflare Email Routing supports free inbound forwarding for domain addresses, which is sufficient for support/security aliases without adding outbound transactional email.

These external constraints must be rechecked during implementation and immediately before public launch because provider policies and free-tier limits can change.
