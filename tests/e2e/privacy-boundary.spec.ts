import {expect,test} from "@playwright/test";
import {prepareFixtureUser} from "./helpers";

test("rejects cross-origin settings mutations before changing authenticated state",async({context})=>{
  await prepareFixtureUser(context);
  const original=await (await context.request.get("/api/settings/calendar")).json();
  const forgeries:Array<Record<string,string>>=[
    {"sec-fetch-site":"cross-site"},
    {origin:"https://evil.example.invalid"},
    {origin:"http://127.0.0.1:9999"},
    {origin:"null"},
  ];
  for(const headers of forgeries){
    const result=await context.request.put("/api/settings/calendar",{
      headers,data:{hideSubmitted:!original.hideSubmitted},
    });
    expect(result.status()).toBe(403);
    expect(await (await context.request.get("/api/settings/calendar")).json()).toEqual(original);
  }
});
