import {expect,test} from "@playwright/test";

test("native guest transactions fence stale writers",async({page})=>{
  await page.goto("/");
  const r=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    const h=await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness");
    return h.concurrencyChecks();
  });
  expect(r.acquisitions.filter(Boolean)).toHaveLength(1);
  expect(r.newOwner.generation).toBeGreaterThan(r.oldOwner.generation);
  expect(r.afterOldRelease.lease.runId).toBe(r.newOwner.runId);
  expect(r.staleCommit.status).toBe("discarded");
  expect(r.accepted.status).toBe("accepted");
  expect(r.duplicate).toEqual({status:"discarded",reason:"consumed"});
  expect(r.expired.status).toBe("discarded");
  expect(r.queuedExpired.status).toBe("discarded");
  expect(r.rollbackOwner.generation).toBeGreaterThan(r.newOwner.generation);
  for(const result of r.invalidated)expect(result.status).toBe("discarded");
  expect(r.imported.credentials).toHaveLength(0);
  expect(r.imported.requests).toHaveLength(0);
  expect(r.successFlag).toBe(true);
  expect(r.resetFlag).toBe(false);
});
