import { expect, test } from "@playwright/test";
import {prepareFixtureUser,waitForAppHydration} from "./helpers";

test("connect Canvas, sync once, and see one assignment in every view",async({page,context})=>{
  await prepareFixtureUser(context);

  const secret="fixture-secret-never-echo";
  const responseBodies:string[]=[];
  page.on("response",async response=>{
    if(response.url().includes("/api/sources/canvas/")){
      try{responseBodies.push(await response.text());}catch{}
    }
  });

  await page.goto("/sources");
  await waitForAppHydration(page);
  const canvasCard=page.locator("section").filter({has:page.getByRole("heading",{name:"Canvas",exact:true})});
  const feedUrl=`http://127.0.0.1:3000/api/test-fixtures/canvas-feed?token=${secret}`;
  await canvasCard.getByLabel("Canvas calendar feed URL").fill(feedUrl);
  await canvasCard.getByRole("button",{name:"Test connection"}).click();
  await expect(page.getByText(/1 assignments found/)).toBeVisible();
  await canvasCard.getByRole("button",{name:"Connect Canvas"}).click();
  await page.waitForURL("**/upcoming");
  await expect(page.getByText("Fixture Homework").first()).toBeVisible();

  expect(await page.locator("body").innerText()).not.toContain(secret);
  expect(await page.content()).not.toContain(secret);
  const renderedSources=await context.request.get("/sources");
  expect(renderedSources.ok()).toBe(true);
  expect(await renderedSources.text()).not.toContain(secret);
  expect(responseBodies.join("\n")).not.toContain(secret);

  await page.getByRole("link",{name:"Calendar"}).click();
  await expect(page.getByRole("button",{name:/Fixture Homework/})).toBeVisible();

  await page.getByRole("link",{name:"All Assignments"}).click();
  await expect(page.locator("table").getByText("Fixture Homework")).toHaveCount(1);

  await page.getByRole("link",{name:"Sources"}).click();
  await expect(page.getByText(/Connected/)).toBeVisible();
  const syncCompleted=page.waitForResponse(response=>
    response.url().endsWith("/api/sources/canvas/sync")&&response.request().method()==="POST",
  );
  await page.getByRole("button",{name:"Sync Now"}).click();
  expect((await syncCompleted).ok()).toBe(true);
  await expect(page.getByRole("button",{name:"Sync Now"})).toBeEnabled();

  await page.getByRole("link",{name:"All Assignments"}).click();
  await expect(page.locator("table").getByText("Fixture Homework")).toHaveCount(1);

  await page.setViewportSize({width:320,height:800});
  const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(noOverflow).toBe(true);

  await page.keyboard.press("Tab");
  expect(await page.evaluate(()=>["A","BUTTON","INPUT","SELECT"].includes(document.activeElement?.tagName??""))).toBe(true);
});
