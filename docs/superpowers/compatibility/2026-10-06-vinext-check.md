# vinext Compatibility Check — Milestone 6

**Date:** 2026-10-06
**Target:** Cloudflare Workers via vinext 1.x / Vite 8

Current upstream guidance for an existing Next.js 16 App Router project uses `vinext` with Vite 8 and `@cloudflare/vite-plugin`. The Milestone 6 branch keeps the existing Next.js build alongside `build:vinext` during migration.

## Known pre-check risk

The existing production runtime still imports Node filesystem APIs and `better-sqlite3` through `src/lib/db/client.ts`. Plan 6B removes that runtime path in favor of D1.

## Automated check

The first configured Milestone 6 CI run will execute `vinext check` and `npm run build:vinext`. This document will be updated with the observed exit status before Task 1 is marked complete.
