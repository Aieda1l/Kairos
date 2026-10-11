# Milestone 6 privacy and security review

Scope: hosted identity/session handling, tenant boundaries, source/calendar credentials, OAuth requests, Firefox bridge boundaries, API/page/log disclosure, and release reproducibility. Manual production functional and calendar edge-case results are supplied by the user; the checks below provide the security evidence.

## Remediations

- The database-session callback previously spread internal session fields into the browser response, including the session token. It now returns only expiry and an explicit user-field allowlist. A regression test exercises the actual Auth.js session endpoint and verifies internal session fields/token are absent.

- Identity account links no longer retain access, refresh, ID, or OAuth 1 credentials. A production aggregate query found one identity access token and one ID token before remediation. Migration `0003_identity_token_minimization.sql` removes unused identity credentials while keeping users, account links, sessions, and encrypted calendar grants. Adapter and migration tests verify this behavior.
- The production Wrangler configuration explicitly disables persistent observability and enables query-string redaction. This protects authorization codes/states in request URLs. Application diagnostics already allowlist fixed provider/error categories and numeric statuses; they do not emit provider responses, request headers, token values, or private feed URLs. Raw privileged network inspection/tail output is not a shareable application diagnostic record.
- API mutations for sources, calendars, settings, and account deletion now require a matching Origin when supplied and reject cross-site/same-site fetch metadata without an Origin. Auth.js identity endpoints retain their own CSRF handling. Browser tests verify forged requests return 403 before changing settings, including a different port on the same hostname and opaque origins. Allowed requests remain bound to the authenticated user's scope.
- Canvas assignment links discard non-HTTP(S) schemes and URLs with embedded credentials, while preserving the assignment itself.
- Added a dependency lockfile and changed CI/deployment installs to `npm ci`. Installed package versions matched the generated lock before targeted upgrades. Patched `fflate` and `sharp` through overrides; no framework downgrade was applied.

## Boundary evidence

- All present production source/calendar credential and PKCE fields matched the versioned encryption-envelope format in an aggregate-only query. The cipher uses AES-GCM with random IVs and authenticated user/purpose/connection context; tests reject wrong users, purposes, keys, contexts, and modified ciphertext. No iCloud password row was present in the observed production snapshot; its repository, API, UI clearing, and encrypted persistence are covered by fixture tests and user-reported functional acceptance.
- Hosted source/calendar APIs were exercised with real D1-compatible repositories containing sentinel credentials. Responses exposed metadata without plaintext credentials or ciphertext/envelope fields. Authenticated server-rendered Sources HTML and rendered browser HTML were checked for private Canvas feed and iCloud password sentinels.
- OAuth requests persist hashed state and encrypted PKCE verifiers. Consumption checks user, provider, expiry, and a single atomic claim. Replay, cross-user consumption, wrong-provider attempts, expiry, and concurrent claims are covered by automated tests.
- Firefox manifests and bridge handlers use exact permitted origins, validate the message source/origin, and serialize only validated structured results. Credentials, cookies, headers, authenticated HTML, and upstream response bodies are excluded from the bridge protocol and app diagnostics.
- Auth.js database sessions use protected cookies. Browser tests verify logout clears the session, rejects replay of the old cookie, preserves the other user's access, and retains tenant data for a later sign-in.

## Dependency audit exception

The full npm audit still reports eight high-severity package entries caused by one unpatched [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). These entries propagate through globbing/build and lint packages, including the framework's Vite plugins. The registry currently provides no patched braces release.

The generated RSC, SSR, and client bundle module/import graphs were inspected: none of the affected packages were included in those artifacts. Patterns processed by these dependencies come from trusted build/lint configuration and repository paths; production assignment/source input does not enter the build pipeline. Development servers remain bound to loopback in testing. This is a documented build-tool maintenance exception, not a clean npm-audit result or a claim that every dependency is vulnerability-free. Reassess when a patch is published or build/runtime usage changes.

`vinext check` also reports its generic NextAuth compatibility warning and partial App Router Strict Mode support. The current integration uses explicit route handlers/header-based session resolution and is covered by hosted user sign-in/logout confirmation and browser/API tests. This review does not claim universal Auth.js support across other vinext configurations.

## Release evidence

Final verification, committed source revision, Worker version, identity-token cleanup counts, and hosted smoke results are recorded in the Milestone 6 acceptance/readiness records. Persistent logs remain disabled; no private provider response or credential value is copied into the review. Future rollback must preserve credential-key access and must not reverse D1 schemas or restore discarded identity credentials. A rollback to an older adapter may resume identity-token retention, so apply a forward correction before treating that revision as a secure steady state.

The final non-secret live canary confirmed that privileged real-time tail invocation metadata still exposes request query strings. The redaction flag must not be described as removing this administrator network-inspection view. With persistent observability disabled, retain only filtered application diagnostics and never save/share raw real-time request records. The probe did not contain a real authorization code, state, cookie, or token.
