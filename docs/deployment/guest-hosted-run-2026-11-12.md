# First isolated guest hosted diagnostic outcome

Status: incomplete before driver application dispatch; all owned remote test resources removed. This is an observer compatibility result. Guest workload capacity remains unmeasured.

## Frozen packet and setup

The separately approved packet used application revision `f13431c487266c3982b4aa9fdcda29e705aac7e6`. Its unresolved package digest was `8fd068a3335f6d547b2b305eb5b47105f0a2a27d791748abcddc7f3194537adc`; resolving the returned account/database identities produced `cb4dea4b9b5ddb7662a89833c291698d17b86710cccbf0c6b78477cbfbbb08e9`. All 327 upload modules retained their bytes; only the two identity configs changed.

Two private Workers and two fresh disposable D1 databases were created. The app's seven migration files were applied once and its 22 owned tables verified. The fixture CREATE file's final comment produced REST error 7500, “SQL code did not contain a statement.” Read-only EXPLAIN succeeded after removing only two known full-line comments. The unchanged CREATE statement and constraints, followed by the exact seven INSERTs, were applied with original/submitted hashes recorded. No app migration was replayed.

Both exact uploads/private activations, binding/runtime readbacks and disabled ingress/log/trace collection checks passed. The candidate-only hostname association used explicit no-override flags after a conflict-free changeset. Ordinary TLS certificate validation succeeded. This trusted-code transport substitution did not establish a platform-wide egress sandbox or production log retention behavior.

## Failed observation and measured limits

The first CLI preflight rejected a Windows-backslash manifest path before network access. A new input changed separators only and preserved the resolved path/package identity.

The actual hosted receipt then recorded `incomplete / GUEST_DISPATCH_INCOMPLETE`, **zero driver application attempts and zero completions**. Its observer completed two database metadata GETs and one inventory SELECT, reporting 85 app rows read and zero rows written, before the complete table-name comparison failed.

Read-only diagnosis found the reserved `_cf_KV` table in both databases. The old observer excluded `sqlite_%` and `_cf_METADATA` only, so it saw 23 app tables instead of 22 and would see two fixture tables instead of one. Cloudflare independently documents `_cf_KV` as reserved and unqueryable in its [D1 import/export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/). Its contents were never queried. The failed run was preserved and was not reset/retried as a passing run.

CPU, peak memory and workload-attributed D1 cost remain unmeasured. Schema discovery established microsecond CPU quantiles and V8 isolate-byte memory quantiles; those are not per-request observations or peak allocation. Final adaptive analytics estimated 71 app Worker requests with success status and zero subrequests while the fixture dataset was empty. Those platform requests are unattributed to the driver's zero-request workload and provide no homogeneous workload-capacity conclusion. D1 date totals include setup/observation and can lag; no net billing value is inferred.

## Cleanup and next packet

The candidate association was removed first. Its delete response was incompatible with the initial JSON-only response parser; the operator reconciled exact ID/hostname absence through a read-only list rather than repeating DELETE. Only the run's two exact Workers and two exact D1 UUIDs were then deleted after ownership/version/binding checks. Both restricted synthetic secret files were removed. Independent readback confirmed resource/association absence, public DNS `ENOTFOUND` and production health HTTP 200. Production's version and database binding were unchanged.

The run made no production deployment, public guest activation, maintenance/logging/billing change or real-provider operation. Private receipts, synthetic transport files' deletion records and ownership IDs remain in ignored operator artifacts; they are not published artifacts or permission for another run.

The compatibility follow-up explicitly excludes only `_cf_KV`, `_cf_METADATA` and the literal SQLite-owned `sqlite_` prefix, accepts native manifest-path separators, and records new observer/transport input hashes. Unknown tables still fail before dispatch. A fresh packet must keep separate application/build/package and driver/proof identities and retain this failed receipt and cleanup history. See the [test-package runbook](guest-hosted-test-package.md) and [finite guest finish plan](../superpowers/plans/2026-11-12-guest-release-finish.md).
