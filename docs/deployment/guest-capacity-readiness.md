# Guest capacity readiness

Status: guest behavior is merged and exact-main CI has passed behind the disabled
guest flag. Hosted capacity and launch acceptance
are **OPEN**. These local checks do not authorize guest
activation, deployment, maintenance, new keys, billing changes or real provider
traffic. Base and production `KAIROS_GUEST_ENABLED` defaults remain `false`.

The [acceptance ledger and operator sequence](guest-acceptance.md) records exact
receipt identities, local suite results, CI source/graph coverage and remaining
review/live gates. This page preserves the earlier S4 measurements below; their
precommit status is not retroactively changed by later passing integrated checks.

## Reproduce local evidence

```sh
npm run build:vinext
node scripts/verify-workerd-guest-sources.mjs
node scripts/measure-guest-source-parsers.mjs
node scripts/verify-workerd-provider-completion.mjs
```

The native check is also in Feature CI immediately after the Workers build.
Receipts are UTF-8 JSON under ignored
`artifacts/guest-source-capacity/<UTC timestamp>-native/receipt.json` and
`<UTC timestamp>-node/receipt.json`. Each records the measured Git ref, dirty
qualification and SHA-256 hashes of scripts and relevant source inputs. A run
before commit is preliminary; integrated-source acceptance must identify the
reviewed runtime/configuration inputs. Documentation-only commits can retain
those input hashes without claiming a new runtime build. Receipts contain counts,
timings and hashes, never credentials, cookies, capabilities, coursework bodies or
raw provider errors.

## Current CI and PR 53 measurement boundary

PR 53 merged as `0a44c6a`. Its required PR CI and automatic [exact-main CI run 782](https://github.com/Aieda1l/Kairos/actions/runs/41777091070) passed, including 2,197 unit tests, all 143 browser cases, builds and 81 sealed native guest checks. The ECC integration correction `be6b762` changes Canvas structural parsing and malformed-result accounting; its focused 98-test suite and independent fix review passed, followed by the new integrated CI. The [acceptance ledger](guest-acceptance.md) records exact identities and the native receipt's dirty-source qualification. Older local receipts below remain tied to their measured source and do not transfer to the correction.

The [disposable local retention probe](guest-retention-validation.md) now checks actual deletion and preservation with the real helper and migrations. It does not establish hosted cost, a sustainable cadence, maximum retention or recovery-history erasure. No deployed CPU/memory/D1 billing or live-provider acceptance evidence was added; guest activation remains off.

An offline [hosted diagnostic package](guest-hosted-test-package.md) is now prepared with two Workers/two disposable D1 templates, explicit package/identity/approval gates, private fixtures, atomic counters and a bounded driver. Local H2 verification passed 36 focused tests and the formal native proof: 13 complete requests, ten fixture admissions, 28 new anonymous rows, all 21 protected tables unchanged, and zero outbound/asset sink calls. This is local preparation, not an uploaded or measured hosted candidate. The native ingress, self-signed loopback connector and proof instrumentation remain separate from upload files. Hosted mode has only fake-adapter test coverage; no account API or provider run occurred.

The diagnostic preserves original compiled application modules and substitutes inspected HTTP calls through private fixtures. It is trusted-code transport substitution, not platform-enforced egress isolation or a complete capability sandbox. Cloudflare's [Dynamic Workers egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/) offers one stronger boundary, but [requires Workers Paid](https://developers.cloudflare.com/dynamic-workers/pricing/); that is not evidence that the guest application itself requires Paid. Unsupported per-request CPU/D1 attribution and peak memory remain null. Package review is accepted for offline preparation. Fresh protected CI/integration, exact operator inventory/headroom, identity resolution and explicit resource/upload approval precede any hosted experiment. No billing or production configuration changed.

## Prior implementation-review receipt (before PR 53 ECC)

Clean runtime commit `2688f9b053c5d4adcf7b27f7384b3510c2f1ea57` has native receipt `artifacts/guest-source-capacity/2026-11-01T12-06-43-463Z-native/receipt.json`, SHA-256 `9dea53f1f70eeee38b6d71a86bdf346a7cfba9d73d1f2ef0d75b7fe355176971`: 81/81 checks across five phases, all 120 input hashes matching. Next/Vinext builds and sealed provider/iCloud/dynamic/safety checks passed. M1 persistence ownership changes mean the older receipt below does not transfer to current source. The standard full browser run on this commit failed with 141 passed and two Firefox failures; subsequent test-only commit `2277c14` passed the four affected cases in both browsers, without changing runtime or the isolation test's 180-second outer ceiling. All 143 distinct cases have passing coverage across separate runs; this is not one full green suite on the final test commit. Native input hashes and the compiled server bundle still match. The [acceptance ledger](guest-acceptance.md) records exact identities, retained traces and qualifications. Scoped re-review is accepted with no open findings; exact-source Linux CI required before release, hosted capacity and activation remain OPEN.

## Historical final-review fix receipt

The fresh clean implementation commit `db8c0c09aed11ba5181210f6e6b4d517cb8db977` has a local native receipt at `artifacts/guest-source-capacity/2026-10-29T21-45-38-209Z-native/receipt.json` (SHA-256 `ad112a7977e73bfbf7465ea7b9419f0affd6c2b2fdf2a9eb1fe10d637c5218f8`). It passed 81/81 checks across five phases, with 120 matching measured input hashes. The compiled guest wrong-origin denial made zero D1/account statements and zero fixture upstream calls. The [acceptance ledger](guest-acceptance.md) records the separate bundle identities, later test-only commits and unresolved full-browser failures. This is local synthetic evidence; hosted capacity, retention and live-provider gates remain OPEN. The A2/A3 observations below are historical.

## What the native check establishes

The final A2 check and fresh A3 check passed **79 checks across five phases**.
The fresh clean-source receipt is
`artifacts/guest-source-capacity/2026-10-28T21-56-23-135Z-native/receipt.json`,
source `c0f8763e3284da851db6b798b00f1c2684684104`, SHA-256
`2000272773f97efa26316beb05ff48178c041c4070c94cf8b731acfb169f4e1a`.
All 119 recorded input hashes matched. The compiled phase exercises the actual
built default session/Canvas/Ed routes without fixture flags or identity/calendar
credential bindings. Its four observed fixture calls (one challenge, three
provider reads) add ten anonymous admission rows while 21 protected tables remain
unchanged. It records zero account SQL/protected writes, rejecting-sink attempts
and unexpected fixture destinations. See the acceptance ledger for distinct input
and rebundled SHA-256 identities.

The runner bundles the actual guest source/session handlers, feature check,
runtime, admission SQL, source transports, parsers and response schemas. Two
independent workerd services share fresh D1 with all real migrations. Bindings
contain synthetic anonymous HMAC/Turnstile/origin configuration only; there are
no Auth.js, Google, Microsoft, calendar credential or account/session fixtures.

`cf:false`, disabled telemetry and explicit `outboundService` routing seal the
network. Application fetch goes through a local outbound gate to a fixture
worker. Fixture administration is available only to the driver. All workers'
remaining outbound paths terminate at a rejecting sink. Unexpected destinations
and attempted sink requests must be zero; the fixture itself never calls the
internet. Synthetic provider and challenge requests are counted separately.

The fixture-only ingress drains the tiny generated JSON input before dispatch
to avoid Miniflare keep-alive resets after early rejection. It restores the
driver's exact Origin, Host and synthetic client address, including deliberately
forged Origin/Host values. This is **not** production gateway or request-body
timing evidence; the S3 focused tests own slow-input shared-deadline coverage.
Upstream overflow/stall cases still use native streaming bodies.

Coverage includes:

- Same-origin Canvas redirects, escaped redirects rejected before a second
  destination, at most six Canvas requests, and Ed redirects rejected after one
  request.
- Ordinary-event empty Canvas success, no-event `EMPTY_FEED` rejection, partial
  Canvas results, empty Ed results, malformed UTF-8, no-length byte overflow,
  and a stalled upstream body stopped by the real 15-second deadline.
- Provider version change during Canvas fetch, Ed pause during fetch, and an
  already-paused provider rejected before admission or upstream work.
- Missing capability and forged Origin/Host rejected before D1 or upstream work.
- Six concurrent admitted reads across two services: two each of Canvas 2,000
  assignments, Ed 500 courses, and Ed 2,000 raw/1,000 visible lessons. Each body
  is 2,097,088 bytes; aggregate generated input is 12,582,528 bytes. Fixtures are
  generated deterministically, not committed as megabyte blobs.
- Forty requests contending for one session: 30 admitted, 10 denied. Sixty-four
  distributed bootstraps followed by 64 concurrent reads: 60 admitted, four
  denied by the shared global budget. Bootstrap network exhaustion is measured
  separately and denies before Siteverify.

Every phase compares full content hashes for **all application tables**, including
controls, sources, coursework, drafts, OAuth, bridge and operation-owner tables.
Only declared null-user `abuse_rate_events` inserts may differ. Control pause and
version changes are explicit fixture-driver injections: their exact before/after
rows and D1 costs are recorded and used to construct the expected snapshot.
Guest SQL instrumentation independently rejects unmeasured batch/exec work and
counts attempted protected writes. Cloudflare's inaccessible `_cf_METADATA` and
SQLite internal tables are identified separately; they are not application data.

## D1 and denial costs

The upstream read cap does not bound all D1 work. Global denial happens **after**
the network and session budgets are charged. A measured later global denial
inserts two anonymous admission events and performs no upstream request. It
executes five D1 statements: an initial provider-control read, three attempted
admission INSERTs and one denial SELECT. Native metadata in the preliminary run
reported 70 rows read and 10 rows written for that request; these are local
Miniflare counters, **not deployed D1 billing**. Indexed writes can exceed the
number of inserted event records. Concurrency may change observed read counts.

The receipt separates total/admission statements, read/write statements, changed
event rows, native rows-read/written counters and missing-counter indicators.
Failed admissions are included. Migration, observer snapshot/count queries and
fixture-driver control mutations have separate statement counts and native
metadata; none are attributed to guest traffic or called zero-cost. Admission
INSERTs count as attempted write statements even when no row is admitted.

The distributed phase creates 263 admission event rows: 73 successful bootstrap
charges, 128 network/session charges for its first 64 reads, 60 global charges,
and two charges for the later global denial. The additional bootstrap denial
does not add a row. All four phases together produced 441 anonymous event rows
in the preliminary four-phase S4 run. The final five-phase A3 run includes the
compiled phase: 451 anonymous event rows, 961 guest SQL statements (483 admission;
467 attempted admission INSERTs and 16 denial SELECTs), and local native counters
of 6,018 rows read / 2,255 rows written. Observer/migration/control costs remain
separate. These are fixture observations, not capacity forecasts or billed rows.

## CPU and memory interpretation

`GUEST_LOCAL_PARSER_MEASUREMENTS` always has
`evidenceType:"node-process-cpu"`. It measures the actual bounded source reader,
stream decoding, parser, normalization and schema pipeline with synthetic fetch,
one warmup and five recorded samples. Fixture generation and bundling are outside
each sample. It records bytes, input/output counts, output size, elapsed time,
Node process user/system CPU and process RSS snapshots. No admission/D1 runs in
this benchmark. Windows CPU counters can be quantized; zero-valued samples are
retained and do not mean that the pipeline used no CPU. RSS is neither a peak nor
an isolate memory measurement.

The native burst is local wall time, with aggregate input/output size and
concurrency recorded. Neither local elapsed time nor Node process CPU establishes
deployed Worker CPU. Neither process RSS nor the sum of body sizes establishes
shared-isolate peak memory.

Cloudflare's limits checked on 2026-10-26 list 10 ms CPU for Free HTTP requests and
128 MB memory per isolate, shared by concurrent requests; network/database waits
are distinct from CPU. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
The Free D1 limit is 50 queries per invocation, with documented batch-call
handling. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
Free daily allowances are 5 million rows read and 100,000 rows written; index
updates and deletion also affect writes. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
These published limits are constraints to verify against hosted measurements,
not a claim that the local fixtures meet Free capacity.

## Remaining release gates

| Gate | Status | Required evidence |
| --- | --- | --- |
| Local native transport/admission/compiled routes | **PASS, local** | Main `0a44c6a` CI run 782: 81 checks plus full browser graph; older receipts below remain historical; no hosted capacity inference |
| Implementation task, whole-branch and scoped fix reviews | **ACCEPTED** | All eight findings addressed; this does not approve public activation |
| Exact integrated-source Linux CI | **PASS** | Exact-main run 782 linked above; 2,197 unit and 143 browser cases, full graph successful |
| Hosted Worker CPU | **OPEN** | Deployed per-request CPU for near-cap success, parse failure, redirect, admission denial and bootstrap paths |
| Shared-isolate memory | **OPEN** | Hosted peak memory and failures under bounded concurrent near-cap traffic |
| Denial/bootstrap capacity | **OPEN** | Deployed D1 statements and billed rows under distributed bootstrap and denied traffic; upstream cap alone is insufficient |
| Cleanup capacity | **OPEN** | Local bounded drain/preservation probe passes; hosted cadence, deletion/index cost, sustained backlog/recovery still need evidence |
| Physical retention | **OPEN** | Verified physical deletion mechanism/cadence and retention bounds; `purge_after_ms` alone does not prove deletion |
| Operator live acceptance | **OPEN** | Separately authorized Canvas, Gradescope and Ed acceptance, ingress configuration and operational review |

Physical expiry is only eligibility: the existing
[bounded cleanup](../../scripts/lib/abuse-maintenance.mjs) selects expired
`purge_after_ms` rows, and the [hourly maintenance workflow](../../.github/workflows/production-maintenance.yml)
is gated by `KAIROS_MAINTENANCE_ENABLED`. Source/configuration does not prove that
it ran, kept up, or physically removed guest rows. Both operator authorization and
measured deletion/catch-up evidence are still required; A3 did not activate it.
The [admission repository](../../src/lib/db/d1/repositories/rate-limits.ts) sets
eligibility one hour after admission; that is not a one-hour physical retention
promise. The configured batch removes at most 100 rate rows per invocation.
Bootstrap admission is per network, with no global bootstrap cap; the global
source-read budget cannot bound distributed bootstrap churn or cleanup backlog.

No hosted measurements, live provider checks or maintenance activation are part
of the S4/A2/A3 evidence. If hosted measurements exceed a limit, resolve the workload
or operating-plan decision before activation; do not silently raise guest budgets
or reinterpret local measurements as a passing hosted gate.
