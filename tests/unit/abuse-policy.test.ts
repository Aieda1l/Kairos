import {describe,expect,it,vi} from "vitest";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

function environment():Record<string,unknown>{
  return {
    DB:{prepare(){},batch(){},exec(){}},
    KAIROS_APP_URL:"https://mykairos.me",
    KAIROS_TURNSTILE_SITE_KEY:"dummy-site-key",
    KAIROS_TURNSTILE_SECRET_KEY:"dummy-turnstile-secret",
    KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),
    KAIROS_ABUSE_TRUSTED_INGRESS:"cloudflare",
  };
}

describe("server-owned abuse policy and runtime",()=>{
  it.each([
    ['E2E_FIXTURES','1'],['KAIROS_TURNSTILE_SITE_KEY','1x00000000000000000000AA'],
    ['KAIROS_TURNSTILE_SECRET_KEY','1x0000000000000000000000000000000AA'],
    ['KAIROS_TURNSTILE_SECRET_KEY','synthetic-secret'],
  ])('rejects hosted test configuration before any request %s',async(name,value)=>{
    const {resolveAbuseRuntime}=await import('@/lib/platform/abuse-runtime');
    const env=environment();env[name]=value;const request=vi.fn<typeof fetch>();
    expect(()=>resolveAbuseRuntime(env,request)).toThrowError(expect.objectContaining({code:'ABUSE_CONFIG_INVALID'}));
    expect(request).not.toHaveBeenCalled();
  });
  it("selects all six exact rolling defaults from server-derived subjects",async()=>{
    const {budgetForSubject}=await import("@/lib/abuse/policy");
    const cases=[
      [{class:"auth-initiation",provider:"google",network:"ipv4:203.0.113.8"},20,600],
      [{class:"credential",userId:"alice",provider:"ed"},10,600],
      [{class:"source-sync",userId:"alice",provider:"canvas",resourceId:"source"},12,600],
      [{class:"calendar-sync",userId:"alice",provider:"google",resourceId:"destination"},12,600],
      [{class:"sync-all",userId:"alice"},6,600],
      [{class:"deletion",userId:"alice"},5,3600],
    ] as const;
    for(const [subject,limit,windowSeconds] of cases){
      expect(budgetForSubject(subject)).toEqual({limit,windowSeconds});
    }
  });

  it("only honors validated server configuration, never budget fields on a subject",async()=>{
    const {budgetForSubject,policyFromEnvironment}=await import("@/lib/abuse/policy");
    const subject={class:"sync-all" as const,userId:"alice",limit:1000,windowSeconds:1};
    expect(budgetForSubject(subject)).toEqual({limit:6,windowSeconds:600});
    const policy=policyFromEnvironment({KAIROS_ABUSE_BUDGETS:JSON.stringify({"sync-all":{limit:2,windowSeconds:60}})});
    expect(budgetForSubject(subject,policy)).toEqual({limit:2,windowSeconds:60});
    expect(budgetForSubject({class:"deletion",userId:"alice"},policy)).toEqual({limit:5,windowSeconds:3600});
  });

  it.each(["null","[]","false","{",'{"unknown":{"limit":2,"windowSeconds":60}}',
    '{"sync-all":{"limit":0,"windowSeconds":600}}','{"sync-all":{"limit":1001,"windowSeconds":600}}',
    '{"sync-all":{"limit":1.5,"windowSeconds":600}}','{"sync-all":{"limit":6,"windowSeconds":3601}}',
    '{"sync-all":{"limit":6,"windowSeconds":0}}','{"sync-all":{"limit":6}}',
    '{"sync-all":{"limit":6,"windowSeconds":600,"extra":true}}'])
  ("fails closed on invalid operational override %s",async value=>{
    const {policyFromEnvironment}=await import("@/lib/abuse/policy");
    expect(()=>policyFromEnvironment({KAIROS_ABUSE_BUDGETS:value})).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it("loads configuration lazily and validates the same injected environment and fetch",async()=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment(),fetchImpl=vi.fn<typeof fetch>();
    const runtime=resolveAbuseRuntime(env,fetchImpl);
    expect(runtime).toMatchObject({db:env.DB,hmacKey:new Uint8Array(32).fill(7),turnstileSecret:"dummy-turnstile-secret",
      appOrigin:"https://mykairos.me",hostname:"mykairos.me",fetchImpl,trustedIngress:"cloudflare"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["DB","KAIROS_TURNSTILE_SITE_KEY","KAIROS_TURNSTILE_SECRET_KEY","KAIROS_ABUSE_KEY_V1","KAIROS_APP_URL"])
  ("fails closed when %s is absent",async name=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();delete env[name];
    expect(()=>resolveAbuseRuntime(env)).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it.each(["short-key","A".repeat(43),"B".repeat(43),"A".repeat(44),"A".repeat(42)+"=", " "+"A".repeat(43)])
  ("rejects malformed, noncanonical, or credential-reused HMAC configuration %s",async encoded=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();env.KAIROS_ABUSE_KEY_V1=encoded;
    // All-zero material is syntactically valid; this case proves dedicated-key enforcement.
    if(encoded==="A".repeat(43))env.KAIROS_CREDENTIAL_KEY_V1=encoded;
    expect(()=>resolveAbuseRuntime(env)).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it("rejects equivalent noncanonical credential-key encoding as key reuse",async()=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();
    env.KAIROS_ABUSE_KEY_V1="A".repeat(43);
    env.KAIROS_CREDENTIAL_KEY_V1="A".repeat(42)+"B";
    expect(()=>resolveAbuseRuntime(env)).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it.each(["https://mykairos.me/path","https://user:secret@mykairos.me","http://mykairos.me","https://mykairos.me?secret=yes"])
  ("rejects unsafe origin configuration %s without reflecting it",async origin=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();env.KAIROS_APP_URL=origin;
    expect(()=>resolveAbuseRuntime(env)).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it("defaults ingress to none and rejects unsupported server ingress modes",async()=>{
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();delete env.KAIROS_ABUSE_TRUSTED_INGRESS;
    expect(resolveAbuseRuntime(env).trustedIngress).toBe("none");
    env.KAIROS_ABUSE_TRUSTED_INGRESS="x-forwarded-for";
    expect(()=>resolveAbuseRuntime(env)).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });

  it("maps typed safe errors only and clamps retry in both HTTP and JSON",async()=>{
    const {abuseErrorResponse}=await import("@/lib/abuse/guard");
    const {RateLimitedError,AbuseStorageUnavailableError}=await import("@/lib/abuse/types");
    for(const [input,expected] of [[0,1],[-1,1],[0.1,1],[1.2,2],[99999,3600],[NaN,60],[Infinity,60]]){
      const response=abuseErrorResponse(new RateLimitedError(input))!;
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe(String(expected));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({code:"RATE_LIMITED",retryAfterSeconds:expected});
    }
    const response=abuseErrorResponse(new AbuseStorageUnavailableError())!;
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(abuseErrorResponse({code:"RATE_LIMITED",message:"private",retryAfterSeconds:9})).toBeNull();
    expect(abuseErrorResponse(new Error("private"))).toBeNull();
  });

  it("fails before any upstream work when admission storage is unavailable",async()=>{
    const {enforceBudget,abuseErrorResponse}=await import("@/lib/abuse/guard");
    const {resolveAbuseRuntime}=await import("@/lib/platform/abuse-runtime");
    const env=environment();env.DB={prepare(){throw new Error("private URL/credential/IP");},batch:async()=>[],exec:async()=>{}} satisfies D1DatabaseLike;
    const fetchImpl=vi.fn<typeof fetch>(),runtime=resolveAbuseRuntime(env,fetchImpl);
    const error=await enforceBudget(runtime,{class:"sync-all",userId:"alice"}).catch(error=>error);
    const response=abuseErrorResponse(error)!;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps configuration/address/subject failures with safe messages and no-store",async()=>{
    const {abuseErrorResponse}=await import("@/lib/abuse/guard");
    const {AbuseConfigurationError,AbuseClientAddressError,AbuseSubjectError}=await import("@/lib/abuse/types");
    for(const [error,status] of [[new AbuseConfigurationError(),503],[new AbuseClientAddressError(),400],[new AbuseSubjectError(),400]] as const){
      const response=abuseErrorResponse(error)!;
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({code:error.code});
    }
  });
});
