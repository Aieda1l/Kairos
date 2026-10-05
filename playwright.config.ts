import { defineConfig, devices } from "@playwright/test";

const e2eDb=".data/e2e.sqlite";
const resetE2eDb=`node -e "const fs=require('node:fs');for(const s of ['','-wal','-shm']){try{fs.rmSync('${e2eDb}'+s)}catch{}}"`;

export default defineConfig({
  testDir:"./tests/e2e",
  fullyParallel:false,
  workers:1,
  use:{
    baseURL:"http://127.0.0.1:3000",
    trace:"retain-on-failure",
  },
  webServer:{
    command:`${resetE2eDb} && npm run dev -- --hostname 127.0.0.1 --port 3000`,
    url:"http://127.0.0.1:3000",
    reuseExistingServer:!process.env.CI,
    env:{
      ...process.env,
      E2E_FIXTURES:"1",
      ASSIGNMENTS_DB_PATH:e2eDb,
    },
  },
  projects:[
    {
      name:"chromium",
      testMatch:/canvas-onboarding\.spec\.ts/,
      use:{...devices["Desktop Chrome"]},
    },
    {
      name:"firefox",
      testMatch:/(submission-status|gradescope-sync)\.spec\.ts/,
      use:{...devices["Desktop Firefox"]},
    },
  ],
});
