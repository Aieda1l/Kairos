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
    reuseExistingServer:false,
    env:{
      ...process.env,
      KAIROS_E2E_PERSIST_PATH:e2ePersistPath,
      E2E_FIXTURES:"1",
      KAIROS_CREDENTIAL_KEY_V1:e2eCredentialKey,
      KAIROS_CREDENTIAL_KEY_V2:'',
      KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v1',
      KAIROS_E2E_CACHE_DIR:join(tmpdir(),`kairos-e2e-cache-${randomUUID()}`),
      GOOGLE_CALENDAR_CLIENT_ID:'kairos-e2e-calendar-client',
      AUTH_SECRET:'kairos-e2e-auth-secret',
      AUTH_GOOGLE_ID:'kairos-e2e-google-id',
      AUTH_GOOGLE_SECRET:'kairos-e2e-google-secret',
      AUTH_MICROSOFT_ENTRA_ID_ID:'kairos-e2e-microsoft-id',
      AUTH_MICROSOFT_ENTRA_ID_SECRET:'kairos-e2e-microsoft-secret',
    },
  },
  projects:[
    {
      name:"chromium",
      testMatch:/(canvas-onboarding|ed-sync|calendar-sync|multi-user-isolation|sign-out|privacy-boundary|optional-onboarding|first-run-onboarding|auth-initiation)\.spec\.ts/,
      use:{...devices["Desktop Chrome"]},
    },
    {
      name:"firefox",
      testMatch:/(submission-status|gradescope-sync|sign-out|privacy-boundary|optional-onboarding|first-run-onboarding|auth-initiation)\.spec\.ts/,
      use:{...devices["Desktop Firefox"]},
    },
  ],
});
