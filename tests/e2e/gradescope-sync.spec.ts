import { expect, test } from "@playwright/test";
import {prepareFixtureUser,waitForAppHydration} from "./helpers";

type GradescopeCapture={
  messages:string[];
  discoverRequests:number;
  syncRequests:number;
};

test("discovers and syncs Gradescope without exposing authenticated page data",async({page,context})=>{
  await prepareFixtureUser(context);

  const apiBodies:string[]=[];
  page.on("request",req=>{
    if(req.url().includes("/api/sources/gradescope/")){
      const body=req.postData();
      if(body)apiBodies.push(body);
    }
  });

  await page.addInitScript(()=>{
    const storageKey="kairos-gradescope-e2e-capture";
    let state:GradescopeCapture={messages:[],discoverRequests:0,syncRequests:0};
    try{
      const stored=window.sessionStorage.getItem(storageKey);
      if(stored)state=JSON.parse(stored) as GradescopeCapture;
    }catch{
      // A pre-navigation document can deny storage access; the real app origin will persist it.
    }
    const save=()=>{
      try{window.sessionStorage.setItem(storageKey,JSON.stringify(state));}catch{}
    };
    (window as Window&{__gradescopeCapture?:GradescopeCapture}).__gradescopeCapture=state;

    window.addEventListener("message",event=>{
      if(event.source!==window||event.origin!==window.location.origin)return;
      const data=event.data as Record<string,unknown>;
      if(data?.source!=="kairos-page")return;
      state.messages.push(JSON.stringify(data));
      save();

      if(data.type==="PING"){
        window.postMessage({
          source:"kairos-extension",
          type:"PONG",
          protocolVersion:1,
          requestId:data.requestId,
          extensionVersion:"0.3.0-e2e",
          canvasTabDetected:false,
          gradescopeTabDetected:true,
        },window.location.origin);
        return;
      }

      if(data.type==="GRADESCOPE_DISCOVER_COURSES"){
        state.discoverRequests++;
        save();
        const payload=data.payload as {requestId:string};
        window.postMessage({
          source:"kairos-extension",
          type:"GRADESCOPE_DISCOVER_COURSES_RESULT",
          protocolVersion:1,
          requestId:data.requestId,
          payload:{
            protocolVersion:1,
            requestId:payload.requestId,
            courses:[{
              courseId:"123",
              shortName:"CSE 331",
              fullName:"Software Design and Implementation",
              term:"Autumn",
              year:"2026",
            }],
            errorCode:null,
          },
        },window.location.origin);
        return;
      }

      if(data.type==="GRADESCOPE_SYNC_ASSIGNMENTS"){
        state.syncRequests++;
        save();
        const payload=data.payload as {requestId:string;courseIds:string[]};
        const checkedAt="2026-10-05T06:00:00.000Z";
        window.postMessage({
          source:"kairos-extension",
          type:"GRADESCOPE_SYNC_ASSIGNMENTS_RESULT",
          protocolVersion:1,
          requestId:data.requestId,
          payload:{
            protocolVersion:1,
            requestId:payload.requestId,
            courses:payload.courseIds.map(courseId=>({
              courseId,
              checkedAt,
              assignments:[{
                courseId,
                assignmentId:"457",
                title:"Gradescope Graded Homework",
                releaseAt:"2026-10-01T17:00:00.000Z",
                dueAt:"2026-10-08T06:59:00.000Z",
                lateDueAt:"2026-10-10T06:59:00.000Z",
                sourceStatusText:"8.5 / 10",
                state:"graded",
                isLate:false,
                isMissing:false,
                submittedAt:null,
                gradeScore:"8.5",
                gradeMax:"10",
                gradeDisplay:"8.5 / 10",
                checkedAt,
                extractorVersion:"gradescope-e2e-v1",
              },{
                courseId,
                assignmentId:"458",
                title:"Gradescope Open Homework",
                releaseAt:"2026-10-02T17:00:00.000Z",
                dueAt:"2026-10-09T06:59:00.000Z",
                lateDueAt:null,
                sourceStatusText:"No Submission",
                state:"not_submitted",
                isLate:false,
                isMissing:false,
                submittedAt:null,
                gradeScore:null,
                gradeMax:null,
                gradeDisplay:null,
                checkedAt,
                extractorVersion:"gradescope-e2e-v1",
              }],
              errorCode:null,
              parseDiagnosticCounts:[],
            })),
            errorCode:null,
          },
        },window.location.origin);
      }
    });
  });

  await page.goto("/sources");
  await waitForAppHydration(page);
  await page.getByRole("button",{name:"Discover courses"}).click();
  await expect(page.getByRole("checkbox",{name:/CSE 331/})).toBeVisible();

  await page.getByRole("checkbox",{name:/CSE 331/}).check();
  await page.getByRole("button",{name:"Save selection"}).click();

  await expect.poll(async()=>{
    return page.evaluate(()=>(
      window as Window&{__gradescopeCapture?:GradescopeCapture}
    ).__gradescopeCapture?.syncRequests??0);
  }).toBeGreaterThan(0);
  await expect(page.getByText(/Last successful/)).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("link",{name:"All Assignments"}).click();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByText("Gradescope Graded Homework").first()).toBeVisible();
  await expect(page.getByText("8.5 / 10").first()).toBeVisible();
  await expect(page.getByText("Gradescope Open Homework").first()).toBeVisible();

  await page.getByRole("button",{name:"View Gradescope Graded Homework details"}).first().click();
  await expect(page.getByRole("dialog")).toContainText("Late due");
  await expect(page.getByRole("dialog")).toContainText("Source status");
  await expect(page.getByRole("link",{name:"Open in Gradescope"})).toHaveAttribute(
    "href",
    "https://www.gradescope.com/courses/123/assignments/457",
  );
  await page.getByRole("button",{name:"Close dialog"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("link",{name:"Upcoming"}).click();
  await expect(page).toHaveURL(/\/upcoming$/);
  await expect(page.getByText("Gradescope Graded Homework")).toHaveCount(0);
  await expect(page.getByText("Gradescope Open Homework").first()).toBeVisible();

  const bridgeCapture=await page.evaluate(()=>(
    window as Window&{__gradescopeCapture?:GradescopeCapture}
  ).__gradescopeCapture??{messages:[],discoverRequests:0,syncRequests:0});

  expect(bridgeCapture.discoverRequests).toBeGreaterThan(0);
  expect(bridgeCapture.syncRequests).toBeGreaterThan(0);

  const captured=[...apiBodies,...bridgeCapture.messages].join("\n").toLowerCase();
  for(const forbidden of [
    "cookie",
    "authorization",
    "csrf",
    "password",
    "<html",
    "fixture-secret-never-echo",
  ]){
    expect(captured).not.toContain(forbidden);
  }
});
