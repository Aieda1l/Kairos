# Stored-log privacy assessment — October 21, 2026 UTC

Status: **ASSESSMENT COMPLETE — this persistence configuration is unsuitable for production; keep persistence disabled.** This assesses the logging boundary of source `5547ff13a8eb43b7ab749b4dbec8e04e2c7dbff2`. It is not a repository-wide security audit or public-beta readiness decision.

## Scope and production baseline

M7 acceptance row 13 requires assessment of platform metadata and framework/vendor database-error logging in addition to application redaction. At 17:53 UTC, the effective production script settings report no enabled observability configuration, `logpush: false` and no tail consumers. Repository configuration explicitly disables persistence, invocation logs and traces. The isolated probe does not change those production settings, bindings or user data.

The CLI can inspect Worker configuration and deploy disposable probes, but a narrowly filtered telemetry-query preflight returns HTTP 403 / API code 10000. The query targets a unique nonexistent synthetic Worker, uses a one-minute window, limit one and `dry: true`; no production logs were requested. Cloudflare's [telemetry-query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/) documents `Workers Observability Write` permission. The operator chose dashboard inspection instead of providing another credential.

## Verified application and local runtime behavior

`tests/unit/operational-events.test.ts` and `tests/integration/operational-privacy.test.ts` pass all **36 tests**. The event emitter builds a new allowlisted object; unknown input fields do not reach its JSON sink. Auth diagnostics reduce errors to fixed application codes.

A native local workerd probe bundles the actual operation context, event emitter and auth diagnostics from this release. It uses a fresh empty synthetic D1 database and four paths:

| Probe | Local status | Verified result |
| --- | --- | --- |
| Successful operation with extra synthetic private fields | 200 | One `HEALTH_OK` event; injected private fields excluded |
| Caught invalid D1 query routed through auth diagnostics | 200 | One `AUTH_FAILED` event; SQL/table canary excluded |
| Uncaught synthetic exception | 500 | Development error response includes exception canary |
| Uncaught invalid D1 query | 500 | Development error response includes SQL/table canary |

The two application events contain none of the injected sentinels. Local development error responses demonstrate a separate framework boundary; they do **not** establish a production response leak or what Cloudflare persists.

## Isolated live canary

Worker **`kairos-privacy-canary-4f536844`** uses the same 7,531-byte application probe bundle (SHA-256 `c0159f8c9ede72a18e0113986392d38c374d28a01e12b650d3a7ca6c2b2fbeb9`) and its own fresh synthetic D1 database. It contains no production bindings, real credentials, user records or coursework. A random ephemeral secret gates every request. Only this Worker enables persisted logs at full sampling; invocation logs and traces are disabled, query-string redaction is enabled, and Logpush is off.

Initial immediate readiness requests received HTML 404 while ingress propagated. After a bounded propagation wait, readiness returned 200. The four live probes ran at **18:07:10 UTC**, returning 200, 200, 500 and 500 as expected. Neither live error response contained the exception or SQL sentinel. The public Workers.dev endpoint and preview ingress were disabled immediately afterward. Following dashboard inspection, the temporary Worker and its exact synthetic database were deleted at **18:10:27 UTC**; API reads independently returned 404 for both. Production logging settings were rechecked unchanged. No production mutation or paid-plan change occurred.

The operator inspected **stored records**, including expanded metadata, in the October 21, 18:07–18:08 UTC window restricted to this canary. The requested sentinels were:

- Application codes `HEALTH_OK` and `AUTH_FAILED`.
- Uncaught exception `KAIROS_CANARY_UNCAUGHT_EXCEPTION` and SQL/table `KAIROS_CANARY_PRIVATE_TABLE`.
- Request path/query/header values `KAIROS_CANARY_PATH`, `KAIROS_CANARY_QUERY`, `KAIROS_CANARY_COOKIE`, `KAIROS_CANARY_AUTHORIZATION` and `KAIROS_CANARY_HEADER` anywhere in stored metadata.
- Injected application fields `KAIROS_CANARY_EMAIL`, `KAIROS_CANARY_TOKEN` and `KAIROS_CANARY_COURSEWORK` in application messages.

The operator supplied three expanded records. The following conclusions are limited to those records; no API log inspection is claimed, and raw record identifiers are omitted here.

| Stored record | Observed result |
| --- | --- |
| Caught D1 failure | Application message contains `AUTH_FAILED`, fixed context/schema fields and generated correlation ID; no raw SQL/table or injected private fields in that message |
| Uncaught synthetic exception | Raw exception text appears in message/error fields and stack metadata |
| Uncaught D1 failure | Raw `D1_ERROR` text includes `KAIROS_CANARY_PRIVATE_TABLE` in message/error fields, with a vendor stack |
| All three records | Platform trigger and request metadata retain the synthetic path `KAIROS_CANARY_PATH`, despite invocation logs being disabled |

The three supplied request URLs omit the synthetic query string and expose no cookie/authorization/header values. This is limited evidence for query redaction in those records, not a guarantee for every log type. The `HEALTH_OK` record was not supplied, so its stored representation is not independently established. These gaps do not change the decision: raw exception/database text and path metadata already disqualify this persistence configuration. This is a synthetic canary finding, not evidence that production private data was logged.

## Decision and next action

Keep production persistence disabled. Application allowlisting alone does not sanitize Cloudflare-added request metadata or uncaught framework/vendor exceptions. This completes the planned stored-log assessment with the plan's allowed keep-disabled outcome; it does **not** approve enabling Workers Logs. A future proposal must demonstrate filtering at the persistence boundary and rerun stored-record canaries before any production logging change. Health and deployment checks remain the available operational signals while persistence is off.

Cloudflare documents [Workers Logs and invocation logging](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) and [stored-log queries](https://developers.cloudflare.com/workers/observability/query-builder/). As checked October 21, [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) includes 200,000 log events per day and three-day retention on Free. This small isolated test does not require Workers Paid. Retention is not immediate deletion of previously stored synthetic records.

Ignored evidence: `artifacts/log-privacy/preflight.json`, `local-assessment.json`, `privacy-tests.log`, `canary-manifest.json`, `live-assessment.json`, `operator-assessment.json`, `cleanup.json` and the private resource receipt `live-state.json`. No raw stored logs or real private values are committed.
