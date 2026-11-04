import {afterEach,expect,it,vi} from "vitest";
import {requestGuestPersistence} from "@/lib/guest/persistence";

afterEach(()=>vi.unstubAllGlobals());

it.each(["pending","refused","throws"] as const)("requests storage at most once per document when persistence is %s",async mode=>{
  const persist=vi.fn(()=>{
    if(mode==="throws")throw Error("browser persistence unavailable");
    return mode==="pending"?new Promise<boolean>(()=>{}):Promise.resolve(false);
  });
  vi.stubGlobal("navigator",{storage:{persist}});
  expect(requestGuestPersistence()).toBeUndefined();
  await Promise.resolve();
  expect(requestGuestPersistence()).toBeUndefined();
  expect(persist).toHaveBeenCalledOnce();
});

it("keeps saving independent of unsupported browser storage",()=>{
  vi.stubGlobal("navigator",{});
  expect(requestGuestPersistence()).toBeUndefined();
});
