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
    KAIROS_TURNSTILE_SITE_KEY:"dummy-site-key",
    KAIROS_TURNSTILE_SECRET_KEY:"dummy-turnstile-secret",
    KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),
  };
}

describe("production configuration",()=>{
  it.each(["KAIROS_TURNSTILE_SITE_KEY","KAIROS_TURNSTILE_SECRET_KEY","KAIROS_ABUSE_KEY_V1"])
  ("requires abuse binding %s without leaking configuration",name=>{
    const env=validEnvironment();delete env[name];
    expect(()=>validateProductionConfig(env)).toThrowError(expect.objectContaining({fields:[name]}));
  });

  it.each([
    ["KAIROS_ABUSE_KEY_V1","malformed-private-key"],
    ["KAIROS_ABUSE_BUDGETS",'{"sync-all":{"limit":0,"windowSeconds":600}}'],
    ["KAIROS_ABUSE_TRUSTED_INGRESS","x-forwarded-for"],
  ])("validates bounded abuse configuration %s",(name,value)=>{
    const env=validEnvironment();env[name]=value;
    expect(()=>validateProductionConfig(env)).toThrowError(expect.objectContaining({fields:[name]}));
    try{validateProductionConfig(env);}catch(error){expect((error as Error).message).not.toContain(value);}
  });

  it("rejects credential key reuse and returns the validated server policy",()=>{
    const env=validEnvironment();env.KAIROS_CREDENTIAL_KEY_V1=env.KAIROS_ABUSE_KEY_V1;
    expect(()=>validateProductionConfig(env)).toThrowError(expect.objectContaining({fields:["KAIROS_ABUSE_KEY_V1"]}));
    env.KAIROS_CREDENTIAL_KEY_V1="separate-dummy-encryption-key";
    env.KAIROS_ABUSE_BUDGETS='{"sync-all":{"limit":2,"windowSeconds":60}}';
    expect(validateProductionConfig(env)).toMatchObject({abusePolicy:{"sync-all":{limit:2,windowSeconds:60}},trustedIngress:"none"});
  });

  it("compares underlying key bytes for dedicated abuse key separation",()=>{
    const env=validEnvironment();
    env.KAIROS_ABUSE_KEY_V1="A".repeat(43);
    env.KAIROS_CREDENTIAL_KEY_V1="A".repeat(42)+"B";
    expect(()=>validateProductionConfig(env)).toThrowError(expect.objectContaining({fields:["KAIROS_ABUSE_KEY_V1"]}));
  });

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
