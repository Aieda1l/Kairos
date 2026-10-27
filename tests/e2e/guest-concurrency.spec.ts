import {expect,test} from "@playwright/test";

test("guest initial partial Canvas setup persists diagnostics atomically",async({page,context})=>{
  await context.route("**/api/guest/**",route=>route.abort());await page.goto("/");
  const r=await page.evaluate(async id=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).initialPartialChecks(id);},crypto.randomUUID());
  expect(r.failed?.status).toBe("failed");expect(r.afterAbort).toEqual(r.before);expect(r.abortedSecret).toBeNull();
  expect(r.accepted).toMatchObject({status:"success",code:"PARTIAL_SYNC"});
  expect(r.after.connections).toHaveLength(1);expect(r.after.assignments).toEqual([expect.objectContaining({externalId:"accepted-partial",title:"Accepted homework"})]);
  expect(r.after.syncStates).toEqual([expect.objectContaining({stage:"canvas-feed",hasSuccessfulCheck:true,updatedCount:1,failedCount:2,lastErrorCode:"PARTIAL_SYNC"})]);
  expect(r.secret).toBe("private-partial-feed");expect(JSON.stringify(r.after)).not.toContain("private-partial-feed");
});

test("two guest pages reject a delayed coordinator commit and preserve the takeover lease",async({page,context})=>{
  await context.route("**/api/guest/**",route=>route.abort());
  const second=await context.newPage();await Promise.all([page.goto("/"),second.goto("/")]);
  const id=crypto.randomUUID();
  const before=await page.evaluate(async id=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).startOld(id);},id);
  const takeover=await second.evaluate(async id=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).takeOver(id);},id);
  const late=await page.evaluate(async()=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).settleOld();});
  expect(late.attempted).toContainEqual({status:"discarded",reason:"superseded"});
  expect(late.snapshot).toEqual(takeover.snapshot);expect(late.snapshot.assignments).toEqual(before.assignments);
  expect(late.report.outcomes.every(o=>o.status!=="success")).toBe(true);
  const owner=await second.evaluate(async()=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).verifyOwner();});
  expect(owner?.runId).toBe(takeover.lease.runId);await second.close();
});

test("guest coordinator course refresh preserves selection and rolls back atomically",async({page,context})=>{
  await context.route("**/api/guest/**",route=>route.abort());await page.goto("/");
  const result=await page.evaluate(async id=>{const path="/tests/e2e/fixtures/guest-coordinator-harness.ts";return (await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness")).refreshChecks(id);},crypto.randomUUID());
  expect(result.refresh.status).toBe("success");expect(result.after.courses.find(c=>c.externalCourseId==="1")).toMatchObject({id:result.before.courses[0].id,fullName:"Renamed",enabled:true});
  expect(result.after.courses.find(c=>c.externalCourseId==="2")).toMatchObject({externalCourseId:"2",enabled:false});
  expect(result.after.connections[0].generation).toBe(result.before.connections[0].generation+1);
  expect(result.remembered).toBe("private-test-token");expect(result.rejected?.status).toBe("failed");
  expect(result.afterAbort).toEqual(result.after);expect(result.secretAfterAbort).toBe("private-test-token");
  expect(result.duplicateRejected).toBe(true);expect(result.afterRejected).toEqual(result.after);
  expect(result.accepted.status).toBe("accepted");expect(result.consumed.status).toBe("discarded");expect(result.stale.status).toBe("discarded");
  expect(result.overflowRejected).toBe(true);expect(result.afterOverflow).toEqual(result.beforeOverflow);expect(result.reuse.status).toBe("accepted");
});

for(const kind of ["reset","disconnect"] as const)test(`guest coordinator discards a response after ${kind}`,async({page,context})=>{
  await context.route("**/api/guest/**",route=>route.abort());await page.goto("/");
  const result=await page.evaluate(async({id,kind})=>{
    const path="/tests/e2e/fixtures/guest-coordinator-harness.ts",h=await import(/* @vite-ignore */ path) as typeof import("./fixtures/guest-coordinator-harness");
    await h.startOld(id);const reset=await h.invalidateOld(kind),late=await h.settleOld();return {reset,late};
  },{id:crypto.randomUUID(),kind});
  expect(result.late.snapshot).toEqual(result.reset);expect(result.late.snapshot.assignments).toEqual([]);
  expect(result.late.attempted.some(r=>r.status==="discarded")).toBe(true);
  expect(result.late.report.outcomes.every(o=>o.status!=="success")).toBe(true);
});

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
