# Hosted guest retention, November 15, 2026

The existing cleanup helper passed a bounded deletion and preservation check on
disposable Cloudflare D1 with synthetic fixtures and seven real migrations. The
run used clean source `6e97005a50b635a819b3a214c5c788a6c934bdee`, which adds the
probe-only reserved-table inventory correction. All 22 application-table
snapshots matched expected contents after each invocation. See the
[native probe](guest-retention-validation.md).

The passing run used only D1 management and query calls for the disposable test.

## Deletion and preservation

| Invocation | Rate events | Runs | OAuth requests | Bridge requests |
| --- | ---: | ---: | ---: | ---: |
| Dry run (unchanged snapshots) | 100 | 1 | 1 | 1 |
| First apply | 100 | 1 | 1 | 1 |
| Second apply | 100 | 0 | 0 | 0 |
| Third apply | 6 | 0 | 0 | 0 |
| Final idempotent apply | 0 | 0 | 0 | 0 |

The batch limit is 100 per cleanup table. The first apply removed an expired
idle-owner run, an expired OAuth request and an expired consumed matching-owner
bridge request. Deleting the run cascaded to one step. Independent queries
confirmed all 205 expired anonymous rate events and the one eligible expired
account rate event were gone. Five recent rate events remained. Other preserved
fixtures included controls, settings, users, operation locks, running and
uncertain owners, and unconsumed, mismatched and legacy bridge requests.

## D1 API observations

| Stage | API calls | SQL statements | Rows read | Rows written |
| --- | ---: | ---: | ---: | ---: |
| Preflight, creation and identity check | 3 | 0 | 0 | 0 |
| Migration setup | 45 | 45 | 448 | 107 |
| Fixture seeding | 238 | 238 | 6 | 1,120 |
| Observation and snapshots | 140 | 140 | 1,329 | 0 |
| Dry run | 4 | 4 | 235 | 0 |
| First apply | 4 | 4 | 652 | 104 |
| Two catch-up applies | 8 | 8 | 698 | 106 |
| Final idempotence check | 4 | 4 | 34 | 0 |
| Database deletion and absence check | 2 | 0 | 0 | 0 |
| **Total** | **448** | **443** | **3,402** | **1,437** |

The three applies executed 12 SQL statements and reported 1,350 rows read
and 210 rows written, including the cascade. The counters cover this fixture.
Production billing, separate index-write attribution and Worker CPU remain
unmeasured by this run.

## Attempt history

| Attempt | Date (UTC) | D1 API calls | Result |
| --- | --- | ---: | --- |
| First | November 14 | 290 | An inventory observation returned HTTP 400 with D1 code 7500 before dry run. The failed SQL template was unavailable. A separate regression reproduced the probe's omission of the reserved `_cf_KV` exclusion. |
| Second | November 15 | 174 | A local journal failure interrupted seeding before snapshots or apply. The original filesystem error code was unavailable. The executor reported cleanup unconfirmed, and the independent lookup confirmed deletion. |
| Third | November 15 | 448 | Passed after adding bounded local journal retries and avoiding reads of the live journal. The run needed zero journal retries. |

Each test database deletion returned HTTP 200, followed by an independent
lookup returning HTTP 404 with D1 code 7404. All three were confirmed absent.
The passing receipt is retained privately with SHA-256
`4bca2a3e3af207ea9026c283dfcdd4b5f39002f2edb6b51f56dc14e0044560a5`.

## Production gate

The November 14 read-only GitHub check found three skipped production cleanup jobs
and received HTTP 404 when checking the maintenance enable variable. Production
apply, recurring operation, sustainable capacity and outage recovery remain
unverified. Establish those bounds before publishing a retention promise.
The isolated SQL checks leave physical storage and recovery-history erasure
unverified. Live-provider acceptance and final deployment and activation approval
remain open. See the [acceptance ledger](guest-acceptance.md).
