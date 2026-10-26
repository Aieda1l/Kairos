# Guest capacity readiness

Status: implementation can remain behind the disabled guest flag. Hosted capacity
and launch acceptance are **OPEN**. These local checks do not authorize guest
activation, deployment, maintenance, new keys, billing changes or real provider
traffic. Base and production `KAIROS_GUEST_ENABLED` defaults remain `false`.

## Reproduce the preliminary evidence

```sh
node scripts/verify-workerd-guest-sources.mjs
node scripts/measure-guest-source-parsers.mjs
npm run build:vinext
node scripts/verify-workerd-provider-completion.mjs
```

The native check is also in Feature CI immediately after the Workers build.
Receipts are UTF-8 JSON under ignored
`artifacts/guest-source-capacity/<UTC timestamp>-native/receipt.json` and
`<UTC timestamp>-node/receipt.json`. Each records the measured Git ref, dirty
qualification and SHA-256 hashes of scripts and relevant source inputs. A run
before commit is preliminary; integrated-source acceptance must rerun against
the final reviewed source. Receipts contain counts, timings and hashes, never
credentials, cookies, capabilities, coursework bodies or raw provider errors.

## What the native check establishes

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
in the preliminary run. These are fixture observations, not capacity forecasts.

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
| Local native transport/admission | Preliminary local evidence | Passing receipt with all results true and zero unexpected/internet attempts; final integrated-source rerun |
| Hosted Worker CPU | **OPEN** | Deployed per-request CPU for near-cap success, parse failure, redirect, admission denial and bootstrap paths |
| Shared-isolate memory | **OPEN** | Hosted peak memory and failures under bounded concurrent near-cap traffic |
| Denial/bootstrap capacity | **OPEN** | Deployed D1 statements and billed rows under distributed bootstrap and denied traffic; upstream cap alone is insufficient |
| Cleanup capacity | **OPEN** | Cleanup cadence, deletion/index write cost, backlog and recovery evidence without exceeding capacity |
| Physical retention | **OPEN** | Verified physical deletion mechanism/cadence and retention bounds; `purge_after_ms` alone does not prove deletion |
| Operator live acceptance | **OPEN** | Separately authorized Canvas, Gradescope and Ed acceptance, ingress configuration and operational review |

No hosted measurements, live provider checks or maintenance activation are part
of this S4 evidence. If hosted measurements exceed a limit, resolve the workload
or operating-plan decision before activation; do not silently raise guest budgets
or reinterpret local measurements as a passing hosted gate.
