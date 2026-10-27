import {expect,type BrowserContext,type Page} from "@playwright/test";

/** Disposable loopback fixture only. Never call during a rate-denial assertion or a UI clear-data flow. */
export async function resetGuestAdmission(context:BrowserContext){
  const response=await context.request.post("/api/test-fixtures/guest-admission/reset",{headers:{origin:"http://127.0.0.1:3000"},data:{}});
  expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({ok:true,deletedCount:expect.any(Number)});
}
/** Seal browser network before navigation; no identity session setup is involved. */
export async function sealGuestJourney(page:Page){
  const forbidden:string[]=[];const requests:{path:string;body:string|null}[]=[];
  await page.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname==="challenges.cloudflare.com"&&url.pathname==="/turnstile/v0/api.js"){
      return route.fulfill({contentType:"application/javascript",body:`window.turnstile={render:function(el,o){if(o.action!=="guest_sync")throw Error("Unexpected challenge action");const b=document.createElement("button");b.type="button";b.textContent="Complete guest challenge";b.onclick=function(){o.callback("fixture-guest-"+crypto.randomUUID());};el.append(b);return "guest-fixture";},reset:function(){},remove:function(){}};`});
    }
    if(url.origin!=="http://127.0.0.1:3000"||(/^\/api\//.test(url.pathname)&&!url.pathname.startsWith("/api/guest/"))){forbidden.push(request.url());return route.abort();}
    if(url.pathname.startsWith("/api/guest/"))requests.push({path:url.pathname,body:request.postData()});
    return route.continue();
  });
  return {forbidden,requests};
}
export async function finishGuestVerification(page:Page){
  await page.getByRole("button",{name:"Complete guest challenge"}).click();
  await page.getByRole("button",{name:"Verify and continue"}).click();
}
