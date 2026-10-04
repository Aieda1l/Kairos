import fs from "node:fs";import {defineConfig,devices} from "@playwright/test";
const e2eDb=".data/e2e.sqlite";for(const suffix of ["","-wal","-shm"])try{fs.rmSync(e2eDb+suffix);}catch{}
export default defineConfig({testDir:"./tests/e2e",use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure"},webServer:{command:"npm run dev -- --hostname 127.0.0.1 --port 3000",url:"http://127.0.0.1:3000",reuseExistingServer:!process.env.CI,env:{...process.env,E2E_FIXTURES:"1",ASSIGNMENTS_DB_PATH:e2eDb}},projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}]});
