# Local native guest-retention validation

Run `npm run verify:guest-retention` (equivalently,
`node scripts/verify-workerd-guest-retention.mjs`) from the repository root with
the installed Node22 dependencies. The command needs no Cloudflare credentials,
private environment file, built application or deployed database. It imports the
actual `maintainAbuseState` helper and injects a disposable local Miniflare/workerd
D1 adapter after applying every real migration. It never invokes the remote
maintenance CLI. Cloudflare metadata fetching and telemetry are disabled; worker
outbound traffic goes to a rejecting local sink. Miniflare disposes its owned
ephemeral database on success and failure. Existing artifacts are retained.

The probe seeds205 expired null-user rate events, one explicitly eligible expired
account rate event, three recent anonymous and two recent account events. Other
synthetic fixtures cover an expired idle-owner run (and its cascading step),
OAuth request and consumed matching-owner bridge request. Recent metadata,
running/uncertain owners, unconsumed/mismatched/legacy bridge metadata, inert
account settings, users, operation locks and every abuse-control row are protected.
No coursework, real credentials, cookies or guest capabilities are used.

Eligibility timestamps come from the database clock. Expired fixtures are a day
behind that clock and live fixtures a day ahead, avoiding cutoff races; the probe
also rejects a run that crosses the future fixture boundary. Every dry-run/apply
compares complete application-table contents with exact expected snapshots.
Expected deletions come from the declared fixture set, independently of reported
counts. Actual SQL absence checks verify the expired backlog drained. Internal
`sqlite_*` and D1-reserved `_cf_METADATA` tables are excluded.

The rate backlog drains with a maximum of four cleanup invocations and a final
idempotent apply. Every helper result must report an integer between0 and100
**per cleanup table**. This is not a total bound of100: the first actual apply
deleted100 rate events plus one parent in each of the three other cleanup tables,
and the run deletion cascaded to one step. Expired account rate events are eligible
under the existing helper policy; preservation claims concern the explicitly
ineligible sentinels, not all expired account metadata.

On success, the script publishes a UTF-8 count/hash-only `receipt.json` under a
unique ignored `artifacts/guest-retention/<UTC>-<UUID>-native/` directory, then
prints its hash and summary counts. The receipt includes source ref/dirty status,
individual source/helper/config/migration input hashes, resulting schema/config
hashes, per-invocation counts and table snapshot hashes. Source input drift rejects
publication. Failed validation exits1 with the fixed diagnostic
`GUEST_RETENTION_VALIDATION_FAILED`, disposes the database and writes no success
receipt. A successful receipt is published only after disposal.

## Recorded run

One actual standalone native run completed on2026-11-04 at05:20:22–05:20:25UTC,
using clean source `e69a9fa426f9a0024064731a8da2ce194fd1381f` (`dirty:false`),
Node22.23.2, Windows x64, seven real migrations and22 application tables.
The command exited0. Documentation added after this run does not change its
measured source inputs.

| Invocation | Rate events | Runs | OAuth requests | Bridge requests |
| --- | ---: | ---: | ---: | ---: |
| Dry-run, snapshots unchanged | 100 | 1 | 1 | 1 |
| Apply1 | 100 | 1 | 1 | 1 |
| Apply2 | 100 | 0 | 0 | 0 |
| Apply3 | 6 | 0 | 0 | 0 |
| Final idempotent apply | 0 | 0 | 0 | 0 |

All205 expired anonymous events and the explicitly eligible expired account event
were absent afterward. Five live rate rows remained. Protected contents matched
exactly after every invocation. Outbound sink attempts were0.

| Retained evidence | Identity |
| --- | --- |
| Receipt | `artifacts/guest-retention/2026-11-04T05-20-22-310Z-3444b898-5531-4c36-9077-342dae814c39-native/receipt.json` |
| Receipt SHA-256 | `a31bee4aba21009587e274d922fbbf5327a2ec6c6a7272477b717812f321b5e2` |
| Schema SHA-256 | `52a2860e414ca9dfb1153650a7d5c2da98ae62f9374a4b8907565bc6b619c78a` |
| Config SHA-256 | `0e27b43042004dc0fa0b4b57e0ee9f7ff1137602d9f301b2c9de32c43b8b3f46` |
| Actual helper SHA-256 | `bc0757c9c02a00a0ed2c3901e0040e2713061617afc5fd282e0b72d07617e2c1` |
| Native command log | `.superpowers/sdd/2026-11-04-guest-release-validation/task-1-native-20261103T212021524.log` |
| Native log SHA-256 | `bc8113bb1f7fd98ff8c78f3a607950097637af761172fd6154cac206ddd19aa6` |
| Command exit receipt | Same log path plus `.exit.json` (exit0, command/ref/log hash) |

These local artifacts are ignored rather than committed; retain them with the
worktree or archive them before retiring it. The implementation report in that
SDD directory indexes focused RED/GREEN, lint and TypeScript logs. Nine focused
behavioral contracts passed, including controlled wrong deletion, preservation
mutation, fabricated counts, exceeded bounds, no progress, outbound attempts and
sanitized errors/disposal. Owned-file ESLint and `tsc --noEmit` exited0.

## Release limits

This establishes bounded logical cleanup on disposable native local D1. It does
not establish a hosted maintenance cadence, sustained capacity, physical retention
deadline, backup/recovery-history erasure, hosted CPU/shared-isolate memory,
deployed D1 billing or deletion from a live database. Recorded local elapsed times
are not hosted CPU measurements. Other cleanup tables contain small eligible
fixtures; only the rate backlog exceeds one batch.

The Free target remains the default. No maintenance activation, paid product,
provisioning, upload, provider request, deployment or public flag change occurred.
Base and production guest flags remain false. The hosted isolation/capacity and
operator live acceptance work in [the release sequence](guest-acceptance.md)
remains required, along with exact integrated-source CI, concrete production
candidate review and separate final deployment/activation approval.
