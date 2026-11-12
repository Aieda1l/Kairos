# Guest response validation optimization plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and independent ECC review before merge.

**Goal:** Remove one demonstrated duplicate output serialization from each guest Canvas/Ed source read without changing accepted data, byte limits, errors or request protections.

**Architecture:** Keep each response's strict shape private in the portable contracts module. The existing public response schema retains that shape and its byte refinement for browser/untrusted-response callers. A typed server validation helper validates the same private shape and measures its stable returned clone once. If shape validation fails, it measures the original input once to preserve the existing oversize-error precedence for reader-owned JSON data. Readers map oversize and invalid-shape results to their existing codes and keep deadline/provider checks in their existing order. This ordering also prevents custom serialization/accessors from hiding an oversized accepted clone.

**Tech stack:** TypeScript, Zod, Vitest, existing local parser measurement and workerd checks; no new dependencies.

**Spec and authorization:** Package 2 of [the guest release finish plan](2026-11-12-guest-release-finish.md), the preserved [hosted baseline](../../deployment/guest-hosted-run-2026-11-12-v2.md), and the user's instruction to proceed. This is a behavior-preserving performance increment, not a new guest feature or a decision to change limits/plan tier.

## Global constraints

- Preserve the exact response DTOs, public schemas/types and strict field, URL, identity, duplicate, course/report and array/byte limits.
- Preserve oversize error precedence for reader-owned JSON data: `SOURCE_RESULT_TOO_LARGE`; other invalid output remains `INVALID_ICAL` or `ED_PARSE_ERROR`. Size the actual accepted clone; an original object's custom serializer must not hide excess bytes.
- Preserve upstream reads, request budgets, admission SQL, Host/Origin/capability validation, timeout/cancellation/provider-version checks, malformed/partial accounting and private/no-store response headers.
- No cache of mutable response objects, unchecked size hints, public unbounded response-schema exports, removed validation, fixture shortcuts, dependency changes or broad parser rewrite.
- Do not claim Cloudflare CPU improvement from Node/local timing or change billing/production/guest activation. Existing sealed-package proofs retain their original inputs.

## Task 1 — Share validation without duplicate byte serialization

Files: `src/lib/guest/sources/contracts.ts`, `canvas.ts`, `ed.ts`; focused tests `tests/unit/guest-canvas.test.ts`, `guest-ed.test.ts`, `guest-source-contracts.test.ts`.

- [x] Add a failing regression observing actual output-bound JSON serialization through each real reader: two current full output stringifications become one. Keep instrumentation out of production and retain the RED log.
- [x] Add characterization of server/public-schema agreement for valid output and rejected unknown fields, private/invalid URLs, duplicate/course/report mismatches, multibyte/escaped output and boundary/oversize values. Also reproduce and fix original custom-serialization/changing-getter discrepancies; verify size-error precedence.
- [x] Introduce typed helpers using the same private shapes. Existing exported bounded schemas remain bounded. Readers use the helpers and retain all guards.
- [x] Pass focused contracts/Canvas/Ed/HTTP/deadline tests (113), types/lint/diff checks. Independent ECC task/fix review accepts the final clone-bound validation.

## Task 2 — Quantify and integrate the scoped result

- [x] Compare the actual pre/post source pipelines with identical fixed synthetic fixtures, separately recording deterministic serialization counts and qualified local timing. Output hashes match and the count is two-to-one across all fixtures; mixed timings and coarse Windows CPU counters establish no CPU/headroom improvement.
- [x] Run appropriate broader checks and fresh compiled/native checks for changed runtime inputs. Full local 2,279 pass / 46 existing platform skips; types/lint and fresh 13-request sealed-package proof pass. [The release record](../../deployment/guest-response-validation.md) preserves the still-open Free CPU decision.
- [ ] Freeze the candidate, perform independent ECC/security review, publish the PR and require normal CI before merge. No deployment or new cloud workload follows automatically.

## Review focus

Check output mutation/transforms cannot bypass byte limits; oversize versus malformed precedence; exact UTF-8/escaped-byte accounting; no unbounded schema exposed to a caller; no deadline/current-provider check moved past accepted return. The optimization is useful only if duplicate work is actually removed with these invariants intact; reaching the nominal 10 ms allowance is not promised.
