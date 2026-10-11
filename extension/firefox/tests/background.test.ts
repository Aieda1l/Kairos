import { afterEach, describe, expect, it, vi } from "vitest";
import { kairosBridgeResponseV1Schema } from "@/lib/extension-protocol/bridge";

afterEach(()=>{
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("production background PONG",()=>{
  it.each([
    [true,false],[false,true],[false,false],[true,true],
  ])("retains source-tab presence (%s, %s) without the installed version",async(canvasPresent,gradescopePresent)=>{
    const installedVersion="97.42.11-INSTALLED_VERSION_SENTINEL";
    let listener:((message:unknown)=>Promise<unknown>)|undefined;
    vi.resetModules();
    vi.stubGlobal("browser",{
      runtime:{
        getManifest:()=>({version:installedVersion}),
        onMessage:{addListener:(callback:typeof listener)=>{listener=callback;}},
      },
      tabs:{
        query:async({url}:{url:string})=>{
          if(url==="https://canvas.uw.edu/*")return canvasPresent?[{id:7}]:[];
          if(url==="https://www.gradescope.com/*")return gradescopePresent?[{id:9}]:[];
          return [];
        },
        sendMessage:()=>{throw new Error("PING must not fetch coursework");},
      },
    });
    // Import the production entry point and invoke its actual registered listener and broker.
    await import("../src/background");
    expect(listener).toBeTypeOf("function");
    const requestId="11111111-1111-4111-8111-111111111111";
    const pong=kairosBridgeResponseV1Schema.parse(await listener!({
      source:"kairos-page",type:"PING",protocolVersion:1,requestId,
    }));
    expect(pong).toMatchObject({
      source:"kairos-extension",type:"PONG",protocolVersion:1,requestId,
      canvasTabDetected:canvasPresent,gradescopeTabDetected:gradescopePresent,
    });
    expect(JSON.stringify(pong)).not.toContain(installedVersion);
    expect(pong).toEqual({
      source:"kairos-extension",type:"PONG",protocolVersion:1,requestId,
      extensionVersion:"not-shared",canvasTabDetected:canvasPresent,gradescopeTabDetected:gradescopePresent,
    });
  });
});
