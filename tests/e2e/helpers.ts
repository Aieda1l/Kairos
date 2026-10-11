import type {BrowserContext,Page} from "@playwright/test";

export async function waitForAppHydration(page:Page){
  await page.waitForFunction(()=>(
    window as Window&{__NEXT_HYDRATED?:boolean}
  ).__NEXT_HYDRATED===true);
}

export async function prepareFixtureUser(
  context:BrowserContext,
  user:"alice"|"bob"="alice",
){
  const session=await context.request.post("/api/test-fixtures/session",{
    data:{user},
  });
  if(!session.ok()){
    throw new Error(`fixture session setup failed (${session.status()}): ${await session.text()}`);
  }
  const reset=await context.request.post("/api/test-fixtures/reset");
  if(!reset.ok()){
    throw new Error(`fixture reset failed (${reset.status()}): ${await reset.text()}`);
  }
}
