# Milestone 7 acceptance

Status: in progress. This checklist consumes the approved public-beta specification's 23 conditions. A source test, an operator report and a check on the exact deployed release are different evidence. Milestone 6 acceptance does not establish that the changed Milestone 7 runtime passes.

Current October 15 outcome: the explicitly approved M7 release is deployed on all seven migrations, and compatible code rollback/forward restoration passed its schema/configuration/health checks. Real acceptance exposed both-provider verification failure and widget overlap. A focused repair has native/browser regression evidence; publication and real sign-in confirmation remain open. The new GitHub health check receives 403; notification delivery is not yet confirmed. See the [current rollout record](closeout-milestone-7.md#approved-rollout-and-authentication-repair-october-15). Earlier pre-release state below is historical, not the current production baseline.

The starting source was `0cccc21`; the resumed executable-source checkpoint is `9401d79`. Fresh isolated Linux verification passes 1,433 tests in 148 files, 54 Chromium/Firefox cases, 18 offline deployment simulations and the relevant lint/types/migration/safety/native/extension/Next/Workers/dynamic checks. Independent current-source reviews and validated reports are complete; three external D1 coverage blocks and the hosted/operational/provider gates keep the decision INCOMPLETE. See [readiness](readiness-milestone-7.md) and [source review](security-review-milestone-7.md).

The later [operational preflight](preflight-milestone-7.md) confirms production remains on migrations `0001`-`0003`, establishes GitHub main/environment protections, and records a retrievable recovery bookmark plus operator-held key/sole export/restore authorization. Release follow-up `0fa7090` passes 1,472 tests in 149 files, 54 browser cases and 30 release simulations; it adds preview isolation and live cutover checks. The operator confirms Workers Free and Pseudo IPv4 Off. Exact-main CI, production credentials, effective backup/IAM/privacy/remaining ingress facts, observed CPU pressure, compatible recovery and hosted acceptance remain open.

## Required evidence

| # | Condition | Evidence available | Remaining closure |
| --- | --- | --- | --- |
| 1 | Open Google/Microsoft signup | No invite/domain restriction in source; controlled identity-entry coverage | Independent production accounts outside test-user lists complete actual signup |
| 2 | No UW email eligibility requirement | Reviewed identity configuration and tenant scope accept ordinary provider identities | Non-UW hosted identity evidence on M7 |
| 3 | Public UW-first, unofficial purpose | Public-page source and prior deployed anonymous/Search Console checks | Confirm public pages on the final deployed revision |
| 4 | One-source setup with optional skips | Onboarding component/API/browser coverage | Repeat first-run one-source flow on the deployed M7 revision |
| 5 | Returning users bypass unnecessary setup | Established empty-user migration, route and browser coverage | Repeat returning-account routing and logout after release |
| 6 | Google production verification | Published OAuth; domain verified; public URLs accessible; operator now reports branding fully approved after review | Branding review wait closed by operator evidence; confirm applicable calendar/data-access state and exact-release public sign-in |
| 7 | Microsoft production identity/calendar | M6 operator-confirmed personal account identity/calendar success; corrected confidential Web/common configuration | Current M7 multi-account production identity/calendar acceptance |
| 8 | Mozilla-signed production distribution | Public 0.4.0 listing and signed artifact verified; normal store installation/native consent/Canvas and Gradescope reads operator-confirmed | Passed: approved criterion 8 requires signed installability; a real upgrade exercise belongs to the next legitimate release |
| 9 | Extension disclosures match behavior | Signed payload/manifest, MIT/notices and newly public data disclosure/privacy link agree; homepage/support link verified; dedicated policy field null | AMO disclosure task passed; deploy corrected website policy and confirm final alignment under row 16 |
| 10 | Server challenge blocks invalid starts; reads unaffected | Both-provider invalid/missing/hostname/action/direct-route tests; lazy reads/logout tests | Hosted real Turnstile valid/rejected smoke on the release |
| 11 | Allowed/rejected/reset/isolated budgets | Fresh D1/API/service and independent native workerd verification | Hosted bounded rate smoke on the release |
| 12 | Duplicate sync work remains bounded | Durable owner/nonces, SQL fences, retained uncertainty and independent workerd probes | Hosted duplicate-start and pause/reopen smoke without duplicate remote writes |
| 13 | Structured log privacy | Allowlist/redaction tests; persistent logs/invocation metadata/traces disabled | Complete platform/framework stored-log assessment; keep persistence off until reviewed |
| 14 | Operational health/deployment visibility | Health endpoint/check/workflows implemented; existing failure-email delivery operator-confirmed | Deploy/activate new checks, verify actual success/failure delivery and environment protections |
| 15 | Monitored support/security contacts | Operator confirmed two separate messages arrived at the selected monitored inbox | Passed by operator evidence; preserve routing/contact behavior |
| 16 | Accurate privacy/terms | Detailed public policies, separate identity/calendar consent and revocation/deletion guidance | Final source/deployed/listing consistency review; Google policy acceptance remains external |
| 17 | Real hosted deletion/revocation instructions | M6 deletion operator-confirmed; current deletion/draft isolation tests | Verify provider revocation, local disconnect and account deletion on the M7 release with one account while preserving the other |
| 18 | Successful live rollback | Source/runbooks preserve additive schema, keys and unresolved owner state | Verify actual compatible target, perform controlled rollback and forward restore with authenticated/provider checks |
| 19 | Two independent real accounts | M6 user-confirmed isolation; synthetic M7 isolation/browser coverage; latest operator report says two Kairos accounts tested and apparently working | Record exact tested revision/flows and complete remaining M7 onboarding/source/calendar/settings/mutation isolation; general smoke success does not establish every assertion |
| 20 | Real Google/Microsoft/iCloud calendars | M6 real-account acceptance and current fixture/reconciliation tests | Production connect/repeat/update/recreate/disconnect/reconnect smoke for all three |
| 21 | UW Canvas/Gradescope/Ed remain functional | M6 operator-confirmed flows; current service/bridge/source coverage | Fresh hosted imports/status/courses/errors and source isolation on the release |
| 22 | Final repository-wide security review | Frozen-base audit complete: 151 terminal units/17 fixed-or-refuted records; former D1 policy blocks closed by attributed facts/policy and distinct critics; later deltas separately reviewed | No unresolved Critical/Important source finding; actual runtime/privacy/operational facts still feed final readiness under row 23 |
| 23 | Final readiness go | Fresh local gates pass; validated INCOMPLETE readiness decision | Establish required external facts and obtain the final go decision; no production approval inferred |

## Release record

Before any remote change record the reviewed Git revision, clean/dirty state, build/config identity, current active Worker version/deployment, compatible fallback, additive migration level, configured secret **names**, and extension checksums. Recheck actual remote state; the prior checkpoint's identifiers are historical evidence. Never record secret values, private provider data or authorization URLs with query material.

This continuation does not authorize production uploads, remote migrations, traffic promotion or workflow activation. Obtain explicit operator approval of the concrete reviewed release before those actions.

The immutable submitted extension artifacts are version 0.4.0:

- Runtime ZIP SHA-256: `d8236a7ce8047f8a4df25fcb641a2d7aad0702ab6731c8868b6534df947477a7`.
- Reviewer source ZIP SHA-256: `f9661c4197e3b4911021d235bff0809f79c86a35068aa8c504ef048c30ee738b`.

Do not regenerate or overwrite these submitted packets during web verification. Record the actual Mozilla-signed artifact's hash separately; an unsigned packet hash does not prove store signing. A bridge PONG version field of `not-shared` is not an installed-version measurement; inspect the installed popup/Developer Hub artifact.

## Controlled hosted sequence

1. Finish local source/security/release checks and reconcile source control through reviewed changes. Preserve the original checkout and Milestone 6 history.
2. Verify exact production bindings/provider redirects, edge ingress assumptions, log-persistence settings and a compatible fallback. Restrict privileged workflow secrets to reviewed protected `main`; source conditions do not prove GitHub environment policy. Do not activate maintenance until its dry run, bounded-backlog metrics and actual branch protection/unauthorized-ref rejection are established.
3. Deploy a clean reviewed release with forward-only migrations and remote variables preserved. Check public storage health, public policy/purpose pages and signed-out protection. These are preflight checks, not complete acceptance.
4. Use two separately authorized real accounts, called Alice and Bob in evidence. Record outcomes only. Exercise new/returning onboarding, skips/resume, sign-in/logout, source/calendar operations and forbidden cross-account reads/mutations. Keep real credentials and private data out of browser traces and logs.
5. Verify challenge/rate/duplicate-work and pause/reopen behavior with a small bounded number of authorized operations. Preserve uncertainty and cooldown; do not release a lock based only on elapsed time or restart. Rejection must preserve working connections/candidates and must not prompt unnecessary OAuth reconnect.
6. Confirm signed extension installation and compare the approved listing/privacy declarations. Criterion 8 is satisfied by the initial signed installable release; exercise a version-to-version upgrade with the next legitimate extension release. Run provider revocation/local deletion checks without affecting the second account.
7. Exercise compatible code rollback and forward restore, retaining schema, required keys and unsettled ownership. Verify authenticated/provider behavior and duplicate prevention before reopening.
8. Confirm new health/maintenance failure notifications, actual Free-plan headroom and cleanup costs. Obtain the final security/readiness decision; enable broad beta promotion only after all 23 rows close.

The user reports Google branding fully approved. Mozilla signing/publication, normal Firefox installation/native consent/Canvas/Gradescope reads and the description/privacy-link/homepage update have [recorded evidence](firefox-0.4.0-publication.md). No particular Developer Hub editor layout is required. A real version upgrade remains an extension follow-up and is not an extra criterion-8 launch requirement. Exact-source 72a5b2a CI passes 1,475 tests in 149 files, including 30 offline release simulations, plus all 54 browser cases. The [engineering closeout](closeout-milestone-7.md) adds a verified local recovery candidate, maintenance measurements and refreshed production/access facts. The reported two-account smoke lacks a revision/per-flow record. Guest mode stays after M7; release acceptance remains incomplete.
