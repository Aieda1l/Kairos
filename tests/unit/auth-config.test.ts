import { describe, expect, it } from "vitest";
import { createAuthConfig } from "@/lib/auth/config";

const env={
  AUTH_SECRET:"test-auth-secret",
  AUTH_GOOGLE_ID:"google-client-id",
  AUTH_GOOGLE_SECRET:"google-client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ID:"microsoft-client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET:"microsoft-client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:"https://login.microsoftonline.com/common/v2.0",
};

function providersOf(config:ReturnType<typeof createAuthConfig>){
  return config.providers as unknown as Array<Record<string,unknown>>;
}

describe("hosted Auth.js configuration",()=>{
  it("uses D1 database sessions and only Google/Microsoft identity providers",()=>{
    const config=createAuthConfig({} as never,env);
    expect(config.adapter).toBeTruthy();
    expect(config.session?.strategy).toBe("database");
    expect(providersOf(config).map(provider=>provider.id)).toEqual([
      "google",
      "microsoft-entra-id",
    ]);
  });

  it("keeps identity authorization separate from calendar authorization",()=>{
    const config=createAuthConfig({} as never,env);
    const serialized=JSON.stringify(providersOf(config)).toLowerCase();

    expect(serialized).toContain("openid");
    expect(serialized).toContain("email");
    expect(serialized).not.toContain("calendar.app.created");
    expect(serialized).not.toContain("calendars.readwrite");
  });

  it("does not opt into automatic email-based account linking",()=>{
    const config=createAuthConfig({} as never,env);
    for(const provider of providersOf(config)){
      expect(provider.allowDangerousEmailAccountLinking).not.toBe(true);
    }
  });

  it("exposes the adapter user id on database sessions",async()=>{
    const config=createAuthConfig({} as never,env);
    const callback=config.callbacks?.session;
    expect(callback).toBeTypeOf("function");

    const result=await callback!({
      session:{
        user:{name:"Alice",email:"alice@example.invalid",image:null},
        expires:"2099-01-01T00:00:00.000Z",
      },
      user:{
        id:"alice",
        name:"Alice",
        email:"alice@example.invalid",
        emailVerified:null,
        image:null,
      },
    } as never);

    expect((result as {user?:{id?:string}}).user?.id).toBe("alice");
  });
});
