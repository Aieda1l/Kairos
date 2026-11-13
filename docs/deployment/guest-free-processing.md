# Guest source processing on Workers Free

Implementation candidate: runtime `0a2e7a8af076380052cded94b940f1566341f113`, with diagnostic tooling and CI integration in the same feature branch. The user approved the [design](../superpowers/specs/2026-11-12-guest-free-processing-design.md) and retained Workers Free. Hosted feasibility, production deployment and guest activation remain open; the production guest flag stays false.

Canvas and Ed source reads now relay at most 2 MiB of provider bytes to a dedicated foreground browser worker. It produces the existing normalized v1 data, then the client obtains a signed-receipt approval before accepting the result. Source HTTP requests use v2; old source requests fail cheaply. Account interfaces, saved guest data, backups, source limits and sync fences retain their existing behavior.

Raw provider responses can include private fields and reflected credentials. They remain transient in server/browser memory and do not enter Kairos storage, exports, DOM or diagnostics. Credentials remain in browser memory unless the user chooses device storage. The original fifteen-second source budget covers relay, parsing and approval together; closing the tab still interrupts the foreground flow.

Each successful source read uses two claims from the existing shared global pool of sixty per 600 seconds, allowing up to thirty complete reads in that interval across all guests. Session and network limits are unchanged. A burst of sixty raw reads can fill the pool before approvals, leaving no complete reads; local verification records that limitation. This design does not establish sufficient daily Free capacity or hosted CPU headroom.

Local evidence for the frozen runtime:

- Portable parser: 120 golden-vector checks in Chromium/Firefox across UTC, Los Angeles and Kolkata; receipt `artifacts/guest-parser-parity/2026-11-13T17-45-57-306Z/receipt.json`.
- Both production builds passed. Actual emitted Vite and Next workers: 80 golden-vector checks in Chromium/Firefox with self-only script/worker CSP and zero unexpected requests; receipt `artifacts/guest-worker-assets/2026-11-13T18-37-49-703Z/receipt.json`. This executes worker assets and dependencies, not full production page navigation.
- Actual compiled source verifier: 88 checks in six phases, zero protected writes or external requests; receipt `artifacts/guest-source-capacity/2026-11-13T18-15-22-677Z-native/receipt.json`.
- H1/H2 local baseline: 22 physical requests for thirteen logical flows, 37 new anonymous rows, ten fixture reads and all 21 protected table digests unchanged. Package digest `1c416af3031d288a0e2a2a9da627cab49f7d689514f2753a6ff67e451a215b8c`; receipt `artifacts/guest-hosted/native-free-processing-20261113-local1/receipt.json`. This initial proof records precommit diagnostic-driver hashes; it is not a cloud measurement.
- Affected application journeys covered 68 distinct E2E cases across two runs. Late-approval tests establish persistence fences; direct worker-abort tests cover termination. They do not individually establish every lifecycle transition while a real worker is executing.
- Full local Vitest: 2,342 passed, 46 platform-specific skips on Windows. Typecheck passed with the original generated declaration restored; tracked-source lint passed with six existing warnings. Unqualified lint also scans ignored local reference artifacts and fails there, so only that ignored evidence directory was excluded. Linux CI remains required before merge.

Reproduce parser/asset checks after installing Chromium and Firefox:

```sh
node scripts/verify-browser-guest-parsers.mjs
npm run build
npm run build:vinext
node scripts/verify-browser-guest-worker-assets.mjs
node scripts/verify-workerd-guest-sources.mjs
```

The Node diagnostic client uses the actual parser from verified retained source and is labelled separately from browser execution. Its normalized output is client-derived; HTTP records describe the actual raw response and approval response independently.

Next gates: normal CI and ECC review before merge, then a fresh reviewed finite 22-request isolated hosted packet with owned-resource cleanup. Historical v2/v3 packets remain consumed and cleaned. A new package needs separate operator authorization; implementation approval authorizes no cloud calls, deployment, billing change, maintenance enablement, real-provider traffic or activation.
