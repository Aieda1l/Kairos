import {expect,test,type BrowserContext} from "@playwright/test";
import {waitForAppHydration} from "./helpers";

type FixtureUser="alice"|"bob";

type SeededState={
  sourceId:string;
  assignmentId:string;
  calendarId:string;
  assignmentTitle:string;
  calendarAccount:string;
};

async function prepareUser(context:BrowserContext,user:FixtureUser):Promise<SeededState>{
  const session=await context.request.post("/api/test-fixtures/session",{
    data:{user},
  });
  expect(session.ok()).toBe(true);
  const authCookie=(await context.cookies()).find(
    cookie=>cookie.name==="authjs.session-token",
  );
  if(!authCookie)throw new Error("fixture session cookie was not stored");
  const resolvedSession=await context.request.get("/api/auth/session");
  const resolvedBody=await resolvedSession.text();
  if(!resolvedSession.ok()||!resolvedBody.includes(`"${user}"`)){
    throw new Error(
      `fixture auth session did not resolve (${resolvedSession.status()}): ${resolvedBody}`,
    );
  }
  const protectedCheck=await context.request.get("/api/settings/calendar");
  if(protectedCheck.status()===401){
    throw new Error("fixture auth session was rejected by a protected app API");
  }

  const reset=await context.request.post("/api/test-fixtures/reset");
  if(!reset.ok()){
    throw new Error(`fixture reset failed (${reset.status()}): ${await reset.text()}`);
  }

  const seed=await context.request.post("/api/test-fixtures/tenant-state");
  if(!seed.ok()){
    throw new Error(`fixture seed failed (${seed.status()}): ${await seed.text()}`);
  }
  return seed.json();
}

test("multi-user isolation protects hosted state and extension results",async({browser})=>{
  const aliceContext=await browser.newContext({baseURL:"http://127.0.0.1:3000"});
  const bobContext=await browser.newContext({baseURL:"http://127.0.0.1:3000"});

  try{
    const [alice,bob]=await Promise.all([
      prepareUser(aliceContext,"alice"),
      prepareUser(bobContext,"bob"),
    ]);
    const alicePage=await aliceContext.newPage();
    const bobPage=await bobContext.newPage();

    await alicePage.goto("/upcoming");
    await waitForAppHydration(alicePage);
    await expect(alicePage.getByText(alice.assignmentTitle).first()).toBeVisible();
    await expect(alicePage.getByText(bob.assignmentTitle)).toHaveCount(0);

    await bobPage.goto("/upcoming");
    await waitForAppHydration(bobPage);
    await expect(bobPage.getByText(bob.assignmentTitle).first()).toBeVisible();
    await expect(bobPage.getByText(alice.assignmentTitle)).toHaveCount(0);

    await alicePage.goto("/sources");
    await waitForAppHydration(alicePage);
    const aliceCanvas=alicePage.locator("section").filter({
      has:alicePage.getByRole("heading",{name:"Canvas",exact:true}),
    });
    const aliceEd=alicePage.locator("section").filter({
      has:alicePage.getByRole("heading",{name:"Ed",exact:true}),
    });
    await expect(aliceCanvas.getByText(/Connected/)).toBeVisible();
    await expect(aliceEd.getByText(/Not connected/)).toBeVisible();
    await expect(alicePage.getByLabel("Apple Account email")).toHaveValue(alice.calendarAccount);

    await bobPage.goto("/sources");
    await waitForAppHydration(bobPage);
    const bobCanvas=bobPage.locator("section").filter({
      has:bobPage.getByRole("heading",{name:"Canvas",exact:true}),
    });
    const bobEd=bobPage.locator("section").filter({
      has:bobPage.getByRole("heading",{name:"Ed",exact:true}),
    });
    await expect(bobCanvas.getByText(/Not connected/)).toBeVisible();
    await expect(bobEd.getByText(/Connected/)).toBeVisible();
    await expect(bobPage.getByLabel("Apple Account email")).toHaveValue(bob.calendarAccount);

    const crossUser=await bobContext.request.post(
      `/api/calendars/${alice.calendarId}/disconnect`,
    );
    expect(crossUser.status()).toBe(404);

    const start=await aliceContext.request.post(
      "/api/sources/canvas/submission-status/start",
    );
    expect(start.ok()).toBe(true);
    const started=await start.json() as {
      requestId:string;
      assignments:Array<{
        assignmentLocalId:string;
        courseId:string;
        assignmentId:string;
      }>;
    };
    expect(started.assignments).toHaveLength(1);
    expect(started.assignments[0]?.assignmentLocalId).toBe(alice.assignmentId);

    const complete=await aliceContext.request.post(
      "/api/sources/canvas/submission-status/complete",
      {
        data:{
          requestId:started.requestId,
          results:started.assignments.map(item=>({
            ...item,
            state:"submitted",
            isLate:false,
            isMissing:false,
            submittedAt:"2026-10-07T08:00:00.000Z",
            checkedAt:"2026-10-07T08:05:00.000Z",
            extractorVersion:"multi-user-e2e-v1",
          })),
        },
      },
    );
    expect(complete.ok()).toBe(true);

    await alicePage.goto("/assignments");
    await waitForAppHydration(alicePage);
    await expect(alicePage.getByText(alice.assignmentTitle).first()).toBeVisible();
    await alicePage.getByRole("button",{
      name:`View ${alice.assignmentTitle} details`,
    }).first().click();
    await expect(alicePage.getByRole("dialog")).toContainText("Submitted");

    await bobPage.goto("/assignments");
    await waitForAppHydration(bobPage);
    await expect(bobPage.getByText(alice.assignmentTitle)).toHaveCount(0);
    await expect(bobPage.getByText(bob.assignmentTitle).first()).toBeVisible();

    const signOut=await aliceContext.request.delete("/api/test-fixtures/session");
    expect(signOut.ok()).toBe(true);
    await alicePage.goto("/upcoming");
    await expect(alicePage).toHaveURL(/\/sign-in\?returnTo=%2Fupcoming|\/sign-in\?returnTo=\/upcoming/);
  }finally{
    await Promise.all([aliceContext.close(),bobContext.close()]);
  }
});
