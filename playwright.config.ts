import { defineConfig, devices } from "@playwright/test";

const resetLocalD1=`node -e "require('node:fs').rmSync('.wrangler/state',{recursive:true,force:true})"`;
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
    command:`${resetLocalD1} && npm run db:migrate:local && npm run dev:vinext -- --host 127.0.0.1`,
    url:"http://127.0.0.1:3000",
    reuseExistingServer:!process.env.CI,
    env:{
      ...process.env,
      E2E_FIXTURES:"1",
      KAIROS_CREDENTIAL_KEY_V1:e2eCredentialKey,
    },
  },
  projects:[
    {
      name:"chromium",
      testMatch:/(canvas-onboarding|ed-sync|calendar-sync|multi-user-isolation)\.spec\.ts/,
      use:{...devices["Desktop Chrome"]},
    },
    {
      name:"firefox",
      testMatch:/(submission-status|gradescope-sync)\.spec\.ts/,
      use:{...devices["Desktop Firefox"]},
    },
  ],
});
