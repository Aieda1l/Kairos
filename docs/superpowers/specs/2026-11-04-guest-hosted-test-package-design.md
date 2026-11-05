# Isolated guest hosted-test package

Date: 2026-11-04

Status: local preparation under the user's request to proceed with the hosted test package. The engineering choices below are controller decisions for a Free-compatible diagnostic, not user approval to provision, upload, enable guest mode, change billing or accept a weaker production security boundary.

## Purpose and boundary

Prepare a concrete, independently reviewed package for the next guest capacity experiment. Use the real compiled default guest routes with synthetic data and two fresh disposable D1 databases. Keep the approved hybrid guest product and production configuration unchanged.

The package substitutes the inspected trusted application's HTTP transport through private fixtures. It is not platform-enforced fetch/connect isolation. Its local proof and any later hosted observations do not automatically satisfy the stronger sealed-egress, peak-memory, physical-retention, provider or activation gates in the [operator sequence](../../deployment/guest-acceptance.md). Unknown measurements remain null. Workers Paid is neither required nor enabled by this package.

## Components

| Component | Responsibility |
| --- | --- |
| Candidate application Worker | Dedicated proposed non-production HTTPS hostname; private operator gate; exact API allowlist; first-import transport prelude; unmodified compiled default application |
| Private fixture Worker | No routes, workers.dev or preview URLs; immutable scenario; synthetic challenge/Canvas/Ed responses; atomic bounded fixture counters; no application database or network fallback |
| Application D1 | All seven real migrations; only the application's ordinary guest admission mutations during workload |
| Fixture D1 | Fixture scenario identity and durable bounded counters; no credentials, source bodies or application table contents |
| Local operator tools | Offline preparation/verification, bounded driver, explicit setup/snapshot command inventory, null-safe metric templates and sanitized receipts |

A third control Worker is unnecessary for the first proof. Setup and quiescent observation are explicit operator operations outside the measured traffic window. Separate databases distinguish fixture activity from application costs.

## Hermetic original build

Export a verified Git commit into a fresh owned source directory; do not build from the developer's working directory or reuse stale dist. Reject symlink/path escapes and exclude environment files without reading their values. Preserve tracked application source, compiler configuration and dependency lock identities. Dependencies come from the already installed, verified workspace dependency tree; do not install or upgrade dependencies.

Use a strictly allowlisted child environment, omitting application/public/Cloudflare credentials and E2E/loopback flags. Explicitly set `CLOUDFLARE_VITE_FORCE_LOCAL=true`, `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`, `WRANGLER_SEND_METRICS=false`; isolate XDG state in an owned directory. Do not repurpose HOME, USERPROFILE or CODEX_HOME. Force-local avoids the inspected remote-binding authentication path; XDG alone is not a guarantee about all dependency filesystem access. Builder code must not read existing Wrangler auth profiles or private env contents.

Vinext can load dotenv before config hooks and Cloudflare can emit .dev.vars; envDir:false alone is insufficient. Fail if the sanitized build emits .dev.vars/.env material. Package only parsed/inventoried required modules and data, never an indiscriminate dist copy. Do not copy generated Wrangler/operator configuration or source maps/logs by default. Record build command/mode, allowed key names, source/config/lock/toolchain hashes and all retained module bytes. New private values must never be embedded in the build or manifest.

## Module and transport mechanism

Candidate entry imports `prelude.mjs` before the original compiled application entry. Preserve original compiled module bytes and relative paths. Do not rebundle/patch handlers, replace default factories, mutate framework private symbols or install/restore routing globals per request.

The prelude imports only the supported cloudflare:workers environment, defines a stateless fixture fetch, and installs it before application dependency evaluation. It performs no I/O during module initialization. Read the private service binding when the closure is invoked; never keep a mutable current-env/current-request pointer. Do not retain, export or retry through native fetch. Do not freeze fetch: Vinext may legitimately wrap it. Native proof must show the framework original-fetch alias naturally captures the guard.

Guard Request/URL/string inputs, method, exact approved synthetic destinations/resources/credentials, redirect mode and missing bindings. Preserve body ownership, cancellation and streaming responses. Unknown traffic fails with a fixed diagnostic and no fallback. Fixture validates requests independently and never calls a network API. Native outbound sinks are local proof instruments, not hosted controls.

Inventory static/dynamic imports and retained external capabilities. Unexpected network imports or unresolved edges fail preparation; reviewed framework computed-import exceptions require exact source/pattern/hash provenance and explicit limitations, not a generic node:* exemption. The current graph contains filesystem/module capabilities; route allowlisting and named-case proof cannot turn those into a platform sandbox. If the original multi-module application cannot load, stop with an unsupported-package result; do not quietly substitute the old rebundled single-string harness.

Delegate to the original default object's fetch with its original this/context and unchanged Worker bindings. Bind the application's real cross-module DB/origin/guest/challenge/HMAC requirements at the Worker, not solely in a replacement fetch argument. No auth/account/calendar/encryption credential binding, E2E bypass or local identity flag is allowed. If ASSETS is required for API initialization, use only a declared private rejecting fixture service and prove zero asset calls; do not silently publish a client/UI surface. A real asset upload requires a separate explicit inventory and review.

## Ingress, identity and configuration

Propose `guest-diagnostic.mykairos.me` for later operator review, with exact hostname binding only. No production hostname/wildcard, workers.dev URL rewrite, forged Host/Origin/client-address header or proxy bypass. Preserve the actual compiled proxy and guest validators. The wrapper permits only GET /api/health and POST /api/guest/session, /api/guest/sources/canvas/feed, /api/guest/sources/ed/courses and /api/guest/sources/ed/lessons; all else fails before application/D1/fixture dispatch.

Require a separate candidate operator secret before dispatch; secret names only in package/config. Native tests inject synthetic values in memory. Later operator provisioning supplies fresh synthetic signing/challenge/operator values outside argv, logs, receipts and upload-file inventory. Candidate has no Cloudflare API credential. Production guest defaults remain false.

Generate configuration from explicit per-component allowlists. Both workers disable persisted logs, invocation logs, traces, logpush and preview URLs. Fixture also disables workers.dev and has no route/custom domain. Candidate disables workers.dev and declares only its proposed dedicated custom domain. Compatibility settings derive from the reviewed original build. App and fixture D1 identities must be distinct, fresh and not production; binding names/service targets cannot be widened.

Offline preparation may retain unresolved account/database IDs in a clearly nondeployable template. Verification must reject placeholders, missing IDs, production collisions, drift and undeclared files/bindings before operator-ready use. No upload or resource creation path exists in preparation/local-proof commands. A resolved inventory is not itself operator approval.

## Fixtures and observation

One immutable run/scenario includes successful synthetic challenge, smoke and bounded near-cap Canvas/Ed fixtures. Generate large bodies during preparation, not per request. Use declared fixture operation keys/caps whose total is at most128. Reserve known calls atomically using D1 UPDATE ... WHERE calls<call_cap RETURNING; do not read-modify-write counters in JavaScript or use isolate globals. Counter-store failure, unknown run/operation and exhaustion deny. No administration/reset endpoint is exposed to the candidate. Configuration does not change during a run.

Durable call admissions are not proof of delivered response bytes. The driver independently requires completed responses/schema/count assertions. Timeout, uncertain counters, failed writes or unfinished work make the run incomplete; no automatic retry or counter reset can turn it into success. Observe before/after only after dispatch is quiescent. App snapshots retain every application table; only declared anonymous admission rows may differ. Store hashes/counts, not rows. Fixture D1/setup/observer costs are distinct from app workload costs.

Do not mutate shared env.DB/prototype methods for concurrent metrics. Aggregate Workers GraphQL CPU and sampled memory, and database-scoped D1 totals, can be requested later with account field/unit evidence. Per-request CPU/DB attribution and peak memory stay null under the disabled-log contract unless a supported source establishes them. Keep raw CPU scalar units unresolved until schema documentation verifies them. Quantiles are not totals/peaks; wall duration and process RSS are not hosted CPU/isolate evidence. API denial is unavailable evidence, not zero.

## First proof and caps

First bounded workload: health, real compiled bootstrap, one smoke Canvas read, Ed discovery/lesson read, wrong-origin and missing-capability denial, and six concurrent near-cap reads (two Canvas, two Ed courses, two Ed lessons). At most64 app requests, six concurrent,20seconds/request, five-minute dispatch deadline,128 fixture admissions. No automatic retry or driver redirects. Count failures as attempts. Native synthetic networks and actual independently observed hosted network subjects are distinct; one NAT or IPv6 /64 is one network. Full distributed/adversarial/cleanup/live-provider matrices remain deferred and explicit.

Local native proof loads the exact multi-module package with real migrations, private fixtures, cf:false, telemetry off and rejecting outbound sinks. It verifies prelude/early alias ordering, every actual default route, normal schemas/counts, guard and fixture rejection, budgets/counter races, no fallback, concurrent context isolation, table preservation and sanitized failure/disposal paths. Proof instrumentation is never included in upload inventory.

## Operator handoff

Deliver package digest, source/build/module/config/schema identities, exact proposed Worker/database names and hostname, unresolved fields, finite command/traffic inventory, separate cost channels, supported metric requests, local evidence and cleanup ownership. Creation yields IDs: an initial explicit action may authorize only named fresh resources; returned IDs must then resolve/revalidate config hashes against the unchanged code package before upload approval. No placeholder is deployment-ready. Fixture target deploys before the application after authorization; verify no existing ingress/production collision and available Free headroom first.

This increment completes preparation only. It does not purchase services, provision resources, upload, run real provider traffic, activate maintenance, deploy production or enable guest mode. Retain all source/evidence/worktrees until an explicit archival decision.
