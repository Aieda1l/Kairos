import {expect,test} from "@playwright/test";
import {waitForAppHydration} from "./helpers";

for(const layout of ["desktop","collapsed","mobile"] as const){
  test(`sign out through ${layout} navigation invalidates only the current user's session`,async({browser})=>{
    const alice=await browser.newContext({baseURL:"http://127.0.0.1:3000"});
    const bob=await browser.newContext({baseURL:"http://127.0.0.1:3000"});
    try{
      for(const [context,user] of [[alice,"alice"],[bob,"bob"]] as const){
        expect((await context.request.post("/api/test-fixtures/session",{data:{user}})).ok()).toBe(true);
        expect((await context.request.post("/api/test-fixtures/reset")).ok()).toBe(true);
        expect((await context.request.post("/api/test-fixtures/tenant-state")).ok()).toBe(true);
      }
      const originalCookie=(await alice.cookies()).find(cookie=>cookie.name==="authjs.session-token");
      expect(originalCookie).toBeDefined();
      const page=await alice.newPage();
      if(layout==="mobile")await page.setViewportSize({width:375,height:812});
      await page.goto("/upcoming");
      await waitForAppHydration(page);
      if(layout==="collapsed")await page.getByRole("button",{name:"Collapse sidebar"}).click();
      if(layout==="mobile")await page.getByRole("button",{name:"Open navigation"}).click();
      await page.getByRole("button",{name:"Sign out",exact:true}).click();
      await expect(page).toHaveURL(/\/sign-in$/);
      const signedOutSession=await alice.request.get("/api/auth/session");
      expect(signedOutSession.ok()).toBe(true);
      expect(await signedOutSession.json()).toBeNull();
      expect((await alice.request.get("/api/settings/calendar")).status()).toBe(401);
      // Replaying the old cookie must fail too: clearing the browser cookie alone is insufficient.
      expect((await alice.request.get("/api/settings/calendar",{
        headers:{cookie:`${originalCookie!.name}=${originalCookie!.value}`},
      })).status()).toBe(401);
      await page.goto("/upcoming");
      await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
      expect((await bob.request.get("/api/settings/calendar")).ok()).toBe(true);
      // Signing out preserves tenant data for the next sign-in.
      expect((await alice.request.post("/api/test-fixtures/session",{data:{user:"alice"}})).ok()).toBe(true);
      await page.goto("/upcoming");
      await expect(page.getByText("Alice Hosted Assignment").first()).toBeVisible();
    }finally{await Promise.all([alice.close(),bob.close()]);}
  });
}
