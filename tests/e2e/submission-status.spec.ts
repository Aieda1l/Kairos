import { expect, test } from "@playwright/test";

type BridgeCapture = {
  messages: string[];
  syncRequests: number;
  releaseFirstSync: () => void;
};

test("syncs Canvas submission status through the Firefox page bridge without exposing credentials",async({page,request})=>{
  const reset=await request.post("/api/test-fixtures/reset");
  expect(reset.ok()).toBe(true);
  const apiBodies:string[]=[];
  let startRequests=0;

  page.on("request",request=>{
    if(request.url().endsWith("/api/sources/canvas/submission-status/start")){
      startRequests++;
    }
    if(request.url().includes("/api/sources/canvas/submission-status/")){
      const body=request.postData();
      if(body) apiBodies.push(body);
    }
  });

  await page.addInitScript(()=>{
    const state={
      messages:[] as string[],
      syncRequests:0,
      held:null as Record<string,unknown>|null,
      releaseFirstSync:()=>{},
    };
    const exposed=window as Window & {__kairosBridgeCapture?:typeof state};
    exposed.__kairosBridgeCapture=state;

    const reply=(request:Record<string,unknown>)=>{
      const payload=request.payload as {
        requestId:string;
        assignments:Array<{assignmentLocalId:string;courseId:string;assignmentId:string}>;
      };
      const response={
        source:"kairos-extension",
        type:"SYNC_SUBMISSION_STATUS_RESULT",
        protocolVersion:1,
        requestId:request.requestId,
        payload:{
          protocolVersion:1,
          requestId:payload.requestId,
          results:payload.assignments.map(item=>({
            ...item,
            state:"submitted",
            isLate:false,
            isMissing:false,
            submittedAt:"2026-10-03T22:00:00.000Z",
            checkedAt:"2026-10-04T07:00:00.000Z",
            extractorVersion:"e2e-bridge-v1",
          })),
          errorCode:null,
        },
      };
      window.postMessage(response,window.location.origin);
    };

    state.releaseFirstSync=()=>{
      if(!state.held) return;
      const request=state.held;
      state.held=null;
      reply(request);
    };

    window.addEventListener("message",event=>{
      if(event.source!==window||event.origin!==window.location.origin) return;
      const data=event.data as Record<string,unknown>;
      if(data?.source!=="kairos-page") return;
      state.messages.push(JSON.stringify(data));

      if(data.type==="PING"){
        window.postMessage({
          source:"kairos-extension",
          type:"PONG",
          protocolVersion:1,
          requestId:data.requestId,
          extensionVersion:"0.2.0-e2e",
          canvasTabDetected:true,
        },window.location.origin);
        return;
      }

      if(data.type==="SYNC_SUBMISSION_STATUS"){
        state.syncRequests++;
        if(state.syncRequests===1){
          state.held=data;
          return;
        }
        reply(data);
      }
    });
  });

  const secret="fixture-secret-never-echo";
  await page.goto("/sources");
  const feedUrl=`http://127.0.0.1:3000/api/test-fixtures/canvas-feed?token=${secret}`;
  await page.getByLabel("Canvas calendar feed URL").fill(feedUrl);
  await page.getByRole("button",{name:"Test connection"}).click();
  await expect(page.getByText(/1 assignments found/)).toBeVisible();
  await page.getByRole("button",{name:"Connect Canvas"}).click();
  await page.waitForURL("**/upcoming");

  await expect(page.getByText("Fixture Homework").first()).toBeVisible();
  await expect(page.getByText("Status unavailable").first()).toBeVisible();
  await expect.poll(()=>startRequests).toBe(1);

  await page.evaluate(()=>{
    const capture=(window as Window & {__kairosBridgeCapture?:BridgeCapture}).__kairosBridgeCapture;
    capture?.releaseFirstSync();
  });

  await expect(page.getByText("Submitted").first()).toBeVisible();
  await expect(page.getByText(/Canvas submissions · Updated/)).toBeVisible();

  // router.refresh() rerenders server data but must not start a second automatic sync.
  await page.waitForTimeout(250);
  expect(startRequests).toBe(1);

  await page.getByRole("button",{name:"Sync submission status"}).click();
  await expect.poll(()=>startRequests).toBe(2);
  await expect(page.getByText("Submitted").first()).toBeVisible();

  const bridgeCapture=await page.evaluate(()=>{
    const capture=(window as Window & {__kairosBridgeCapture?:BridgeCapture}).__kairosBridgeCapture;
    return {
      messages:capture?.messages??[],
      syncRequests:capture?.syncRequests??0,
    };
  });
  expect(bridgeCapture.syncRequests).toBe(2);

  const captured=[...apiBodies,...bridgeCapture.messages].join("\n").toLowerCase();
  for(const forbidden of ["cookie","authorization","uw password","fixture-secret-never-echo","<html"]){
    expect(captured).not.toContain(forbidden);
  }
});
