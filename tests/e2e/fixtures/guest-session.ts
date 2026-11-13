import {expect,type BrowserContext,type Page,type Route} from "@playwright/test";

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

/** Read an authentic receipt from the local fixture source, then substitute synthetic provider bytes. */
export async function fulfillCanvasFixture(route:Route,body:string){
  const request=route.request().postDataJSON();
  const response=await route.fetch({postData:JSON.stringify({...request,feedUrl:"https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics"})});
  if(!response.ok())return route.fulfill({response});
  const headers=response.headers();delete headers["content-length"];delete headers["content-encoding"];
  return route.fulfill({response,body,headers:{...headers,"content-type":"application/octet-stream"}});
}
export function canvasFixture(count:number,dueAt:string|null=null){
  const date=dueAt?`DTSTART:${dueAt.replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}\r\n`:"";
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${Array.from({length:count},(_,i)=>`BEGIN:VEVENT\r\nUID:event-assignment-${i+1}\r\nSUMMARY:Canvas Homework ${i+1} [Canvas Test]\r\n${date}URL:https://canvas.uw.edu/calendar?include_contexts=course_12#assignment_${i+1}\r\nEND:VEVENT\r\n`).join("")}END:VCALENDAR\r\n`;
}
/** Obtain a real guest capability from the local synthetic challenge transport. */
export async function bootstrapGuestFixture(context:BrowserContext){
 if((await context.cookies()).some(cookie=>cookie.name==="kairos-guest-sync-dev"))return;
 const response=await context.request.post("/api/guest/session",{headers:{origin:"http://127.0.0.1:3000"},data:{schemaVersion:1,requestId:crypto.randomUUID(),turnstileToken:`fixture-guest-${crypto.randomUUID()}`}});
 expect(response.status()).toBe(200);
}
