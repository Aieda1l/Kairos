import {expect,test} from "@playwright/test";
import {serializeGuestBackup} from "../../src/lib/guest/backup";
import {guestSnapshotFixture} from "../helpers/guest-fixtures";
import {finishGuestVerification,resetGuestAdmission,sealGuestJourney} from "./fixtures/guest-session";
import {connectCanvas,holdCanvasStatus,installLifecycleSources,localData,privateData,releaseCanvasStatus} from "./fixtures/guest-lifecycle";

test.beforeEach(async({context})=>{await resetGuestAdmission(context);});
test("complete guest flow survives reload and rejects a late reset result",async({page,context})=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);
  await page.getByRole("button",{name:"Connect Gradescope",exact:true}).click();await page.getByLabel("GS 123").check();await page.getByRole("button",{name:"Save Gradescope courses"}).click();
  await page.getByLabel("Ed API token").fill("fixture-guest-ed-token-never-echo");await page.getByLabel("Remember Ed credential on this device").check();await page.getByRole("button",{name:"Connect Ed",exact:true}).click();await finishGuestVerification(page);
  await page.getByLabel("CSE 331").check();await page.getByRole("button",{name:"Save Ed courses"}).click();
  await page.getByRole("button",{name:"Sync sources",exact:true}).click();await expect(page.getByText(/9 of 10/)).toBeVisible();await expect(page.getByText("Ed sync complete",{exact:true})).toBeVisible();await expect(page.getByText("Gradescope sync complete",{exact:true})).toBeVisible();
  const saved=await localData(page);expect(saved.assignments.filter(a=>a.source==="canvas")).toHaveLength(10);expect(saved.assignments.some(a=>a.source==="ed")).toBe(true);expect(saved.assignments.some(a=>a.source==="gradescope")).toBe(true);expect(saved.statuses).toHaveLength(10);
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();await page.reload();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"View Ed Dated Lesson details",exact:true})).toBeVisible();
  expect((await localData(page)).assignments).toEqual(saved.assignments);
  await page.getByRole("link",{name:"Sources",exact:true}).click();await holdCanvasStatus(page);
  await page.getByRole("link",{name:"Settings",exact:true}).click();await page.getByRole("button",{name:"Clear guest data",exact:true}).click();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();
  const afterReset=await localData(page),privateReset=await privateData(page);expect(afterReset.datasetId).not.toBe(saved.datasetId);
  await releaseCanvasStatus(page);await page.getByRole("link",{name:"Sources",exact:true}).click();await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();const afterLateResponse=await localData(page);expect(afterLateResponse.datasetId).toBe(afterReset.datasetId);expect(afterLateResponse).toEqual(afterReset);expect(await privateData(page)).toEqual(privateReset);
  expect(afterLateResponse.assignments).toEqual([]);expect(privateReset.credentials).toEqual([]);expect(privateReset.requests).toEqual([]);expect(privateReset.metadata[0]).toMatchObject({lease:null});
  const hostedSourceRequests=capture.forbidden;expect(hostedSourceRequests).toEqual([]);expect((await context.cookies()).some(c=>/authjs|session-token/.test(c.name))).toBe(false);
});

for(const replacement of ["import","source"] as const)test(`late source response cannot mutate confirmed ${replacement} replacement`,async({page,context})=>{
  const capture=await sealGuestJourney(page);await installLifecycleSources(page);await page.goto("/guest/sources");await connectCanvas(page);if(replacement==="source")await page.clock.install();await holdCanvasStatus(page);
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
  await releaseCanvasStatus(page);await expect(page.getByRole("button",{name:"Sync sources",exact:true})).toBeEnabled();await expect.poll(async()=>(await localData(page)).connections[0]?.id).toBe(accepted.connections[0].id);
  expect(await localData(page)).toEqual(accepted);expect(await privateData(page)).toEqual(privateAccepted);expect(capture.forbidden).toEqual([]);expect(otherCapture.forbidden).toEqual([]);await other.close();
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
