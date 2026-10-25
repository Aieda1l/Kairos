import {expect,test} from "@playwright/test";

test("native guest storage survives reload and aborts all stores atomically",async({page})=>{
  await page.goto("/");
  const initial=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    const h=await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness");
    return h.seed("reload");
  });
  await page.reload();
  const result=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    const h=await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness");
    return h.storageChecks("reload");
  });
  expect(result.persisted).toEqual(initial);
  expect(result.afterQuotaAbort).toEqual(result.beforeQuotaAbort);
  expect(result.remembered).toBe("remembered-secret");
  expect(result.afterForget.assignments).toEqual(initial.assignments);
  expect(result.afterForget.connections[0].generation).toBeGreaterThan(initial.connections[0].generation);
  expect(result.forgotten).toBeNull();
  expect(result.reentered.assignments).toEqual(initial.assignments);
  expect(result.reentered.connections[0].generation).toBeGreaterThan(result.afterForget.connections[0].generation);
  expect(result.failedCredentialUnchanged).toBe(true);
  expect(result.corruptIdentity).toEqual(result.identityBeforeCorruption);
  expect(result.reset.assignments).toEqual([]);
  expect(result.reset.datasetId).not.toBe(initial.datasetId);
});

test("native guest selection and response membership preserve source provenance",async({page})=>{
  await page.goto("/");
  const r=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    const h=await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness");
    return h.membershipChecks();
  });
  expect(r.discovery.courses.every(c=>!c.enabled)).toBe(true);
  expect(r.discovery.syncStates).toEqual([]);
  expect(r.discovery.assignments).toEqual([]);
  expect(r.selection.connections[0].generation).toBe(r.discovery.connections[0].generation+1);
  expect(r.selection.courses[0].id).toBe(r.discovery.courses[0].id);
  expect(r.noop).toEqual(r.selection);
  expect(r.invalidSelection).toBe(true);
  expect(r.invalidMembership).toBe(true);
  expect(r.afterRejected).toEqual(r.beforeRejected);
  expect(r.afterAbort).toEqual(r.beforeAbort);
  expect(r.accepted.status).toBe("accepted");
  expect(r.terminal.syncStates[0]).toMatchObject({hasSuccessfulCheck:true,lastErrorCode:"PARTIAL_SYNC",updatedCount:7,failedCount:0});
  expect(r.failedAttempt.syncStates[0]).toMatchObject({hasSuccessfulCheck:false,lastErrorCode:"ED_NETWORK_ERROR",updatedCount:0,failedCount:1,lastSuccessfulAt:r.terminal.syncStates[0].lastSuccessfulAt});
  expect(r.requestCount).toBe(100);
  expect(r.overLimit).toBe(false);
  expect(r.privateRequestLeak).toBe(false);
  expect(r.corruptMetadataFailed).toBe(true);
  expect(r.afterCorruptReset).toEqual(r.beforeCorruptReset);
});
