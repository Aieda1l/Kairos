import {expect,test} from "@playwright/test";
import {serializeGuestBackup} from "../../src/lib/guest/backup";
import {guestSnapshotFixture} from "../helpers/guest-fixtures";
import {finishGuestVerification,resetGuestAdmission,sealGuestJourney} from "./fixtures/guest-session";
import {connectCanvas,holdCanvasStatus,installLifecycleSources,localData,privateData,releaseCanvasStatus} from "./fixtures/guest-lifecycle";

test.beforeEach(async({context})=>{await resetGuestAdmission(context);});
test("Stop waiting aborts a held server read and ignores a late verification rejection",async({page})=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);
  await page.addInitScript(()=>{const original=window.fetch;window.fetch=(input,init)=>{if(String(input).includes("/api/guest/sources/canvas/feed"))init?.signal?.addEventListener("abort",()=>sessionStorage.setItem("guest-server-aborted","yes"));return original(input,init);};});
  await page.goto("/guest/sources");await connectCanvas(page);const before=await localData(page);
  let release!:()=>void;let seen!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),received=new Promise<void>(resolve=>{seen=resolve;});
  await page.route("**/api/guest/sources/canvas/feed",async route=>{seen();await held;await route.fulfill({status:401,json:{ok:false,code:"GUEST_SESSION_REQUIRED",message:"Guest verification is required."}}).catch(()=>{});});
  await page.getByRole("button",{name:"Sync Canvas",exact:true}).click();await received;
  await page.getByRole("button",{name:"Stop waiting"}).click();await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem("guest-server-aborted"))).toBe("yes");
  await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();release();await page.unroute("**/api/guest/sources/canvas/feed");
  expect((await localData(page)).assignments).toEqual(before.assignments);await expect(page.getByRole("region",{name:"Guest verification"})).toHaveCount(0);
  await page.getByRole("button",{name:"Sync Canvas",exact:true}).click();await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();expect(capture.forbidden).toEqual([]);
});
test("Stop waiting fences a held extension reply and permits a fresh sync",async({page})=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);
  await holdCanvasStatus(page);const before=await localData(page);
  await page.getByRole("button",{name:"Stop waiting"}).click();
  await expect(page.getByText(/extension read may continue/i)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();
  await expect(page.getByText(/sync incomplete/i).first()).toBeVisible();
  const stopped=await localData(page);expect(stopped.assignments).toEqual(before.assignments);
  await releaseCanvasStatus(page);expect(await localData(page)).toEqual(stopped);
  await expect(page.getByRole("region",{name:"Guest verification"})).toHaveCount(0);
  await page.evaluate(()=>sessionStorage.removeItem("guest-status-mode"));
  await page.getByRole("button",{name:"Sync Canvas",exact:true}).click();
  await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();
  expect(capture.forbidden).toEqual([]);
});

for(const view of ["assignments","calendar"] as const)for(const replacement of ["reset","import","source"] as const)test(`open ${view} detail closes after another tab ${replacement}`,async({page,context})=>{
  const phaseTimeout=30_000;test.setTimeout(3*phaseTimeout);context.setDefaultTimeout(30_000);context.setDefaultNavigationTimeout(30_000);
  const capture=await test.step("Connect Canvas and create the shared guest dataset",async()=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page,new Date().toISOString());await page.goto("/guest/sources");await connectCanvas(page);
  return capture;
  },{timeout:phaseTimeout});
  const {other,otherCapture}=await test.step("Open the detail and prepare the sealed peer tab",async()=>{
  await page.goto(`/guest/${view}`);
  if(view==="assignments"){
    await expect(page.getByText("Canvas status partially updated",{exact:true})).toBeVisible();
    await expect(page.getByText(/9 of 10 statuses updated/)).toBeVisible();
    await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();
  }
  await page.getByRole("button",{name:/View .*details|View .* due/}).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const other=await context.newPage();const otherCapture=await sealGuestJourney(other);await installLifecycleSources(other);
  return {other,otherCapture};
  },{timeout:phaseTimeout});
  await test.step("Replace data in the peer and verify the original detail closes",async()=>{
  if(replacement==="source"){
    await other.goto("/guest/sources");await other.getByRole("button",{name:"Disconnect Canvas",exact:true}).click();await other.getByRole("button",{name:"Confirm disconnect Canvas"}).click();
  }else{
    await other.goto("/guest/settings");
    if(replacement==="reset"){await other.getByRole("button",{name:"Clear guest data"}).click();await other.getByRole("button",{name:"Confirm clear guest data"}).click();}
    else {await other.getByLabel("Import guest backup").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(serializeGuestBackup(guestSnapshotFixture(),"2026-10-24T12:00:00.000Z"))});await other.getByRole("button",{name:"Replace local data"}).click();}
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);expect(capture.forbidden).toEqual([]);expect(otherCapture.forbidden).toEqual([]);
  // The supplied context fixture disposes both tabs and reports teardown failures.
  },{timeout:phaseTimeout});
});
test("complete guest flow survives reload and rejects a late reset result",async({page,context})=>{
  const phaseTimeout=30_000;test.setTimeout(5*phaseTimeout);context.setDefaultTimeout(30_000);context.setDefaultNavigationTimeout(30_000);
  const capture=await test.step("Connect Canvas",async()=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);
  return capture;
  },{timeout:phaseTimeout});
  await test.step("Connect Gradescope and Ed",async()=>{
  await page.getByRole("button",{name:"Connect Gradescope",exact:true}).click();await page.getByLabel("GS 123").check();await page.getByRole("button",{name:"Save Gradescope courses"}).click();
  await page.getByLabel("Ed API token").fill("fixture-guest-ed-token-never-echo");await page.getByLabel("Remember Ed credential on this device").check();await page.getByRole("button",{name:"Connect Ed",exact:true}).click();await finishGuestVerification(page);
  await page.getByLabel("CSE 331").check();await page.getByRole("button",{name:"Save Ed courses"}).click();
  },{timeout:phaseTimeout});
  const saved=await test.step("Sync and verify all source data after reload",async()=>{
  await page.getByRole("button",{name:"Sync sources",exact:true}).click();await expect(page.getByText(/9 of 10/)).toBeVisible();await expect(page.getByText("Ed sync complete",{exact:true})).toBeVisible();await expect(page.getByText("Gradescope sync complete",{exact:true})).toBeVisible();
  const saved=await localData(page);expect(saved.assignments.filter(a=>a.source==="canvas")).toHaveLength(10);expect(saved.assignments.some(a=>a.source==="ed")).toBe(true);expect(saved.assignments.some(a=>a.source==="gradescope")).toBe(true);expect(saved.statuses).toHaveLength(10);
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();await page.reload();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"View Ed Dated Lesson details",exact:true})).toBeVisible();
  expect((await localData(page)).assignments).toEqual(saved.assignments);
  return saved;
  },{timeout:phaseTimeout});
  const {afterReset,privateReset}=await test.step("Hold a status read and reset the dataset",async()=>{
  await page.getByRole("link",{name:"Sources",exact:true}).click();await holdCanvasStatus(page);
  await page.getByRole("link",{name:"Settings",exact:true}).click();await page.getByRole("button",{name:"Clear guest data",exact:true}).click();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();
  const afterReset=await localData(page),privateReset=await privateData(page);expect(afterReset.datasetId).not.toBe(saved.datasetId);
  return {afterReset,privateReset};
  },{timeout:phaseTimeout});
  await test.step("Release the late result and verify the reset",async()=>{
  await releaseCanvasStatus(page);await page.getByRole("link",{name:"Sources",exact:true}).click();await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();const afterLateResponse=await localData(page);expect(afterLateResponse.datasetId).toBe(afterReset.datasetId);expect(afterLateResponse).toEqual(afterReset);expect(await privateData(page)).toEqual(privateReset);
  expect(afterLateResponse.assignments).toEqual([]);expect(privateReset.credentials).toEqual([]);expect(privateReset.requests).toEqual([]);expect(privateReset.metadata[0]).toMatchObject({lease:null});
  const hostedSourceRequests=capture.forbidden;expect(hostedSourceRequests).toEqual([]);expect((await context.cookies()).some(c=>/authjs|session-token/.test(c.name))).toBe(false);
  },{timeout:phaseTimeout});
});

for(const replacement of ["import","source"] as const)test(`late source response cannot mutate confirmed ${replacement} replacement`,async({page,context})=>{
  const phaseTimeout=30_000;test.setTimeout(3*phaseTimeout);context.setDefaultTimeout(30_000);context.setDefaultNavigationTimeout(30_000);
  const capture=await test.step("Prepare and hold a status read",async()=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);if(replacement==="source")await page.clock.install();await holdCanvasStatus(page);
  return capture;
  },{timeout:phaseTimeout});
  const {otherCapture,accepted,privateAccepted}=await test.step("Replace the data in the sealed peer tab",async()=>{
  const before=await localData(page),other=await context.newPage(),otherCapture=await sealGuestJourney(other);await installLifecycleSources(other);
  if(replacement==="import"){
    await other.goto("/guest/settings");await other.getByLabel("Import guest backup").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(serializeGuestBackup(guestSnapshotFixture(),"2026-10-24T12:00:00.000Z"))});
    await other.getByRole("button",{name:"Replace local data"}).click();await expect(other.getByText(/Backup imported/)).toBeVisible();
  }else{
    await other.goto("/guest/sources");await other.getByRole("button",{name:"Disconnect Canvas",exact:true}).click();await other.getByRole("button",{name:"Confirm disconnect Canvas"}).click();await expect(other.getByRole("region",{name:"Canvas",exact:true})).toBeFocused();
    await other.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics");await other.getByRole("button",{name:"Connect Canvas",exact:true}).click();await expect(other.getByRole("alert")).toHaveText("Another guest sync is already running.");expect((await localData(other)).connections).toEqual([]);
    // Disconnect invalidates membership, not another tab's run lease. Let the real
    // extension wait expire before retrying replacement; the old wire reply stays held.
    await page.clock.runFor(30001);await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();await connectCanvas(other);
  }
  const accepted=await localData(other),privateAccepted=await privateData(other);expect(accepted.connections[0].id).not.toBe(before.connections[0].id);
  return {otherCapture,accepted,privateAccepted};
  },{timeout:phaseTimeout});
  await test.step("Release the late result and verify accepted data",async()=>{
  await releaseCanvasStatus(page);await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();await expect.poll(async()=>(await localData(page)).connections[0]?.id).toBe(accepted.connections[0].id);
  expect(await localData(page)).toEqual(accepted);expect(await privateData(page)).toEqual(privateAccepted);expect(capture.forbidden).toEqual([]);expect(otherCapture.forbidden).toEqual([]);
  // The supplied context fixture disposes both tabs and reports teardown failures.
  },{timeout:phaseTimeout});
});

test("empty selected courses and a rate-limited read retain coursework and permit an explicit retry",async({page})=>{
  const capture=await sealGuestJourney(page);await page.goto("/guest/sources");await page.getByLabel("Ed API token").fill("fixture-guest-ed-token-never-echo");await page.getByRole("button",{name:"Connect Ed",exact:true}).click();await finishGuestVerification(page);await expect(page.getByLabel("CSE 331")).not.toBeChecked();
  await page.getByRole("button",{name:"Sync Ed",exact:true}).click();await expect(page.getByText("No enabled courses are available to sync.")).toBeVisible();expect(capture.requests.filter(r=>r.path.endsWith("/lessons"))).toEqual([]);
  await page.getByLabel("CSE 331").check();await page.getByRole("button",{name:"Save Ed courses"}).click();await page.getByRole("button",{name:"Sync Ed",exact:true}).click();await expect(page.getByText("Ed sync complete",{exact:true})).toBeVisible();const before=await localData(page);
  await page.route("**/api/guest/sources/ed/lessons",route=>route.fulfill({status:429,json:{ok:false,code:"RATE_LIMITED",message:"Too many requests. Try again later."}}));
  await page.getByRole("button",{name:"Sync Ed",exact:true}).click();await expect(page.getByText("Too many requests. Try again later.")).toBeVisible();expect((await localData(page)).assignments).toEqual(before.assignments);
  await page.unroute("**/api/guest/sources/ed/lessons");await page.getByRole("button",{name:"Sync Ed",exact:true}).click();await expect(page.getByText("Ed sync complete",{exact:true})).toBeVisible();expect(capture.forbidden).toEqual([]);
});

for(const mode of ["unavailable","older"] as const)test(`missing or older extension response preserves coursework: ${mode}`,async({page})=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);
  await page.clock.install();await page.evaluate(mode=>sessionStorage.setItem("guest-status-mode",mode),mode);await page.getByRole("button",{name:"Sync Canvas",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem("guest-status-request"))).not.toBeNull();const before=await localData(page);expect(before.assignments).toHaveLength(10);await page.clock.runFor(30001);
  await expect(page.getByText("The Kairos extension did not respond in time.")).toBeVisible();expect((await localData(page)).assignments).toEqual(before.assignments);expect((await localData(page)).statuses).toEqual([]);expect(capture.forbidden).toEqual([]);
});
