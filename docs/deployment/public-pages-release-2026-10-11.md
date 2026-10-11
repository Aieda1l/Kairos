# Public-page correction release — October 11, 2026

The public homepage, privacy, terms, support and security pages now explain Kairos's purpose, optional integrations, stored data, provider processing, retention and deletion/revocation limits. This release addresses the public-content findings reported by Google and retains the verified Milestone 6 application behavior. Milestone 7 and public-beta acceptance remain incomplete.

## Exact release

| Item | Evidence |
| --- | --- |
| Production | https://mykairos.me |
| Source | `71e0095db790e0099970e3a8a030f9f12e4f8bfc`, local tag `public-pages-2026-10-11` |
| Source boundary | Finalized `milestone-6` plus the ten reviewed C2 public-page/runbook/test files; M7 implementation checkpoint `5ca08d4` contains the same file content |
| Worker | `ac409786-d3ff-43ce-a35f-ba4a1d370e38`, 100% traffic |
| Deployment | `d045e02a-3904-4d4c-a93f-856955821bc8` |
| Rollback | Worker `a9cb9a0b-3dfe-4e1a-8930-382bbb041866`, previous deployment `ac07c92d-61e2-4300-bc37-0f1de769484f` |

The deployment used the compiled Workers entry, module rules and `--keep-vars`. The existing production D1 binding, all 14 expected secret binding names, Workers.dev and preview settings were verified before and after deployment. Persistent observability remains disabled. No production migration, database reset or user-data operation was performed. The CLI token's direct production D1 query returned HTTP 403; this release does not claim a fresh remote migration-table inspection.

## Verification

- Fresh C2 spec/quality/ECC security review approved the immutable change, with no Critical or Important findings.
- Coherent Next type generation and the preserved-tree TypeScript check passed after stopping the development server. The earlier Next/vinext generated-file conflict was resolved without source changes.
- The isolated M6+C2 release passed 515 tests in 103 files, all 14 Chromium/Firefox E2E tests with an explicit 90-second test timeout, lint with zero errors and seven existing warnings, Next compatibility build, final Workers build and hosted safety verification.
- Local D1 tests proved tenant foreign-key rejection and migration reapplication preserves data. Real workerd provider-client probes passed using invalid credentials and Canvas fixtures; they do not establish real provider access. Verified temporary test/probe directories were retained without recursive cleanup deletion.
- Production checks passed for all five public pages with ordinary and diagnostic Google-InspectionTool user agents: HTTP 200, no login redirect, expected canonical URLs, substantive purpose/privacy disclosures and public domain aliases only. Signed-in route entry remains protected, sign-in/providers return 200 and the fixture endpoint returns 404: 18 HTTP checks total.
- Ten additional live Chromium/Firefox checks passed at 390px, with no horizontal overflow or page errors and a white sign-in CTA foreground. Local checks also covered desktop rendering and navigation.

A shared dependency junction caused the first isolated Next build to fail; a clean lockfile install resolved it. Existing dependency identities were unchanged. npm's five blocked lifecycle scripts stayed blocked, and packaged binaries sufficed. Wrapper syntax/encoding errors occurred before uploading; corrected wrappers and an exact ten-file comparison preceded the successful deployment. A smoke assertion's wording mismatch was corrected against the actual public notice before recording success.

## Remaining external gates

The operator confirmed Search Console ownership at approximately `2026-10-11T06:07:01Z`. Google's reported 24-hour wait ends no earlier than `2026-10-12T06:07:01Z` (October 11, approximately 11:07 PM Pacific), subject to propagation. A diagnostic user agent is not evidence of an actual Google crawl or verification approval. Retry verification after the wait and confirm the provider's result.

Mail routing is active and the destination verified; real delivery to both support/security aliases remains pending. Mozilla signing/listing, normal install/update acceptance and the remaining M7 runtime, operational, security and hosted acceptance gates remain pending. Prepared extension/onboarding/abuse behavior is qualified in the public policy and must be reconciled when it is deployed.
