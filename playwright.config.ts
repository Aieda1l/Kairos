import { defineConfig, devices } from "@playwright/test";
import {randomUUID} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Run browser tests against a fresh D1 instance without touching local developer data.
const e2ePersistPath=join(tmpdir(),`kairos-e2e-${randomUUID()}`);
const e2eCredentialKey="FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc";

export default defineConfig({
  testDir:"./tests/e2e",
  fullyParallel:false,
  workers:1,
  use:{
    baseURL:"http://127.0.0.1:3000",
    trace:"retain-on-failure",
  },
  webServer:{
    command:`npx wrangler d1 migrations apply kairos --local --persist-to "${e2ePersistPath}" && npm run dev:vinext -- --host 127.0.0.1`,
    url:"http://127.0.0.1:3000",
    reuseExistingServer:!process.env.CI,
    env:{
      ...process.env,
      KAIROS_E2E_PERSIST_PATH:e2ePersistPath,
      E2E_FIXTURES:"1",
      KAIROS_CREDENTIAL_KEY_V1:e2eCredentialKey,
    },
  },
  projects:[
    {
      name:"chromium",
      testMatch:/(canvas-onboarding|ed-sync|calendar-sync|multi-user-isolation|sign-out|privacy-boundary)\.spec\.ts/,
      use:{...devices["Desktop Chrome"]},
    },
    {
      name:"firefox",
      testMatch:/(submission-status|gradescope-sync|sign-out|privacy-boundary)\.spec\.ts/,
      use:{...devices["Desktop Firefox"]},
    },
  ],
});
