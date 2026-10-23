# Hosted Ed persistence batching

The operator approved the next planned step: batch Ed's sequential assignment and status writes, verify data/ownership behavior and measure the candidate in isolation. This work is separate from the unmerged calendar-input candidate. Production deployment is outside this step.

The existing hosted Ed path uses 230 database binding calls for 42 assignments in the real SQLite fixture. It reads/upserts assignment metadata per item, hydrates the complete Ed list, then reads and upserts every status separately.

## Approach

Reuse the existing Gradescope persistence primitives. For each ordered chunk of at most 100 normalized assignments, issue one atomic D1 batch containing count-new, metadata upsert and external-ID status completion. Join statuses to the newly upserted assignments in SQL rather than reading the complete assignment list. Validate each metadata/status JSON string against a 1,000,000-byte UTF-8 bound for every chunk before the first assignment-data batch. Generated IDs and ownership metadata retain headroom below D1's per-value limit.

Keep the public provider service, admission/rate policy, encrypted credentials, course fetching, source result timestamps and legacy path unchanged. The existing prepared statements retain the exact user/source/nonce/control-version fences. Successful completion is recorded only after all applicable batches and result validations succeed. Atomicity is per chunk; earlier complete chunks may remain after a later persistence failure.

Alternatives are retaining the per-item writes, which preserves the observed latency cost, or introducing a background/continuation protocol, which adds lifecycle state before using an existing bounded batch pattern. The batch pattern is the scoped next candidate and makes no Free-capacity guarantee.

## Compatibility requirements

- Preserve raw input ordering and duplicate external IDs: last metadata wins; the first status at the shared checked-at timestamp wins.
- Keep refreshing metadata even when an equal/newer saved status prevents status replacement.
- Successful empty courses still advance freshness; all failed courses retain prior successful freshness and data.
- Failed-course rows, other users and other sources are unchanged.
- Reject failed/malformed result counts and oversized strings without reporting false completion.
- A pause or owner change fences later chunks; no old nonce may write through the new batch path.
- Do not change fetching concurrency, timeout, client recovery state or public result shape in this step.

## Verification

Tests first establish old-code call-count failures while preserving existing behavior. Real SQLite integration cases cover inserts/repeats, 101/201-row chunking, duplicates, status staleness, partial/empty/all-fail results, atomic rollback, UTF-8 bounds, malformed results and control/owner changes. Full tests, lint, types and Workers compilation are required; known compatibility-tooling limits must be recorded.

An isolated native/hosted comparison will bundle baseline and candidate service sources independently with the same actual Auth.js/session, user scope, keyring and public provider service. It uses synthetic encrypted credentials, D1 data and a strictly read-only service-bound fixture, never a real Ed request. Record exact runtime UUIDs/work counts, CPU/wall results, sampling limits and marked-resource cleanup. It measures the authenticated service pipeline, not the full deployed HTTP router. Production data, routing, logging, keys and billing remain unchanged by the experiment.
