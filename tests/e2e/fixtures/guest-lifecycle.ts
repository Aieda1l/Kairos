import {expect,type Page} from "@playwright/test";

export async function localData(page:Page){return page.evaluate(async()=>{
  const path="/src/lib/guest/store.ts";const {openGuestStore}=await import(/* @vite-ignore */ path) as typeof import("../../../src/lib/guest/store");
  const store=await openGuestStore();try{return await store.read();}finally{store.close();}
});}
export async function privateData(page:Page){return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("kairos-guest-v1");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{const names=Array.from(db.objectStoreNames),tx=db.transaction(names,"readonly"),result:Record<string,unknown[]>={};for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{result[name]=request.result;};}tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
});}
export async function installLifecycleSources(page:Page, dueAt:string|null=null){
  await page.route("**/api/guest/sources/canvas/feed",route=>route.fulfill({json:{ok:true,schemaVersion:1,requestId:route.request().postDataJSON().requestId,checkedAt:new Date().toISOString(),assignments:Array.from({length:10},(_,i)=>({source:"canvas",externalId:String(i+1),courseId:"12",courseName:"Canvas Test",title:`Canvas Homework ${i+1}`,releaseAt:null,dueAt,lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:`https://canvas.uw.edu/courses/12/assignments/${i+1}`,sourceUpdatedAt:null})),report:{skippedCount:0,malformedCount:0,partial:false}}}));
  await page.addInitScript(()=>{
    let held:unknown=null;
    window.addEventListener("guest-fixture-release",()=>{if(held){window.postMessage(held,location.origin);held=null;sessionStorage.setItem("guest-released","yes");}});
    window.addEventListener("message",event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!=="kairos-page")return;
      const data=event.data,payload=data.payload;
      const send=(type:string,result:unknown)=>window.postMessage({source:"kairos-extension",type,protocolVersion:1,requestId:data.requestId,payload:result},location.origin);
      if(data.type==="PING")window.postMessage({source:"kairos-extension",type:"PONG",protocolVersion:1,requestId:data.requestId,extensionVersion:"fixture-v1",canvasTabDetected:true,gradescopeTabDetected:true},location.origin);
      if(data.type==="GRADESCOPE_DISCOVER_COURSES")send("GRADESCOPE_DISCOVER_COURSES_RESULT",{protocolVersion:1,requestId:payload.requestId,courses:[{courseId:"123",shortName:"GS 123",fullName:"Guest Gradescope",term:null,year:null}],errorCode:null});
      if(data.type==="GRADESCOPE_SYNC_ASSIGNMENTS")send("GRADESCOPE_SYNC_ASSIGNMENTS_RESULT",{protocolVersion:1,requestId:payload.requestId,courses:payload.courseIds.map((courseId:string)=>({courseId,checkedAt:new Date().toISOString(),errorCode:null,assignments:[{courseId,assignmentId:"10",title:"Guest Gradescope Homework",releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:"Submitted",state:"submitted",isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,gradeDisplay:null,checkedAt:new Date().toISOString(),extractorVersion:"fixture-v1"}]})),errorCode:null});
      if(data.type==="SYNC_SUBMISSION_STATUS"){
        sessionStorage.setItem("guest-status-request",data.requestId);
        const mode=sessionStorage.getItem("guest-status-mode");
        const reply={source:"kairos-extension",type:"SYNC_SUBMISSION_STATUS_RESULT",protocolVersion:mode==="older"?0:1,requestId:data.requestId,payload:{protocolVersion:1,requestId:payload.requestId,results:payload.assignments.map((a:{assignmentLocalId:string;courseId:string;assignmentId:string},i:number)=>({...a,state:"not_submitted",isLate:false,isMissing:false,submittedAt:null,checkedAt:new Date().toISOString(),extractorVersion:"fixture-v1",...(i===9?{errorCode:"CANVAS_SIGNED_OUT"}:{})})),errorCode:null}};
        if(mode==="hold")held=reply;
        else if(mode!=="unavailable")window.postMessage(reply,location.origin);
      }
    });
  });
}
export async function connectCanvas(page:Page){
  await page.getByLabel("Canvas calendar feed URL").fill("https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics");
  await page.getByLabel("Remember Canvas credential on this device").check();await page.getByRole("button",{name:"Connect Canvas",exact:true}).click();
  await expect(page.getByRole("button",{name:"Disconnect Canvas",exact:true})).toBeVisible();
}
export async function holdCanvasStatus(page:Page){
  await page.evaluate(()=>{sessionStorage.setItem("guest-status-mode","hold");sessionStorage.removeItem("guest-status-request");});
  await page.getByRole("button",{name:"Sync Canvas",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem("guest-status-request"))).not.toBeNull();
}
export async function releaseCanvasStatus(page:Page){
  await page.evaluate(()=>new Promise<void>(resolve=>{
    const received=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==="kairos-extension"&&event.data.requestId===sessionStorage.getItem("guest-status-request")){window.removeEventListener("message",received);queueMicrotask(resolve);}};
    window.addEventListener("message",received);window.dispatchEvent(new Event("guest-fixture-release"));
  }));
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem("guest-released"))).toBe("yes");
}
