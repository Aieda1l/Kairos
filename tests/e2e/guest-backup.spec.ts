import {expect,test,type Page} from "@playwright/test";
import {guestSnapshotFixture,guestUuid} from "../helpers/guest-fixtures";
import {serializeGuestBackup} from "../../src/lib/guest/backup";
import {sealGuestJourney} from "./fixtures/guest-session";

const backup=serializeGuestBackup(guestSnapshotFixture(),"2026-10-24T12:00:00.000Z");
async function importBackup(page:Page,text=backup){
  await page.goto("/guest/settings");await page.getByLabel("Import guest backup").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(text)});await page.getByRole("button",{name:"Replace local data"}).click();await expect(page.getByText(/Backup imported/)).toBeVisible();
}
async function localData(page:Page){return page.evaluate(async()=>{
  const path="/src/lib/guest/store.ts";const {openGuestStore}=await import(/* @vite-ignore */ path) as typeof import("../../src/lib/guest/store");const store=await openGuestStore();try{return await store.read();}finally{store.close();}
});}
async function privateData(page:Page){return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("kairos-guest-v1");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{const names=Array.from(db.objectStoreNames),tx=db.transaction(names,"readonly"),result:Record<string,unknown[]>={};for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{result[name]=request.result;};}tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
});}
test("imports, exports and clears local data with confirmation, privately and offline",async({page,context})=>{
  const capture=await sealGuestJourney(page);await page.setViewportSize({width:320,height:900});await page.goto("/guest/settings");
  await page.getByRole("button",{name:"Toggle theme"}).click();const savedTheme=await page.evaluate(()=>localStorage.getItem("theme"));expect(savedTheme).not.toBeNull();
  await page.getByLabel("Import guest backup").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(backup)});
  await expect(page.getByText(/1 source.*0 courses.*1 assignment/i)).toBeVisible();await page.getByRole("button",{name:"Replace local data"}).click();await expect(page.getByText(/Backup imported/)).toBeVisible();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export guest backup"}).click();const stream=await (await download).createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);const exported=JSON.parse(Buffer.concat(chunks).toString("utf8"));expect(exported.data).not.toHaveProperty("credentials");expect(Object.keys(exported.data).sort()).toEqual(["assignments","connections","courses","preferences","statuses","syncStates"]);
  await page.getByLabel("Display timezone").fill("Asia/Tokyo");await page.getByRole("button",{name:"Save timezone"}).click();await expect(page.getByText("Timezone saved in this browser.")).toBeVisible();await page.reload();await expect(page.getByLabel("Display timezone")).toHaveValue("Asia/Tokyo");
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByRole("button",{name:"View Homework details"})).toBeVisible();await page.getByRole("link",{name:"Settings",exact:true}).click();
  await page.getByLabel("Import guest backup").setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from('{"schemaVersion":2}')});await expect(page.getByRole("alert")).toContainText("unsupported");
  await page.getByRole("button",{name:"Clear guest data"}).click();await page.getByRole("button",{name:"Cancel clear"}).click();await expect(page.getByRole("button",{name:"Confirm clear guest data"})).toHaveCount(0);
  await page.route("**/api/guest/session/end",route=>route.abort());await page.getByRole("button",{name:"Clear guest data"}).click();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("theme"))).toBe(savedTheme);
  for(const theme of ["light","dark"]){await page.evaluate(theme=>document.documentElement.classList.toggle("dark",theme==="dark"),theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByText("0 assignments",{exact:true})).toBeVisible();expect(capture.forbidden).toEqual([]);expect((await context.cookies()).some(c=>/authjs|session-token/.test(c.name))).toBe(false);
});
test("same-source reentry and forgetting keep rows; replacement remaps references and removes private state",async({page})=>{
  const capture=await sealGuestJourney(page);await importBackup(page);const before=await localData(page);
  await page.route("**/api/guest/sources/canvas/feed",route=>route.fulfill({json:{ok:true,schemaVersion:1,requestId:route.request().postDataJSON().requestId,checkedAt:new Date().toISOString(),assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}}}));
  await page.getByRole("link",{name:"Sources",exact:true}).click();await page.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/private-fixture.ics");await page.getByLabel("Remember Canvas credential on this device").check();await page.getByRole("button",{name:"Update Canvas credential"}).click();
  await expect(page.getByText(/A credential is available/)).toBeVisible();expect((await privateData(page)).credentials).toHaveLength(1);expect((await localData(page)).assignments).toEqual(before.assignments);
  await page.getByRole("link",{name:"Settings",exact:true}).click();const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export guest backup"}).click();const stream=await (await download).createReadStream(),chunks=[];for await(const chunk of stream!)chunks.push(chunk);const exported=Buffer.concat(chunks).toString("utf8");expect(exported).not.toContain("private-fixture");expect(JSON.parse(exported).data).not.toHaveProperty("credentials");await page.getByRole("link",{name:"Sources",exact:true}).click();
  await page.getByRole("button",{name:"Forget Canvas credential"}).click();await expect(page.getByText(/Re-enter your credential/)).toBeVisible();expect((await privateData(page)).credentials).toEqual([]);expect((await localData(page)).assignments).toEqual(before.assignments);
  await page.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/memory-fixture.ics");await page.getByRole("button",{name:"Update Canvas credential"}).click();await expect(page.getByText(/A credential is available/)).toBeVisible();await page.reload();await expect(page.getByText(/Re-enter your credential/)).toBeVisible();expect((await localData(page)).assignments).toEqual(before.assignments);
  await page.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/remembered-fixture.ics");await page.getByLabel("Remember Canvas credential on this device").check();await page.getByRole("button",{name:"Update Canvas credential"}).click();await expect(page.getByText(/A credential is available/)).toBeVisible();
  await importBackup(page);const after=await localData(page),privateAfter=await privateData(page);expect(after.datasetId).not.toBe(before.datasetId);expect(after.connections[0].id).not.toBe(before.connections[0].id);expect(after.assignments[0].sourceConnectionId).toBe(after.connections[0].id);expect(after.statuses[0].assignmentId).toBe(after.assignments[0].id);expect(privateAfter.credentials).toEqual([]);expect(privateAfter.requests).toEqual([]);expect(privateAfter.metadata[0]).toMatchObject({lease:null});expect(capture.forbidden).toEqual([]);
});
test("source deletion is confirmed and removes only that source",async({page})=>{
  const capture=await sealGuestJourney(page),saved=guestSnapshotFixture();saved.connections.push({...saved.connections[0],id:guestUuid(20),kind:"ed"});saved.courses.push({id:guestUuid(21),sourceConnectionId:guestUuid(20),externalCourseId:"5",shortName:"Ed course",fullName:"Ed course",term:null,year:null,enabled:true,firstSeenAt:"2026-10-24T12:00:00.000Z",lastSeenAt:"2026-10-24T12:00:00.000Z"});saved.assignments.push({...saved.assignments[0],id:guestUuid(22),sourceConnectionId:guestUuid(20),source:"ed",courseId:"5",sourceUrl:null});
  await importBackup(page,serializeGuestBackup(saved,"2026-10-24T12:00:00.000Z"));const before=await localData(page);await page.getByRole("link",{name:"Sources",exact:true}).click();await page.getByRole("button",{name:"Disconnect Canvas",exact:true}).click();expect((await localData(page)).assignments).toEqual(before.assignments);await page.getByRole("button",{name:"Cancel disconnect"}).click();await page.getByRole("button",{name:"Disconnect Canvas",exact:true}).click();await page.getByRole("button",{name:"Confirm disconnect Canvas"}).click();await expect(page.getByRole("button",{name:"Connect Canvas",exact:true})).toBeVisible();const after=await localData(page);expect(after.assignments).toEqual(before.assignments.filter(a=>a.source==="ed"));expect(after.courses).toEqual(before.courses);expect(capture.forbidden).toEqual([]);
});
test("native storage abort keeps every accepted store on import and reset, then permits retry",async({page})=>{
  const capture=await sealGuestJourney(page);await importBackup(page);const before=await privateData(page);
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="metadata"){IDBObjectStore.prototype.put=original;throw new DOMException("fixture quota","QuotaExceededError");}return original.apply(this,args);};});
  await page.getByLabel("Import guest backup").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(backup)});await page.getByRole("button",{name:"Replace local data"}).click();await expect(page.getByRole("alert")).toContainText("could not be changed");expect(await privateData(page)).toEqual(before);await expect(page.getByRole("button",{name:"Export guest backup"})).toBeEnabled();
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="metadata"){IDBObjectStore.prototype.put=original;throw new DOMException("fixture quota","QuotaExceededError");}return original.apply(this,args);};});
  await page.getByRole("button",{name:"Clear guest data",exact:true}).click();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByRole("alert")).toContainText("could not be changed");expect(await privateData(page)).toEqual(before);
  await page.getByRole("button",{name:"Clear guest data",exact:true}).click();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();expect((await localData(page)).assignments).toEqual([]);expect(capture.forbidden).toEqual([]);
});
for(const corrupt of ["graph","identity"] as const)test(`recovery is fenced by readable metadata: ${corrupt}`,async({page})=>{
  const capture=await sealGuestJourney(page);await importBackup(page);
  await page.evaluate(async corrupt=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const q=indexedDB.open("kairos-guest-v1");q.onsuccess=()=>resolve(q.result);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction([corrupt==="graph"?"assignments":"metadata"],"readwrite");if(corrupt==="graph"){const store=tx.objectStore("assignments"),q=store.getAll();q.onsuccess=()=>store.put({...q.result[0],title:123});}else tx.objectStore("metadata").put({datasetId:"broken"},"identity");tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  },corrupt);
  await page.reload();
  if(corrupt==="graph"){
    await page.getByRole("button",{name:"Clear guest data",exact:true}).click();await expect(page.getByText(/counts are unavailable/)).toBeVisible();await page.getByRole("button",{name:"Confirm clear guest data"}).click();await expect(page.getByText(/Guest data cleared/)).toBeVisible();expect((await localData(page)).assignments).toEqual([]);
  }else{await expect(page.getByText(/Browser storage identity could not be read/)).toBeVisible();await expect(page.getByRole("button",{name:"Clear guest data",exact:true})).toHaveCount(0);expect((await privateData(page)).assignments).toHaveLength(1);}
  expect(capture.forbidden).toEqual([]);
});
