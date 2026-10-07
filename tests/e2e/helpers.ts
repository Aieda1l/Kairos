import type { Page } from "@playwright/test";

export async function waitForAppHydration(page:Page){
  await page.waitForFunction(()=>(
    window as Window&{__NEXT_HYDRATED?:boolean}
  ).__NEXT_HYDRATED===true);
}
