# Kairos incident response

This runbook covers the reviewed Milestone 7 controls and maintenance tools.
It does not establish hosted acceptance. Apply it only after confirming the
actual deployed revision and schema. Never paste keys, user IDs, owner nonces,
private feed URLs, callback codes, request headers or provider bodies into a
ticket, terminal transcript, workflow log or chat.

## Triage and containment

1. Record time, public release revision, current Worker version and prior
   compatible version. Identify affected functionality and the extent of the
   incident using fixed event codes/statuses and counts. Preserve sanitized
   evidence; do not enable verbose Auth.js, provider or request logging.
2. Check public storage health, workflow failures and Cloudflare Workers/D1
   capacity. A health pass proves a constant storage query, not sign-in,
   provider access, tenant isolation or correct calendar writes. See
   [monitoring](monitoring.md) for limits and notification delivery checks.
3. Pause only the affected provider, or pause new sign-in initiation if needed.
   These tools are operator-only; there is no public administration endpoint.
   All commands default to dry run. Load the scoped Cloudflare API token,
   account ID and D1 database ID through private process environment variables
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_D1_DATABASE_ID`. Do not put their values in command arguments.

```text
node scripts/set-abuse-control.mjs --key=provider:microsoft --enabled=false
node scripts/set-abuse-control.mjs --key=provider:microsoft --enabled=false --apply
node scripts/set-abuse-control.mjs --key=auth:initiation --enabled=false --apply
```

Allowlisted keys are `auth:initiation`, `auth:google`,
`auth:microsoft-entra-id`, and `provider:canvas|ed|gradescope|google|microsoft|caldav`
(choose one literal provider name). Each enabled transition increments a
durable version; repeated identical settings do not. Provider pauses invalidate
old continuation versions. Pausing `auth:initiation` permits already admitted
sign-in callbacks; pause an identity provider separately when needed.
Pausing cannot cancel a request already sent upstream. Preserve accepted
assignments, mappings and credential rows while reconciling its outcome.

4. Diagnose with synthetic local fixtures or authorized test identities. Match
   the observed category to the failing layer before changing credentials,
   permissions or redirect registrations. Restore only the necessary control
   after remediation and authenticated smoke checks. Keep the version change
   and reopening decision in sanitized evidence.
5. If user data or credentials may be exposed, revoke the affected credentials,
   assess affected users and applicable notification obligations, and prepare
   a factual support/security response. The operator decides and sends any
   external communication. Do not disclose private evidence in public issues.

## Encryption-key rotation

`v1` in an envelope is its format/AAD version. `v1` and `v2` after that segment
are key IDs. Never edit ciphertext or relabel an envelope. Both keys must be
distinct canonical unpadded base64url encodings of exactly 32 random bytes.
Generate and retain them in a secure secret store, outside repository files,
workflow output and command arguments.

1. Verify a secure recovery point and all keys needed to decrypt it. Verify the
   new build reads both `KAIROS_CREDENTIAL_KEY_V1` and
   `KAIROS_CREDENTIAL_KEY_V2` before changing active writes. Initially keep
   `KAIROS_CREDENTIAL_ACTIVE_KEY_ID=v1` (the default). Retain the exact source,
   build/config and dual-key-compatible rollback identities.
2. Configure both keys privately in the Worker secret store, then deploy the
   verified dual-key-capable runtime. Read representative authorized credentials
   for both users/providers. Setting a secret can create a new Worker version;
   record the actual deployment again.
3. Change `KAIROS_CREDENTIAL_ACTIVE_KEY_ID` to `v2` only after all readers are
   dual-key capable. New credentials now use `v1.v2.*`; existing `v1.v1.*`
   credentials remain readable. Confirm new-write and old-read behavior using
   authorized test identities. Bind both keys and active `v2` privately into
   the maintenance process; it does not retrieve Worker secrets for you.
   Rotation requires an **explicit** maintenance active target of `v2`; a missing
   target or `v1` is rejected before writes. This command only supports forward
   v1-to-v2 migration. Confirm it matches the actual deployed active binding;
   the command cannot inspect that binding or validate it on your behalf.

```text
node scripts/rotate-credentials.mjs --dry-run --batch-size=50
node scripts/rotate-credentials.mjs --apply --batch-size=50
```

4. Each invocation scans at most 100 candidates (default 50). Dry run checks
   candidate decryptability without writes; repeated dry runs inspect the same
   leading candidates, not the entire database. Apply repeatedly in bounded
   batches, recording counts only. A decrypt failure stops the batch and yields
   a nonzero exit; earlier successful writes remain valid. Fix the underlying
   key/AAD/data issue before proceeding. Compare-and-swap preserves a concurrent
   replacement or discard; never recreate a deleted account or draft.
5. Rotation covers only known Canvas/Ed secrets, calendar refresh tokens,
   iCloud secrets, unexpired PKCE verifiers and the three encrypted onboarding
   draft settings, preserving each original user's purpose/context AAD.
   Expired PKCE envelopes remain counted as old-key dependencies until safely
   cleaned up. Plain calendar usernames and non-secret settings are unchanged.
6. Verify `remaining=0`, representative decryption for every provider and both
   identities, settled/expired request cleanup, and all recovery points and
   retained backups. `remaining=0` counts known non-active envelopes; it does
   not prove active-key ciphertext integrity or backup compatibility. Keep v1
   for every backup/recovery point that still needs it. Retaining both keys is
   the safe default; do not remove v1 automatically.

The wrapper bundles server code into ignored `artifacts/maintenance/` and runs
an isolated Node child with inherited private environment. No secret values are
embedded in that bundle. Its newly created bundle is removed in `finally` after
the child settles; deletion verifies the exact resolved child directory first.
The REST client uses a fixed HTTPS endpoint, rejects
redirects, bounds response size and total request/body time, suppresses raw
errors, and does not retry uncertain writes. Its source contract was checked
against the [Cloudflare D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
on October 13, 2026. Local fixtures and workerd probes do not prove production
REST permission or credential validity.

## Other credential rotation

- Deployment API token: create the least-privilege replacement, configure the
  protected production environment, verify a read-only preflight and scoped
  deployment/maintenance access, then revoke the old token. Do not use a Global
  API key. Keep scheduled cleanup disabled until its D1 permissions are tested.
- OAuth client secrets: pause the affected identity/provider, replace the
  secret **value** in the matching registration and secret binding, verify exact
  production Web redirects and account types, then use a fresh authorization
  flow. Preserve existing encrypted refresh tokens; reconnect only when the
  provider has revoked grants or the old token cannot refresh. Revoke the old
  client secret after the tested overlap period where the provider allows one.
- `AUTH_SECRET`: verify the runtime's session behavior and plan for session
  invalidation. Pause initiation as appropriate, update the binding, test fresh
  sign-in/logout and existing-session rejection, and tell affected users to
  sign in again. Do not claim dual-secret session support without implementing
  and testing it.
- `KAIROS_ABUSE_KEY_V1`: avoid resetting enforcement buckets during an incident.
  Its HMAC identity is a separate concern from credential encryption. This
  release does not implement an overlapping abuse-key rotation; pause affected
  starts and allow all enforcement windows/owned work to settle before a
  separately reviewed cutover. Do not rotate it as part of encryption rotation.

## Expired-state maintenance

```text
node scripts/maintain-abuse-state.mjs --dry-run --batch-size=100
node scripts/maintain-abuse-state.mjs --apply --batch-size=100
```

The bound is **per category**: at most 100 expired rate events, runs, OAuth
requests and settled bridge requests per invocation. Database time and expiry
indexes drive selection. FK-cascaded run-step rows are additional deletions;
reported counts describe parent rows. Running/uncertain owner rows are never
deleted. Expired run/OAuth metadata for a user with any such owner is retained.
Bridge metadata must be expired, consumed and attached to its exact idle owner
before cleanup. Unconsumed/legacy bridge metadata is retained conservatively;
elapsed time alone does not prove browser or remote work ended.

The protected hourly workflow is initially gated by repository variable
`KAIROS_MAINTENANCE_ENABLED=true`. Enable it only after M7 migrations/runtime
and a dry run are verified. Restrict the production GitHub environment's
deployment branch policy to `main`, require reviewed changes on protected `main`,
and verify an unauthorized-ref dispatch receives no production secrets before
enabling. Workflow source also limits the job to `refs/heads/main` and checks
out its exact triggering SHA. A source check does not verify environment rules:
the October 13 read-only API inspection returned 404, so those rules remain
unverified and workflow activation is blocked pending their inspection.
Manual dispatch defaults to dry run. Schedule runs
apply cleanup. Verify a real run and failure-notification delivery after enabling.
Hourly successful sweeps normally clear expired rate history within roughly two
hours only when the backlog fits these bounds. Scheduler delays, approvals,
failures or larger backlogs extend retention. Repeat bounded manual sweeps and
inspect counts when needed; do not promise a hard two-hour retention guarantee.
Live/uncertain ownership and retained legacy metadata require deliberate
settlement/recovery and can persist longer. User-authorized account deletion is
a separate flow.

## Targeted uncertain-operation recovery

1. Pause the affected provider. Locate the exact affected owner through an
   authorized private inspection; keep its user ID and owner nonce out of logs.
2. Establish that all prior server/browser work has stopped. Inspect remote
   calendars/submission outcome and reconcile mappings/accepted results. A
   timestamp, deployment, timeout or process restart alone proves neither
   termination nor settlement. If any work is still live or outcome uncertain,
   retain the lock and provide support guidance; do not issue new remote writes.
3. Set `KAIROS_RECOVERY_USER_ID` and `KAIROS_RECOVERY_OWNER_NONCE` privately in
   the operator process. Use the literal affected operation:

```text
node scripts/recover-operation.mjs --operation=calendar:microsoft
node scripts/recover-operation.mjs --operation=calendar:microsoft --apply --settlement-confirmed
```

Recovery targets only the exact user/key/owner and paused provider. It accepts
`uncertain` or stale `running` state; fresh running work is rejected. Apply
requires the operator's explicit settlement assertion. It CASes the same owner
to idle and retains its cooldown. New starts acquire a new nonce, so stale
continuations cannot regain ownership. Output is counts and a fixed assertion
label, **not proof of settlement**. Legacy unconsumed request metadata may remain
after recovery; do not broaden cleanup to erase it merely to reduce counts.
4. If recovered count is zero, reinspect privately; do not force a broad reset.
   After successful reconciliation, enable the provider and verify one fresh
   operation without duplicate remote writes. Preserve the sanitized decision.

## Rollback and reopening

Database restoration follows the separate [owner-only recovery/deletion policy](privacy-operations.md#recovery-access-deleted-accounts-and-key-retention). A code rollback does not authorize a database export or restore. Preserve a verified current live-account inventory before an owner restoration, remove recovered deleted accounts, invalidate recovered sessions and reconcile restored authorizations before reopening; otherwise remain closed.

Follow [deployment preflight and recovery](cloudflare.md#release-identity-and-recovery).
Rollback changes Worker code, not database schema or keys. After any v2 write,
the rollback target must support dual reads and contain both bindings. Preserve
all additive M7 schema and D1 data; never run down migrations or erase ownership
to make an older build run. When no compatible rollback exists, keep affected
operations paused and deploy a verified forward fix. Record public health,
authorized sign-in, two-user isolation, provider sync and idempotency results
before reopening. Actual controlled production rollback remains a release gate
until performed with a checked compatible target and authorized identities.

## Admission and diagnostic handoff

Use stable service/rate-limit codes and bounded Retry-After guidance to distinguish admission/control outages from expired provider authorization. Pause affected starts, preserve reads/logout and local data, and inspect actual aggregate capacity before reopening. Shared-network sign-ins share a provider/network budget; a rate rejection is not evidence that users need new provider credentials. Draft and regular credential entry share their provider budget, and rejected draft attempts retain saved input and working connections. Provider shutdown does not prevent local account deletion; confirmation admission still applies.

Native probe output distinguishes partial admission success from completion of admission plus ownership. Failures include only an allowlisted stage, never exceptions or provider payloads. In isolated local browser tests, `/api/test-fixtures/auth-transport` reports only counts of Siteverify and server provider requests; it is unavailable under hosted configuration. Negative tests require unchanged provider counts, independently of browser navigation. These fixtures are diagnostic acceptance tools and must never be enabled in production. Follow [privacy controls](privacy-operations.md) and [capacity/cleanup measurement gates](monitoring.md#admission-measurements-and-release-handoff).
