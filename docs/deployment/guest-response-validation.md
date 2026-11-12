# Guest response validation: local performance increment

The Canvas feed, Ed courses and Ed lessons readers each performed two full JSON/UTF-8 output-size serializations before HTTP response serialization. Revision `43986463764dc301f1c267e8f8e352da8b85f5df` removes one of those duplicate checks. This establishes less repeated work, **not a measured Cloudflare CPU improvement or a Free-capacity pass**. Guest activation and production configuration are unchanged.

Each response now has one private strict shape. Its public response schema remains independently byte-bounded for untrusted/browser callers. Server helpers parse that same shape, measure the stable validated clone once, and return it only within the existing limit. Invalid ordinary JSON is still measured once to preserve oversize-error precedence. No mutable cache, size hint or bare unbounded schema is exported. DTOs, byte/array limits, safe errors, URL/duplicate/course/report checks, deadlines, provider-version fences and admission remain intact.

Independent ECC review caught an initial helper measuring the original object instead of the returned clone. Actual failing tests reproduced a hidden `toJSON` method and a changing getter concealing a 782,021-byte clone behind a smaller serialization. The corrected helper measures its accepted clone; both regressions and the existing source checks pass. No upstream JSON exploit was identified in the original reader-created DTOs.

## Qualified local comparison

A separate local Node comparison used Git-pinned baseline `c1c3bafdcf98a6a122f44f2e72cc2cb93a2a8b21` and the changed readers/contracts, with identical common source inputs and fixed synthetic fixtures. Each case had one warmup pair and five measured pairs with alternating variant order. Every output hash matched; all three readers changed from **two output-bound serializations to one**. HTTP response encoding is separate and remains necessary.

| Fixture | Baseline median elapsed ms | Changed median elapsed ms |
| --- | --- | --- |
| Canvas 2,000 assignments, near byte cap | 44.70 | 36.13 |
| Canvas 5,000 ordinary events | 21.26 | 20.89 |
| Ed 500 courses, near byte cap | 8.31 | 9.66 |
| Ed 2,000 raw / 1,000 visible lessons | 15.38 | 13.98 |

These are descriptive Node wall times, including local streams/parsing/normalization/schema work, instrumentation and shared GC. Some cases regressed. Windows process CPU accounting was coarse and variable; neither these small samples nor serialization counts establish overall CPU improvement, production latency or the nominal Free allowance. The measurement was made before commit from Windows working files: runtime inputs match the frozen Git source after CRLF/LF normalization, rather than having equal raw-byte hashes. The later hermetic build uses the exact Git blobs. The earlier pre-fix helper comparison is retained separately and is not proof of the corrected helper.

## Verification and next decision

Actual RED tests observed two output stringifications instead of one through all three real readers. The final focused contracts/readers/bounded-body/HTTP suites pass **113 tests**. The full local suite passes **2,279 tests**, with 46 existing platform skips; types, scoped lint and diff checks pass. Independent task/fix and whole-branch ECC reviews accept the scoped change without an open finding.

A fresh hermetic build of revision `4398646` produced offline diagnostic package SHA-256 `0db9c174b2b70db9e7b9b0821723e55ed6866b46a4311b6edd4404bf45352132`. Its fresh workerd proof passes 13/13 requests, preserves all 21 protected tables, returns near-cap counts `[2000,2000,500,500,1000,1000]`, makes zero rejecting outbound-sink attempts and disposes successfully. This local proof is distinct from the earlier hosted package; no new cloud resources or provider requests were made. Proposed cloud identities remain unresolved and are not permission to execute a new packet.

Reproduce the focused regressions with:

```sh
npx vitest run tests/unit/guest-canvas.test.ts tests/unit/guest-ed.test.ts tests/unit/guest-source-contracts.test.ts tests/unit/bounded-body.test.ts tests/integration/guest-source-api.test.ts
```

The subsequent [hosted v3 re-test](guest-hosted-run-2026-11-12-v3.md) passed 13/13 requests and is now the latest actual cloud observation. Its sampled CPU remains above the nominal Free allowance; no causal performance improvement or regression is established. The user retained Workers Free as the release target. Its CPU headroom finding is open. Normal required CI precedes merge; deployment, another reviewed cloud measurement, retention/cadence, real-provider acceptance and the [final release decision](../superpowers/plans/2026-11-12-guest-release-finish.md) remain separate steps. Completion after closing Kairos stays deferred.
