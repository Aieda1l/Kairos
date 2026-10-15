import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {
  ProductionConfigError,
  validateProductionConfig,
} from "@/lib/platform/production-config";

function validEnvironment():Record<string,unknown>{
  return {
    KAIROS_APP_URL:"https://mykairos.me",
    AUTH_URL:"https://mykairos.me",
    DB:{prepare(){return null;},batch(){return null;},exec(){return null;}},
    AUTH_SECRET:"fixture-auth-secret",
    AUTH_GOOGLE_ID:"fixture-google-id",
    AUTH_GOOGLE_SECRET:"fixture-google-secret",
    AUTH_MICROSOFT_ENTRA_ID_ID:"fixture-microsoft-id",
    AUTH_MICROSOFT_ENTRA_ID_SECRET:"fixture-microsoft-secret",
    GOOGLE_CALENDAR_CLIENT_ID:"fixture-google-calendar-id",
    MICROSOFT_CALENDAR_CLIENT_ID:"fixture-microsoft-calendar-id",
    MICROSOFT_CALENDAR_CLIENT_SECRET:"fixture-microsoft-calendar-secret",
    MICROSOFT_CALENDAR_TENANT:"common",
    KAIROS_CREDENTIAL_KEY_V1:"fixture-encryption-key",
  };
}

describe("production configuration",()=>{
  it("accepts the canonical hosted configuration",()=>{
    expect(validateProductionConfig(validEnvironment())).toMatchObject({
      appUrl:"https://mykairos.me",
      authUrl:"https://mykairos.me",
      database:expect.any(Object),
    });
  });

  it("reports stable missing variable names without configured values",()=>{
    const env=validEnvironment();
    delete env.AUTH_SECRET;
    env.AUTH_URL="https://evil.example/fixture-secret-never-echo";
    try{
      validateProductionConfig(env);
      throw new Error("expected production configuration failure");
    }catch(error){
      expect(error).toBeInstanceOf(ProductionConfigError);
      expect((error as ProductionConfigError).fields).toEqual([
        "AUTH_SECRET",
        "AUTH_URL",
      ]);
      expect((error as Error).message).toContain("AUTH_SECRET");
      expect((error as Error).message).toContain("AUTH_URL");
      expect((error as Error).message).not.toContain("fixture-secret-never-echo");
      expect((error as Error).message).not.toContain("evil.example");
    }
  });

  it.each([
    ["KAIROS_APP_URL","http://mykairos.me"],
    ["KAIROS_APP_URL","https://www.mykairos.me"],
    ["AUTH_URL","http://mykairos.me"],
    ["AUTH_URL","https://mykairos.me.evil.example"],
  ])("requires exact canonical value for %s",(field,value)=>{
    const env=validEnvironment();
    env[field]=value;
    expect(()=>validateProductionConfig(env)).toThrowError(expect.objectContaining({
      fields:[field],
    }));
  });

  it("keeps checked-in preview and production D1 bindings distinct placeholders",()=>{
    const wrangler=JSON.parse(fs.readFileSync(
      path.join(process.cwd(),"wrangler.jsonc"),
      "utf8",
    )) as {
      d1_databases:Array<{database_id:string}>;
      env?:{
        preview?:{d1_databases?:Array<{database_id:string}>};
        production?:{d1_databases?:Array<{database_id:string}>};
      };
    };
    const previewId=wrangler.env?.preview?.d1_databases?.[0]?.database_id;
    const productionId=wrangler.env?.production?.d1_databases?.[0]?.database_id;
    expect(previewId).toMatch(/^22222222-2222-2222-2222-222222222222$/);
    expect(productionId).toMatch(/^11111111-1111-1111-1111-111111111111$/);
    expect(previewId).not.toBe(productionId);
    expect(wrangler.d1_databases[0]?.database_id).toBe("00000000-0000-0000-0000-000000000000");
  });
});
