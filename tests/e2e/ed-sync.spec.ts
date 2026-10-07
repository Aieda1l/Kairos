import { expect, test } from "@playwright/test";
import {waitForAppHydration} from "./helpers";

test("connects Ed, selects courses, and syncs dated and undated lessons without leaking the PAT",async({page,request})=>{
  const reset=await request.post("/api/test-fixtures/reset");
  expect(reset.ok()).toBe(true);

  const token="fixture-ed-token-never-echo";
  const apiRequests:Array<{url:string;body:string|null}>=[];
  const apiResponses:string[]=[];

  page.on("request",requestEvent=>{
    if(requestEvent.url().includes("/api/sources/ed/")){
      apiRequests.push({url:requestEvent.url(),body:requestEvent.postData()});
    }
  });
  page.on("response",async response=>{
    if(response.url().includes("/api/sources/ed/")){
      try{apiResponses.push(await response.text());}catch{}
    }
  });

  await page.goto("/sources");
  await waitForAppHydration(page);
  const edCard=page.locator("section").filter({has:page.getByRole("heading",{name:"Ed",exact:true})});
  const tokenInput=edCard.getByLabel("Ed API token");
  await tokenInput.fill(token);
  await edCard.getByRole("button",{name:"Test connection"}).click();
  await expect(page.getByText(/1 course found/i)).toBeVisible();

  await edCard.getByRole("button",{name:"Connect Ed"}).click();
  await expect(edCard.getByRole("checkbox",{name:/CSE 331/i})).toBeVisible();
  await expect(tokenInput).toHaveValue("");

  await edCard.getByRole("checkbox",{name:/CSE 331/i}).check();
  await edCard.getByRole("button",{name:"Save selection"}).click();
  await edCard.getByRole("button",{name:"Sync Ed"}).click();
  await expect(page.getByText(/Ed sync complete/i)).toBeVisible();

  await page.getByRole("link",{name:"All Assignments"}).click();
  await expect(page.getByText("Ed Dated Lesson").first()).toBeVisible();
  await expect(page.getByText("Ed Undated Lesson").first()).toBeVisible();
  await expect(page.getByText("Ed Completed Lesson").first()).toBeVisible();

  await page.getByRole("button",{name:"View Ed Undated Lesson details"}).first().click();
  await expect(page.getByRole("dialog")).toContainText("No due date");
  await expect(page.getByRole("dialog")).toContainText("attempted");
  await expect(page.getByRole("dialog").getByRole("link",{name:/Open in Ed/i})).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link",{name:"Upcoming"}).click();
  await expect(page.getByText("Ed Dated Lesson").first()).toBeVisible();
  await expect(page.getByText("Ed Undated Lesson")).toHaveCount(0);
  await expect(page.getByText("Ed Completed Lesson")).toHaveCount(0);

  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(apiResponses.join("\n")).not.toContain(token);
  expect(apiResponses.join("\n").toLowerCase()).not.toContain("authorization");

  const testAndConnect=apiRequests.filter(entry=>/\/(test|connect)$/.test(new URL(entry.url).pathname));
  expect(testAndConnect).toHaveLength(2);
  expect(testAndConnect.every(entry=>entry.body?.includes(token))).toBe(true);
  for(const entry of apiRequests.filter(entry=>!/\/(test|connect)$/.test(new URL(entry.url).pathname))){
    expect(entry.body??"").not.toContain(token);
    expect((entry.body??"").toLowerCase()).not.toContain("authorization");
  }
});
