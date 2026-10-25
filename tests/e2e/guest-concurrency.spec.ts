import {expect,test} from "@playwright/test";

test("guest extension deadlines permit renewed replies between fifteen and thirty seconds",async({page})=>{
  await page.goto("/");
  const r=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness")).deadlineChecks();
  });
  expect(r.registrations).toEqual({"canvas-feed":false,"canvas-status":true,gradescope:true,"gradescope-discovery":true,ed:false,"ed-courses":false});
  expect(r.oversized).toEqual([false,false,false,false,false,false]);
  expect(r.extensionReply?.status).toBe("accepted");
  expect(r.serverExpired?.status).toBe("discarded");
  expect(r.beyondRunDeadline).toBe(false);
});

test("guest finalization retains four slots after one hundred provider reads",async({page})=>{
  await page.goto("/");
  const r=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness")).finalizationChecks();
  });
  expect(r.providerCount).toBe(100);
  expect(r.provider101).toBe(false);
  expect(r.finalizers).toEqual([true,true,true,true]);
  expect(r.commits).toEqual(["accepted","accepted","accepted","accepted"]);
  expect(r.totalRecords).toBe(104);
  expect(r.duplicates).toEqual([false,false,false,false]);
  expect(r.wrongIntentAccepted).toBe(false);
  expect(r.wrongFinalizerAccepted).toBe(false);
  expect(r.mismatchedStageAccepted).toBe(false);
  expect(r.nonemptyFinalizerAccepted).toBe(false);
  expect(r.intentNormalized).toBe(true);
  expect(r.earlyFinalization).toEqual({providerCount:100,totalRecords:104,consumedProviders:1,provider101:false});
});

test("guest commits revalidate live Canvas tuples after an intervening feed",async({page})=>{
  await page.goto("/");
  const r=await page.evaluate(async()=>{
    const path="/tests/e2e/fixtures/guest-store-harness.ts";
    return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-store-harness")).liveMembershipChecks();
  });
  for(const result of r.changed){
    expect(result.staleAccepted).toBe(false);
    expect(result.afterStale).toEqual(result.beforeStale);
    expect(result.currentReply.status).toBe("accepted");
  }
  expect(r.nullableRegistered).toBe(true);
  expect(r.nullableReply?.status).toBe("accepted");
});

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
