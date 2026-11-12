# Guest release finish plan

> **For agentic workers:** Use subagent-driven development for scoped work and independent ECC review before merge. Root owns operator actions and integration.

**Goal:** Finish the agreed guest v1 release without adding page-independent background completion to its launch scope.

**User direction:** On November 12 the user chose “Finish guest release first (Recommended).” Background completion after closing Kairos is a separate follow-up. Existing timeout/ownership protection remains intact.

**Architecture:** Preserve the merged hybrid implementation and default-off production flag. Repair the observer's actual remote D1 compatibility, then obtain finite capacity/retention and real-provider evidence before the concrete release decision. Unsupported metrics stay explicitly unmeasured; existing completed checks retain their original provenance.

## Package 1 — Diagnostic compatibility (immediate code change)

Files: scripts/lib/guest-hosted-observations.mjs and .d.mts; scripts/run-guest-hosted-diagnostic.mjs; scripts/verify-workerd-guest-hosted-package.mjs; tests/integration/guest-hosted-operator.test.ts; related deployment/acceptance/roadmap docs.

- [x] Add failing tests executing the observer's actual SELECTs against two in-memory SQLite databases with all expected tables and the reserved `_cf_KV` table. Both before/after snapshots succeed without querying its contents; metadata identity and the 50 SELECT / 52 API-call envelope remain.
- [x] Keep unknown app/fixture tables rejected, including `_cf_unrecognized` and `sqliteXunrecognized`, before application dispatch. Use the literal SQLite prefix via `NOT GLOB 'sqlite_*'` in hosted/native observation. Do not ignore a `_cf_%` wildcard or change expected protected tables.
- [x] Accept manifest.json paths using either slash convention while preserving native path resolution, package verification, exact final filename, bad-input refusal and zero network before preflight.
- [x] Record observer/transport input hashes in new hosted evidence. H1 package identity remains distinct from H2 driver identity; do not relabel old receipts as proof of this change.
- [x] Preserve schema SQL and constraints. Document removing only known SQL comment-only lines for REST submission, retaining original/submitted hashes; no DDL change is needed.
- [ ] Run focused RED/GREEN, appropriate full checks and independent ECC review; publish and merge only after required CI passes.

The prior cloud run stopped with zero driver requests because of the inventory mismatch. It is not evidence of a guest capacity failure. Its exact Workers/D1/domain were deleted; their UUIDs and consumed receipts cannot be reused.

## Package 2 — Hosted capacity and operating decision

Prepare a fresh immutable package/inventory/run plan with unused named disposable resources, finite traffic/observation/analytics limits and owned cleanup. Review it before new provisioning/upload/dispatch. Measure the admitted baseline and then the already agreed bounded failure/denial/concurrency cases, keeping setup, fixture, observer and workload costs distinct. Resolve sampled CPU/isolate-memory versus unsupported per-request/peak quantities explicitly in the release decision; preserve null/reasons rather than invent measurements or silently require Paid. If needed, measure a scoped parser/workload/budget optimization while retaining all three sources. No automatic billing upgrade.

## Package 3 — Hosted retention and operations

Reuse the completed local retention proof. Verify disposable hosted deletion/preservation, billed deletion/index cost, backlog/catch-up and sustainable cadence. Review protected maintenance configuration/notification and truthful physical retention before activation. Do not enable production maintenance or erase uncertain work merely to satisfy a count.

## Package 4 — Real guest-provider acceptance

Use controlled accounts/browser/extension and separately authorized real-provider checks. Cover Canvas feed/status and honest partial results, Firefox Gradescope discovery/read and Ed selection/progress, plus reload/re-entry, remembering/forgetting, replacement/reset/import/disconnect, capability expiry, same-browser account separation and changing-report interaction. Keep credentials in the product and retain count-only outcomes. Existing signed distribution and account-mode evidence are not repeated without a relevant change.

## Package 5 — Frozen release and activation

Reconcile the actual evidence and any accepted measurement limitations with exact source/CI/build/config/schema, health/isolation, rollback compatibility and disclosures. A reviewed guest-off deployment can deliver the merged UI/source fixes separately. Guest activation and final public-beta readiness remain explicit decisions after applicable gates; this plan grants no cloud writes, deployment, new secrets, maintenance, logging, billing changes or public activation by itself.

## Definition of done and scope boundary

Guest v1 is done when its agreed source/local-data flows pass, measured operating/retention limits are accepted, required CI/reviews and live acceptance are recorded, and the reviewed production candidate is deployed/activated and verified. The implementation is largely complete today; the remaining five packages are compatibility/measurement/acceptance/release work. No reliable percentage or completion date follows before the capacity decision. Background completion, PWA/cold-start offline, calendars written from guest mode, cross-device sync, transfer and Chromium extension support remain follow-ups.

Broader M7 account/calendar/rollback assertions retain their existing dispositions. Do not reopen closed signed-extension, support-delivery, log-assessment, local/native proof or attributed CI evidence, and do not silently waive shared release safety gates.
