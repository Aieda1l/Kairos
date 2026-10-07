import {expect,test} from "@playwright/test";
import {waitForAppHydration} from "./helpers";

type FixtureEvent={
  id:string;
  summary:string;
  startsAt:string;
  endsAt:string;
};

type FixtureState={
  mode:string;
  calendarExists:boolean;
  events:FixtureEvent[];
};

test("publishes Canvas deadlines to iCloud idempotently without exposing calendar credentials",async({page,request})=>{
  const reset=await request.post("/api/test-fixtures/reset");
  expect(reset.ok()).toBe(true);

  const canvasSecret="fixture-secret-never-echo";
  const appPassword="fixture-app-password-never-echo";
  const username="student@example.com";
  const authorizationValue="Basic "+Buffer.from(`${username}:${appPassword}`).toString("base64");
  const responseBodies:string[]=[];

  page.on("response",async response=>{
    if(response.url().includes("/api/calendars/")){
      try{responseBodies.push(await response.text());}catch{}
    }
  });

  await page.goto("/sources");
  await waitForAppHydration(page);
  const canvasCard=page.locator("section").filter({
    has:page.getByRole("heading",{name:"Canvas",exact:true}),
  });
  const feedUrl=`http://127.0.0.1:3000/api/test-fixtures/canvas-feed?token=${canvasSecret}`;
  await canvasCard.getByLabel("Canvas calendar feed URL").fill(feedUrl);
  await canvasCard.getByRole("button",{name:"Test connection"}).click();
  await expect(page.getByText(/1 assignments found/)).toBeVisible();
  await canvasCard.getByRole("button",{name:"Connect Canvas"}).click();
  await page.waitForURL("**/upcoming");
  await expect(page.getByText("Fixture Homework").first()).toBeVisible();

  await page.getByRole("link",{name:"Sources"}).click();
  const icloudCard=page.locator("section").filter({
    has:page.getByRole("heading",{name:"Apple iCloud Calendar",exact:true}),
  });
  const usernameInput=icloudCard.getByLabel("Apple Account email");
  const secretInput=icloudCard.getByLabel("Apple app-specific password");
  await usernameInput.fill(username);
  await secretInput.fill(appPassword);
  await icloudCard.getByRole("button",{name:"Test iCloud"}).click();
  await expect(page.getByText(/credentials work/i)).toBeVisible();
  await icloudCard.getByRole("button",{name:"Connect iCloud"}).click();
  await expect(page.getByText(/iCloud Calendar connected/i)).toBeVisible();
  await expect(secretInput).toHaveValue("");
  expect(await page.locator("body").innerText()).not.toContain(appPassword);

  await icloudCard.getByRole("button",{name:"Sync Apple iCloud Calendar"}).click();
  await expect(page.getByText(/Apple iCloud Calendar synchronized/i)).toBeVisible();

  const readState=async():Promise<FixtureState>=>{
    const response=await request.get("/api/test-fixtures/calendar-state");
    expect(response.ok()).toBe(true);
    return response.json();
  };

  const first=await readState();
  expect(first.calendarExists).toBe(true);
  expect(first.events).toHaveLength(1);
  expect(first.events[0]).toMatchObject({
    summary:"[CSE 999] Fixture Homework",
    startsAt:"2026-10-09T06:59:00.000Z",
    endsAt:"2026-10-09T07:14:00.000Z",
  });
  const remoteEventId=first.events[0]!.id;

  await icloudCard.getByRole("button",{name:"Sync Apple iCloud Calendar"}).click();
  await expect.poll(async()=> (await readState()).events.length).toBe(1);
  expect((await readState()).events[0]!.id).toBe(remoteEventId);

  const changedDueAt="2026-10-10T06:59:00.000Z";
  const mutate=await request.post("/api/test-fixtures/assignment-due-date",{
    data:{dueAt:changedDueAt},
  });
  expect(mutate.ok()).toBe(true);
  await icloudCard.getByRole("button",{name:"Sync Apple iCloud Calendar"}).click();
  await expect.poll(async()=> (await readState()).events[0]?.startsAt).toBe(changedDueAt);
  const moved=await readState();
  expect(moved.events).toHaveLength(1);
  expect(moved.events[0]!.id).toBe(remoteEventId);
  expect(moved.events[0]!.endsAt).toBe("2026-10-10T07:14:00.000Z");

  const removeRemote=await request.post("/api/test-fixtures/calendar-mode",{
    data:{action:"delete-event",eventId:remoteEventId},
  });
  expect(removeRemote.ok()).toBe(true);
  expect((await readState()).events).toHaveLength(0);
  await icloudCard.getByRole("button",{name:"Sync Apple iCloud Calendar"}).click();
  await expect.poll(async()=> (await readState()).events.length).toBe(1);
  const recreated=await readState();
  expect(recreated.events).toHaveLength(1);
  expect(recreated.events[0]!.id).toBe(remoteEventId);

  const failProvider=await request.post("/api/test-fixtures/calendar-mode",{
    data:{mode:"network-error"},
  });
  expect(failProvider.ok()).toBe(true);

  await page.getByRole("link",{name:"Upcoming"}).click();
  await page.getByRole("button",{name:"Sync All"}).click();
  await expect(page.getByText(/Calendar destinations: Apple iCloud Calendar could not be synchronized/i)).toBeVisible();
  await expect(page.getByText("Fixture Homework").first()).toBeVisible();

  const rendered=await page.locator("body").innerText();
  const responses=responseBodies.join("\n");
  for(const secret of [
    appPassword,
    authorizationValue,
    "fixture-oauth-token-never-echo",
    "fixture-dav-private-body-never-echo",
  ]){
    expect(rendered).not.toContain(secret);
    expect(responses).not.toContain(secret);
  }
});
