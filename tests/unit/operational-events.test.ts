import {afterEach,describe,expect,it,vi} from "vitest";
import {createOperationContext,runWithOperationContext,getOperationContext} from "@/lib/operations/context";
import {emitOperationEvent,type OperationCode} from "@/lib/operations/events";

afterEach(()=>vi.restoreAllMocks());
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("structured operation events",()=>{
  it("generates fresh correlation IDs and bounds release metadata to SHA/version values",()=>{
    const first=createOperationContext("source.sync","71e0095");
    expect(first).toEqual({requestId:expect.stringMatching(uuid),action:"source.sync",releaseId:"71e0095"});
    expect(createOperationContext("source.sync").requestId).not.toBe(first.requestId);
    expect(createOperationContext("health.check","v1.2.3").releaseId).toBe("v1.2.3");
    for(const value of ["user@example.invalid","https://private.invalid/?token=secret","a".repeat(41),"1.2.3-private"]){
      expect(createOperationContext("health.check",value).releaseId).toBe("unknown");
    }
    expect(()=>createOperationContext("private-action" as never)).toThrow("Invalid operation action");
  });

  it.each([
    ["AUTH_SIGNED_IN","ok"],["AUTH_REJECTED","rejected"],["CREDENTIAL_CONNECTED","ok"],
    ["CREDENTIAL_TESTED","ok"],["CREDENTIAL_REJECTED","rejected"],["SOURCE_SYNCED","ok"],
    ["CALENDAR_SYNCED","ok"],["RATE_LIMITED","rejected"],["SERVICE_UNAVAILABLE","error"],["HEALTH_OK","ok"],
  ] as const)("emits one allowlisted event for %s",(code,result)=>{
    const info=vi.spyOn(console,"info").mockImplementation(()=>{});
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const context=createOperationContext("health.check","0.1.0");
    emitOperationEvent(context,{code,result,provider:"canvas",status:200,durationMs:12.8});
    const calls=[...info.mock.calls,...warn.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(JSON.parse(calls[0][0] as string)).toEqual({
      event:"kairos.operation",schemaVersion:1,...context,code,result,provider:"canvas",status:200,durationMs:12,
    });
  });

  it("never traverses unknown fields, getters, toJSON, or raw runtime objects",()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const sentinels=["email-sentinel@example.invalid","token-sentinel","https://private.invalid/feed?key=feed-sentinel",
      "assignment-sentinel","<html>html-sentinel</html>","exception-sentinel","?code=query-sentinel","cookie=header-sentinel"];
    const bomb=()=>{throw new Error("getter-sentinel");};
    const context={...createOperationContext("source.sync"),runtime:{sentinels,toJSON:bomb}};
    const outcome={code:"UPSTREAM_HTTP_ERROR",result:"error",provider:"ed",status:503,details:sentinels,error:new Error(sentinels.join(" ")),toJSON:bomb};
    Object.defineProperty(outcome,"unknown",{get:bomb});
    emitOperationEvent(context,outcome as never);
    expect(warn).toHaveBeenCalledTimes(1);
    const serialized=warn.mock.calls[0][0] as string;
    for(const sentinel of sentinels)expect(serialized).not.toContain(sentinel);
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual([
      "action","code","event","provider","releaseId","requestId","result","schemaVersion","status",
    ]);
  });

  it("drops malformed required enums and IDs without logging their values",()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const context=createOperationContext("auth.callback");
    for(const malformed of [null,{}, {...context,requestId:"private-id"},{...context,action:"private-action"},
      {...context,releaseId:"private-release"},new Proxy(context,{getOwnPropertyDescriptor(){throw new Error("private-proxy");}})]){
      expect(()=>emitOperationEvent(malformed as never,{code:"AUTH_FAILED",result:"error"})).not.toThrow();
    }
    for(const outcome of [{code:"private-code",result:"error"},{code:"AUTH_FAILED",result:"private-result"},null]){
      emitOperationEvent(context,outcome as never);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([NaN,Infinity,-1,0,99,600,200.5,"401",{toJSON:()=>"private"}])("omits invalid status %s",status=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    emitOperationEvent(createOperationContext("auth.callback"),{
      code:"AUTH_FAILED",result:"error",status,provider:"private-provider",durationMs:Infinity,
    } as never);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).not.toHaveProperty("status");
    expect(JSON.parse(warn.mock.calls[0][0] as string)).not.toHaveProperty("provider");
    expect(JSON.parse(warn.mock.calls[0][0] as string)).not.toHaveProperty("durationMs");
  });

  it("bounds duration and ignores accessor fields rather than invoking them",()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const outcome={code:"AUTH_FAILED" as OperationCode,result:"error" as const,durationMs:86_400_001};
    Object.defineProperty(outcome,"status",{get(){throw new Error("private getter");}});
    emitOperationEvent(createOperationContext("auth.callback"),outcome);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).not.toHaveProperty("durationMs");
  });
});

describe("request-local operation context",()=>{
  it("records only one terminal outcome across a scoped wrapper and its nested resolver",async()=>{
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const info=vi.spyOn(console,"info").mockImplementation(()=>{});
    const context=createOperationContext("auth.callback");
    await runWithOperationContext(context,async()=>{
      // Invalid events must not consume the terminal-event slot.
      emitOperationEvent(context,{code:"private" as never,result:"error"});
      await runWithOperationContext(getOperationContext()!,async()=>{
        emitOperationEvent(getOperationContext()!,{code:"AUTH_REJECTED",result:"rejected"});
      });
      emitOperationEvent(context,{code:"AUTH_FAILED",result:"error"});
      emitOperationEvent(context,{code:"AUTH_SIGNED_IN",result:"ok"});
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({code:"AUTH_REJECTED"});
  });

  it("isolates interleaved work, restores nested context, and clears after rejection",async()=>{
    const a=createOperationContext("source.sync");
    const b=createOperationContext("calendar.sync");
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const first=runWithOperationContext(a,async()=>{
      await gate;
      expect(getOperationContext()).toEqual(a);
      await runWithOperationContext(b,async()=>expect(getOperationContext()).toEqual(b));
      expect(getOperationContext()).toEqual(a);
    });
    await runWithOperationContext(b,async()=>{
      expect(getOperationContext()).toEqual(b);
      release();
      await first;
      expect(getOperationContext()).toEqual(b);
    });
    expect(getOperationContext()).toBeNull();
    await expect(runWithOperationContext(a,async()=>{throw new Error("fixture");})).rejects.toThrow("fixture");
    expect(getOperationContext()).toBeNull();
  });

  it("stores only a frozen allowlisted snapshot and does not retain supplied metadata",async()=>{
    const input={...createOperationContext("source.sync"),session:{email:"private"}};
    await runWithOperationContext(input,async()=>{
      input.action="calendar.sync";
      expect(getOperationContext()).toMatchObject({action:"source.sync"});
      expect(getOperationContext()).not.toHaveProperty("session");
      expect(Object.isFrozen(getOperationContext())).toBe(true);
    });
    await expect(runWithOperationContext({requestId:"private"} as never,async()=>{})).rejects.toThrow("Invalid operation context");
  });
});
