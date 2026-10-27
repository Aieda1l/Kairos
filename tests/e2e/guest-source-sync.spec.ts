import {expect,test} from "@playwright/test";
import {finishGuestVerification,resetGuestAdmission,sealGuestJourney} from "./fixtures/guest-session";

test.beforeEach(async({context})=>{await resetGuestAdmission(context);});
test("connects feed and Ed without extension or account, verifies deliberately, and persists results",async({page,context})=>{
  const capture=await sealGuestJourney(page);await page.setViewportSize({width:320,height:900});
  await page.goto("/guest/sources");
  const feed=page.getByLabel("Canvas calendar feed URL");await feed.fill("https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics");
  await page.getByRole("button",{name:"Connect Canvas"}).click();
  await expect(page.getByRole("button",{name:"Verify and continue"})).toBeDisabled();expect(capture.requests.filter(r=>r.path==="/api/guest/session")).toHaveLength(0);
  await finishGuestVerification(page);await expect(feed).toHaveValue("");await expect(page.getByRole("button",{name:"Disconnect Canvas"})).toBeVisible();
  const token=page.getByLabel("Ed API token");await token.fill("fixture-guest-ed-token-never-echo");await page.getByRole("button",{name:"Connect Ed"}).click();await expect(token).toHaveValue("");
  await expect(page.getByLabel("CSE 331")).not.toBeChecked();await page.getByLabel("CSE 331").check();await page.getByRole("button",{name:"Save Ed courses"}).click();
  await page.getByRole("button",{name:"Sync Ed",exact:true}).click();await expect(page.getByText(/Ed sync complete/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await page.content()).not.toContain("fixture-guest-ed-token-never-echo");
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByRole("button",{name:"View Ed Dated Lesson details",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"View Fixture Homework details",exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole("button",{name:"View Ed Dated Lesson details",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"View Fixture Homework details",exact:true})).toBeVisible();
  expect(capture.forbidden).toEqual([]);expect((await context.cookies()).some(c=>c.name.includes("authjs")||c.name.includes("session-token"))).toBe(false);
  const ids=capture.requests.filter(r=>r.path.endsWith("/feed")).map(r=>JSON.parse(r.body!).requestId);expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);
});
test("Gradescope uses v1 discovery, explicit course selection, current status and reload persistence",async({page})=>{
  const capture=await sealGuestJourney(page);
  await page.addInitScript(()=>{
    window.addEventListener("message",event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!=="kairos-page")return;
      const data=event.data,payload=data.payload;
      if(data.type==="GRADESCOPE_SYNC_ASSIGNMENTS")sessionStorage.setItem("guest-gs-syncs",String(Number(sessionStorage.getItem("guest-gs-syncs")??0)+1));
      if(data.type==="PING")window.postMessage({source:"kairos-extension",type:"PONG",protocolVersion:1,requestId:data.requestId,extensionVersion:"fixture-v1",canvasTabDetected:false,gradescopeTabDetected:true},location.origin);
      if(data.type==="GRADESCOPE_DISCOVER_COURSES")window.postMessage({source:"kairos-extension",type:"GRADESCOPE_DISCOVER_COURSES_RESULT",protocolVersion:1,requestId:data.requestId,payload:{protocolVersion:1,requestId:payload.requestId,courses:[{courseId:"123",shortName:"GS 123",fullName:"Guest Gradescope",term:null,year:null}],errorCode:null}},location.origin);
      if(data.type==="GRADESCOPE_SYNC_ASSIGNMENTS")window.postMessage({source:"kairos-extension",type:"GRADESCOPE_SYNC_ASSIGNMENTS_RESULT",protocolVersion:1,requestId:data.requestId,payload:{protocolVersion:1,requestId:payload.requestId,courses:payload.courseIds.map((courseId:string)=>({courseId,checkedAt:new Date().toISOString(),errorCode:null,assignments:[{courseId,assignmentId:"10",title:"Guest Gradescope Homework",releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:"Submitted",state:"submitted",isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,gradeDisplay:null,checkedAt:new Date().toISOString(),extractorVersion:"fixture-v1"}]})),errorCode:null}},location.origin);
    });
  });
  await page.goto("/guest/sources");await page.getByRole("button",{name:"Connect Gradescope"}).click();await expect(page.getByLabel("GS 123")).not.toBeChecked();await page.getByLabel("GS 123").check();await page.getByRole("button",{name:"Save Gradescope courses"}).click();
  await page.getByRole("button",{name:"Sync Gradescope",exact:true}).click();await expect(page.getByText(/Gradescope sync complete/)).toBeVisible();
  await page.getByRole("link",{name:"Assignments",exact:true}).click();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();await page.reload();await expect(page.getByRole("button",{name:"View Guest Gradescope Homework details",exact:true})).toBeVisible();expect(capture.forbidden).toEqual([]);
  expect(await page.evaluate(()=>sessionStorage.getItem("guest-gs-syncs"))).toBe("1");
});
test("current 9 of 10 Canvas status stays partial beside successful Ed, with no account prompt",async({page})=>{
  const capture=await sealGuestJourney(page);
  await page.route("**/api/guest/sources/canvas/feed",async route=>{
    const request=route.request().postDataJSON();
    await route.fulfill({json:{ok:true,schemaVersion:1,requestId:request.requestId,checkedAt:new Date().toISOString(),assignments:Array.from({length:10},(_,i)=>({source:"canvas",externalId:String(i+1),courseId:"12",courseName:"Canvas Test",title:`Canvas Homework ${i+1}`,releaseAt:null,dueAt:null,lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:`https://canvas.uw.edu/courses/12/assignments/${i+1}`,sourceUpdatedAt:null})),report:{skippedCount:0,malformedCount:0,partial:false}}});
  });
  await page.addInitScript(()=>{
    window.addEventListener("message",event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!=="kairos-page")return;
      const data=event.data;
      if(data.type==="PING")window.postMessage({source:"kairos-extension",type:"PONG",protocolVersion:1,requestId:data.requestId,extensionVersion:"fixture-v1",canvasTabDetected:true,gradescopeTabDetected:false},location.origin);
      if(data.type==="SYNC_SUBMISSION_STATUS")window.postMessage({source:"kairos-extension",type:"SYNC_SUBMISSION_STATUS_RESULT",protocolVersion:1,requestId:data.requestId,payload:{protocolVersion:1,requestId:data.payload.requestId,results:data.payload.assignments.map((a:{assignmentLocalId:string;courseId:string;assignmentId:string},i:number)=>({...a,state:"not_submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:new Date().toISOString(),extractorVersion:"fixture-v1",...(i===9?{errorCode:"CANVAS_SIGNED_OUT"}:{})})),errorCode:null}},location.origin);
    });
  });
  await page.goto("/guest/sources");await page.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics");await page.getByRole("button",{name:"Connect Canvas"}).click();await expect(page.getByRole("button",{name:"Disconnect Canvas"})).toBeVisible();
  await page.getByLabel("Ed API token").fill("fixture-guest-ed-token-never-echo");await page.getByRole("button",{name:"Connect Ed"}).click();await finishGuestVerification(page);await expect(page.getByLabel("CSE 331")).not.toBeChecked();await page.getByLabel("CSE 331").check();await page.getByRole("button",{name:"Save Ed courses"}).click();
  await page.getByRole("button",{name:"Sync sources",exact:true}).click();await expect(page.getByText(/9 of 10 statuses updated/)).toBeVisible();await expect(page.getByText("Ed sync complete",{exact:true})).toBeVisible();await expect(page.getByText("Canvas status partially updated")).toBeVisible();await expect(page.getByText(/sign in to Kairos/i)).toHaveCount(0);expect(capture.forbidden).toEqual([]);
});
