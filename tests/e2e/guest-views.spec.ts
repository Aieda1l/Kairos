import {expect,test} from "@playwright/test";

test("account-free guest views persist local preferences and use only guest navigation",async({page})=>{
  const accountRequests:string[]=[];
  page.on("request",request=>{if(/\/api\/(auth|settings|sources|assignments|sync-all)/.test(request.url()))accountRequests.push(request.url());});
  await page.goto("/");
  const guestNavigation=page.waitForURL(/\/guest\/upcoming$/);
  await Promise.all([guestNavigation,page.getByRole("link",{name:"Try without an account"}).click()]);
  await expect(page).toHaveURL(/\/guest\/upcoming$/);
  await expect(page.getByText("Saved in this browser")).toBeVisible();
  await expect(page.getByText("No assignments yet")).toBeVisible();
  await page.getByRole("link",{name:"Assignments",exact:true}).click();
  await page.getByLabel("Search",{exact:true}).fill("homework");
  await page.getByLabel("Sort by").selectOption("status");
  // Wait for actual IndexedDB persistence before recreating the provider.
  await expect.poll(async()=>page.evaluate(async()=>{
    const path="/src/lib/guest/store.ts";
    const {openGuestStore}=await import(/* @vite-ignore */ path) as typeof import("../../src/lib/guest/store");
    const store=await openGuestStore();try{return (await store.read()).preferences;}finally{store.close();}
  })).toMatchObject({filters:{search:"homework"},sort:"status"});
  await page.evaluate(async()=>{
    const path="/src/lib/guest/store.ts";
    const {openGuestStore}=await import(/* @vite-ignore */ path) as typeof import("../../src/lib/guest/store");
    const store=await openGuestStore();try{await store.savePreferences({timeZone:"Asia/Tokyo"},(await store.getIdentity()).datasetId);}finally{store.close();}
  });
  await expect(page.getByText("Times shown in Asia/Tokyo")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Search",{exact:true})).toHaveValue("homework");
  await expect(page.getByLabel("Sort by")).toHaveValue("status");
  await expect(page.getByText("Times shown in Asia/Tokyo")).toBeVisible();
  for(const name of ["Calendar","Sources","Settings"]){await page.getByRole("link",{name,exact:true}).click();await expect(page).toHaveURL(new RegExp(`/guest/${name.toLowerCase()}$`));}
  await expect(page.getByRole("button",{name:/sign out|sync all/i})).toHaveCount(0);
  expect(accountRequests).toEqual([]);
});

test("guest navigation and loading layout fit a narrow viewport in both themes",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto("/guest/upcoming");
  await expect(page.getByText("No assignments yet")).toBeVisible();
  for(const theme of ["light","dark"]){
    await page.evaluate(value=>document.documentElement.classList.toggle("dark",value==="dark"),theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    for(const name of ["Upcoming","Calendar","Assignments","Sources","Settings","Use an account"]){
      const target=page.getByRole("link",{name,exact:true});
      await expect(target).toBeVisible();
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
});
