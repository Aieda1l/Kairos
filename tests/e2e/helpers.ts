import {expect,type BrowserContext,type Page} from "@playwright/test";
import {randomUUID} from 'node:crypto';
const isolationKeys=new WeakMap<BrowserContext,string>();
export async function signInFixtureUser(context:BrowserContext,user:'alice'|'bob'='alice'){
  let isolationKey=isolationKeys.get(context);
  if(!isolationKey){isolationKey=randomUUID();isolationKeys.set(context,isolationKey);}
  const response=await context.request.post('/api/test-fixtures/session',{data:{user,isolationKey}});
  if(!response.ok())throw new Error(`fixture session setup failed (${response.status()})`);
}

export async function waitForAppHydration(page:Page){
  await page.waitForFunction(()=>(
    window as Window&{__NEXT_HYDRATED?:boolean}
  ).__NEXT_HYDRATED===true);
}

export async function prepareFixtureUser(
  context:BrowserContext,
  user:"alice"|"bob"="alice",
  onboarding:"new"|"completed"="completed",
){
  await signInFixtureUser(context,user);
  let reset=await context.request.post("/api/test-fixtures/reset");
  if(reset.status()===409&&(await reset.json()).code==='FIXTURE_WORK_PENDING'){
    await expect.poll(async()=>{
      reset=await context.request.post('/api/test-fixtures/reset');return reset.status();
    },{timeout:10000,intervals:[100,250,500,1000]}).toBe(200);
  }
  if(!reset.ok()){
    throw new Error(`fixture reset failed (${reset.status()})`);
  }
  const progress=await context.request.get('/api/settings/onboarding');
  if(!progress.ok())throw new Error(`fixture setup progress failed (${progress.status()})`);
  const {state}=await progress.json();
  if(onboarding==='completed'){
    const completed=await context.request.patch('/api/settings/onboarding',{
      data:{command:{type:'finish'},expectedRevision:state.revision},
    });
    if(!completed.ok()||(await completed.json()).state.status!=='completed')throw new Error(`fixture completion failed (${completed.status()})`);
  }else if(state.status!=='active')throw new Error('fixture new-user progress is not active');
}

export async function enableFixtureSubmissionStatus(context:BrowserContext){
  const response=await context.request.put('/api/settings/submission-status',{data:{enabled:true}});
  if(!response.ok()||(await response.json()).enabled!==true)throw new Error(`fixture submission preference failed (${response.status()})`);
}
