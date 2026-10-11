# Milestone 7 Public Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the linked plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prepare the working hosted Kairos release for a controlled public beta, then pass the external launch gates before advertising it broadly.

**Architecture:** Extend the existing vinext/Workers/D1 tenant boundary rather than introduce another backend. Implement three reviewed slices: resumable setup and recovery; server-enforced admission and bounded work; signed extension distribution and privacy-preserving operations. Each slice retains Milestone 6 behavior and receives an independent review before release integration.

**Tech Stack:** TypeScript, React, vinext/Next.js, Auth.js, Cloudflare Workers/D1/Turnstile, Firefox MV3, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-public-beta-readiness-design.md` (approved).

## Global Constraints

- Open Google/Microsoft signup; no invite code and no `@uw.edu` eligibility check.
- UW-first; Canvas browser access remains `https://canvas.uw.edu/*`, Gradescope remains `https://www.gradescope.com/*`.
- Authentication is the only mandatory setup step. Every integration step is skippable.
- Do not automatically link identity accounts across providers by email.
- Keep application-level AES-GCM credential encryption, minimized identity-token storage, and the public session allowlist from Milestone 6.
- Additive/forward-only production migrations; preserve production D1 data and decryptability of existing versioned envelopes.
- No secret, private feed URL, OAuth code/state/verifier, session cookie, raw provider response, assignment content, or email in diagnostics or acceptance evidence.
- No broad promotion before all 23 release acceptance conditions in the spec pass.
- Preserve the original checkout, including unrelated untracked `.agents/` and `.codex/` directories.

## Review Focus

1. Direct Auth.js routes or server actions bypass the challenge: 7B auth-route and action integration tests must prove zero OAuth work without admission.
2. Existing users or optional-step skips are trapped in setup: 7A route/E2E tests must cover grandfathered empty accounts, all skips, resume, and completion.
3. Separate Worker isolates multiply sync work: 7B D1 contention and expiry tests must prove single ownership and stale-owner write rejection.
4. Packaging or diagnostic tooling includes private material: 7C archive allowlists and adversarial log/health tests must prove exclusion.
5. Code/key rollback strands existing credentials: 7C dual-key and rotation tests plus a live rollback drill must prove the supported rollback range.

## Starting evidence and decisions

- Working Milestone 6 tag: `milestone-6`, commit `6a4f9089319a01818853183298ee6f16827c22ab`.
- Production runtime commit: `f068e24bd45b46dee4c5a5a8d219115efaf769ef`; Worker version `f54b4c5d-d0b8-462f-80e7-ae68cca52df5`.
- Isolated branch: `feat/milestone-7-public-beta-readiness`, based on that tag. The task's original checkout remains on the Milestone 6 branch.
- Fresh lockfile install and baseline: **509 tests in 102 files passed** on 2026-10-10. npm 12 blocked dependency install scripts; bundled platform binaries were sufficient for this test run. Do not change global npm policy.
- User selected **AMO listing**. Mozilla developer account readiness and support/security delivery remain pending. A managed Turnstile widget has now been provisioned for `mykairos.me`, with credentials stored directly in Worker secrets.
- User reports Google OAuth is **published**. This is not evidence that scope/brand verification or public-account acceptance is complete.
- Milestone 6 changes are local and not yet merged to `main`. Reconcile its release commits through normal reviewed source control before integrating Milestone 7 into `main`; do not base implementation on the older `main` or rewrite the release tag.
- The finalized Milestone 6 branch/tag are now pushed and [draft PR #14](https://github.com/Aieda1l/Kairos/pull/14) is open. Local M7 implementation proceeds from the verified tag under the user's approved plan; reconcile onto the reviewed merge base before release integration. If the release is squash-merged, transfer only M7 commits after the tag; do not duplicate the Milestone 6 diff or rewrite its acceptance history.

## Ordered task list

| Slice | Deliverable | Execution dependency |
| --- | --- | --- |
| [7A: onboarding and recovery](2026-10-10-milestone-7a-onboarding-recovery.md) | Resumable, skippable setup; returning-user routing; targeted recovery and account settings | Milestone 6 tag; 7C extension install descriptor for the final public path |
| [7B: admission and bounded work](2026-10-10-milestone-7b-admission-bounded-work.md) | Turnstile, exact durable rate budgets, duplicate sync controls, emergency switches | Milestone 6 tag; coordinate schema ownership with 7A |
| [7C: distribution and operations](2026-10-10-milestone-7c-distribution-operations.md) | AMO package, truthful policies/contact, structured logs/health, monitoring/runbooks, release gate | Build/package work independent; admission interfaces consumed from 7B; final integration consumes 7A/7B |

Execute independent tasks in disjoint write scopes. Reserve shared edits to `src/proxy.ts`, production config, runtime bindings, migration/test harness lists, workflows, and final acceptance documents for one integrator. Stage only reviewed logical chunks; do not use `git add .`.

## External work and release evidence

| Item | Current evidence | Required result |
| --- | --- | --- |
| Google OAuth | User reports published | Confirm actual requested identity/calendar scopes, branding/domain ownership, required verification, and non-test-user hosted consent |
| Microsoft | Milestone 6 personal account works with `common` | Production Web callbacks/audience, consent/rotation record, independent accounts and calendar smoke |
| Mozilla | AMO chosen; no developer account | Account created, submitted reviewer source/package, approved signed listing, install/update smoke |
| Turnstile | Managed widget scoped to exact production hostname; keys in Worker secret store | Integrated valid/invalid hosted initiation tests |
| Support/security | User selected Cloudflare account inbox; destination verified; domain currently has Namecheap MX/SPF | Preserve or explicitly migrate current mail service; both aliases delivered successfully |
| Monitoring | Existing platform dashboards/deploy workflow | Scheduled health check runs; failed-check/deploy notification recipient verified; capacity dashboard/threshold procedure exercised |
| Rollback | Milestone 6 readiness reviewed | Milestone 7 live rollback and forward restore on compatible schema/keyring, followed by authenticated smoke |

Do not request secrets in chat. Provision through provider interfaces/secret stores. Record only test labels, stable outcomes, artifact checksums, revisions, deployment IDs, dates, and reviewer decisions.

## Spec coverage and final verification

| Spec acceptance | Owning slice/evidence |
| --- | --- |
| 1-3: open identity/UW-first | 7A homepage and auth copy; 7B admission; 7C real public-account evidence |
| 4-5: setup and returning users | 7A route/component/browser tests |
| 6-7: Google/Microsoft production | 7C provider runbook and hosted acceptance |
| 8-9: signed extension and truthful declaration | 7C package/reviewer artifacts and normal Firefox install/update |
| 10-12: challenge, rate limits, duplicate work | 7B unit/D1/API/browser/workerd tests |
| 13-14: logs, health, operational visibility | 7C redaction/health tests and operational checks |
| 15-17: monitored contact, truthful policy, deletion/revocation | 7C contact/legal and hosted verification; existing M6 deletion retained |
| 18-21: live rollback, two users, calendars and sources | 7C release checklist, controlled hosted acceptance |
| 22-23: security/readiness go | Fresh independent ECC security/code review and repository security/production-readiness review |

- [x] Review the three plans and resolve interface/schema inconsistencies before code changes; user approved subagent-driven execution.
- [ ] Implement each task red -> green; run its targeted tests before integrating the next dependency.
- [ ] Run the integrated gates once: Vitest, lint, typecheck, D1 migration verifier, extension validation/package, Chromium/Firefox E2E, Next compatibility build, Workers build, dynamic dashboard verifier, hosted safety verifier, workerd probes, vinext compatibility check.
- [ ] Run typecheck/Next builds separately from the E2E dev server to avoid `.next/types` races.
- [ ] Run fresh code/security reviewers; resolve Critical/Important launch findings before scoped commits.
- [ ] Complete controlled hosted acceptance against the exact deployed revision and artifact. External approvals remain pending until evidence exists.
- [ ] Final production-readiness go; update roadmap and release evidence accurately; enable broad beta wording only after the gate passes.

## Workflow checkpoint

The user approved the combined plan and selected **subagent-driven execution**. Use a fresh implementer and task-scoped spec/quality reviewer for each meaningful task, then a broad code/security review at integration. Keep a durable progress ledger with task evidence and decisions. Existing deployment and Milestone 6 authorization is preserved; external public-beta gates remain pending until verified.
