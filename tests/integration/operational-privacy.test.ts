import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {authDiagnostics} from "@/lib/auth/diagnostics";
import {reportSourceRequestFailure} from "@/lib/sources/upstream-diagnostics";
import {createOperationContext,getOperationContext,runWithOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";
import {exchangeMicrosoftAuthorizationCode} from "@/lib/calendar/microsoft/oauth";
import {MicrosoftCalendarClient} from "@/lib/calendar/microsoft/client";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";

const runtime=vi.hoisted(()=>({source:vi.fn(),calendar:vi.fn(),consume:vi.fn()}));
vi.mock("@/lib/platform/source-runtime",()=>({getSourceRuntimeContext:runtime.source}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:runtime.calendar}));
vi.mock("@/lib/calendar/oauth-registry",()=>({consumeOAuthRequest:runtime.consume}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("diagnostic privacy at existing boundaries",()=>{
  it("Auth.js reads concurrent request context without retaining error or debug metadata",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const contexts=[createOperationContext("auth.callback"),createOperationContext("auth.sign_in")];
    await Promise.all(contexts.map((context,i)=>runWithOperationContext(context,async()=>{
      await Promise.resolve();
      if(i===0)authDiagnostics.error(Object.assign(new Error("private exception token email"),{type:"OAuthAccountNotLinked",cause:{url:"private-feed"}}));
      else authDiagnostics.debug("OAuthCallbackError",{providerId:"google",error:"access_denied",code:"private-code",headers:"private-cookie"});
    })));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([value])=>JSON.parse(value as string))).toEqual([
      expect.objectContaining({...contexts[0],code:"AUTH_FAILED",result:"error"}),
      expect.objectContaining({...contexts[1],code:"AUTH_REJECTED",provider:"google",result:"rejected"}),
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    expect(getOperationContext()).toBeNull();
  });

  it("source helper records standalone safe failures and defers contextual outcomes to wrappers",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    reportSourceRequestFailure("canvas","http",403);
    reportSourceRequestFailure("ed","timeout");
    reportSourceRequestFailure("ed","private-reason" as never,401);
    expect(warn.mock.calls.map(([value])=>JSON.parse(value as string))).toEqual([
      expect.objectContaining({action:"source.sync",provider:"canvas",code:"UPSTREAM_HTTP_ERROR",status:403}),
      expect.objectContaining({provider:"ed",code:"UPSTREAM_TIMEOUT"}),
    ]);
    await runWithOperationContext(createOperationContext("source.sync"),async()=>reportSourceRequestFailure("canvas","transport"));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("Microsoft token and Graph failures use the same schema without raw provider details",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    await expect(exchangeMicrosoftAuthorizationCode({clientId:"fixture",tenant:"common",code:"private-code",codeVerifier:"private-verifier",redirectUri:"https://private.invalid/?token=private"},
      async()=>Response.json({error:"invalid_client",error_description:"AADSTS70000 private-email private-token"},{status:401})))
      .rejects.toMatchObject({code:"CALENDAR_CONFIG_MISSING"});
    await expect(new MicrosoftCalendarClient("private-token",async()=>Response.json({error:{code:"ErrorAccessDenied",message:"private-html",innerError:{email:"private"}}},{status:403})).findCalendarByName("private-calendar"))
      .rejects.toMatchObject({code:"CALENDAR_PERMISSION_DENIED"});
    expect(warn.mock.calls.map(([value])=>JSON.parse(value as string))).toEqual([
      expect.objectContaining({action:"calendar.connect",provider:"microsoft",code:"CALENDAR_CONFIG_MISSING",status:401}),
      expect.objectContaining({action:"calendar.sync",provider:"microsoft",code:"CALENDAR_PERMISSION_DENIED",status:403}),
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("70000");
  });

  it.each(["source","calendar"] as const)("%s runtime rejects once using the active context without serializing runtime objects",async kind=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const resolver=kind==="source"?(await import("@/lib/platform/source-api-runtime")).resolveSourceApiRuntime
      :(await import("@/lib/platform/calendar-api-runtime")).resolveCalendarApiRuntime;
    const context=createOperationContext(kind==="source"?"source.sync":"calendar.sync");
    runtime[kind].mockRejectedValue(new AuthenticationRequiredError());
    const result=await runWithOperationContext(context,resolver);
    expect(result.ok).toBe(false);
    if(!result.ok)expect(result.response.status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({...context,code:"AUTH_REQUIRED",result:"rejected",status:401});
    runtime[kind].mockRejectedValue(new Error("private-runtime-envelope"));
    await expect(resolver()).rejects.toThrow("private-runtime-envelope");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    expect(JSON.parse(warn.mock.calls[1][0] as string)).toMatchObject({code:"SERVICE_UNAVAILABLE",result:"error",status:503});
    runtime[kind].mockResolvedValue({kind:"hosted",db:{private:"private-db"},scope:{userId:"private-id"},keyring:{private:"private-key"}});
    expect((await resolver()).ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("contextual provider failures leave exactly one terminal event to the owner",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const context=createOperationContext("calendar.connect");
    await runWithOperationContext(context,async()=>{
      await expect(exchangeMicrosoftAuthorizationCode({clientId:"fixture",tenant:"common",code:"private",codeVerifier:"private",redirectUri:"https://private.invalid"},async()=>Response.json({error:"invalid_grant"},{status:400})))
        .rejects.toMatchObject({code:"CALENDAR_AUTH_EXPIRED"});
      emitOperationEvent(getOperationContext()!,{code:"CALENDAR_AUTH_EXPIRED",result:"error",provider:"microsoft"});
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({...context,code:"CALENDAR_AUTH_EXPIRED"});
  });

  it("records a callback state-store failure without logging its exception or changing propagation",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    runtime.calendar.mockResolvedValue({kind:"legacy",db:{private:"private-db"}});
    runtime.consume.mockImplementation(()=>{throw new Error("private-store-exception");});
    const callback=await import("@/app/api/calendars/microsoft/callback/route");
    await expect(callback.GET(new Request("https://synthetic.invalid/callback?state=private-state&code=private-code")))
      .rejects.toThrow("private-store-exception");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      action:"calendar.connect",code:"SERVICE_UNAVAILABLE",result:"error",provider:"microsoft",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    expect(getOperationContext()).toBeNull();
  });
});

describe("persistent observability safety gate",()=>{
  const files=["package.json","wrangler.jsonc",".env.example",".github/workflows/milestone-2-ci.yml",
    ".github/workflows/deploy-production.yml","extension/firefox/manifest.json","extension/firefox/src/content/kairos-bridge.ts"];
  it("rejects persistence, invocation metadata, and tracing regressions in isolated config fixtures",()=>{
    const fixture=mkdtempSync(join(tmpdir(),"kairos-ops-safety-"));
    try{
      mkdirSync(join(fixture,"src"));
      for(const file of files){mkdirSync(dirname(join(fixture,file)),{recursive:true});copyFileSync(resolve(file),join(fixture,file));}
      const base=JSON.parse(readFileSync(join(fixture,"wrangler.jsonc"),"utf8"));
      const verify=()=>spawnSync(process.execPath,[resolve("scripts/verify-production-safety.mjs")],{cwd:fixture,encoding:"utf8"});
      expect(verify().status).toBe(0);
      for(const patch of [{enabled:true},{logs:{enabled:false,persist:true,invocation_logs:false}},
        {logs:{enabled:false,persist:false,invocation_logs:true}},{traces:{enabled:true,persist:false}},
        {traces:{enabled:false,persist:true}},{redact_query_string:false}]){
        const config=structuredClone(base);
        config.env.production.observability={...base.observability,...patch};
        writeFileSync(join(fixture,"wrangler.jsonc"),JSON.stringify(config));
        expect(verify().status).toBe(1);
      }
    }finally{rmSync(fixture,{recursive:true,force:true});}
  });
});
