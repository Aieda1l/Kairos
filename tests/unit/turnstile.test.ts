import {afterEach,describe,expect,it,vi} from "vitest";
import {verifyTurnstile} from "@/lib/auth/turnstile";

const input={token:"fixture-token",expectedAction:"auth_google",expectedHostname:"mykairos.me"};
afterEach(()=>vi.useRealTimers());
describe("bounded server-side Turnstile verification",()=>{
  it.each([""," ","x".repeat(2049)])("rejects invalid token locally",async token=>{
    const fetchImpl=vi.fn<typeof fetch>();
    await expect(verifyTurnstile({...input,token},{secret:"fixture-secret",fetchImpl})).rejects.toMatchObject({code:"AUTH_CHALLENGE_FAILED"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([null,[],{}, {success:"true"}, {success:false,"error-codes":["invalid-input-response"]},
    {success:false,"error-codes":["timeout-or-duplicate"]},
    {success:true,hostname:"other.invalid",action:"auth_google"},
    {success:true,hostname:"mykairos.me",action:"auth_microsoft"}])("rejects unverified, forged, expired/spent or mismatched responses",async body=>{
    await expect(verifyTurnstile(input,{secret:"fixture-secret",fetchImpl:vi.fn(async()=>Response.json(body))})).rejects.toMatchObject({code:"AUTH_CHALLENGE_FAILED"});
  });
  it("uses a fixed endpoint, no redirects, no IP, and verifies every use",async()=>{
    const fetchImpl=vi.fn(async()=>Response.json({success:true,hostname:"mykairos.me",action:"auth_google"}));
    await verifyTurnstile(input,{secret:"fixture-secret",fetchImpl});
    await verifyTurnstile(input,{secret:"fixture-secret",fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url,options]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(options).toMatchObject({method:"POST",redirect:"manual",cache:"no-store"});
    expect(new URLSearchParams(String(options.body)).has("remoteip")).toBe(false);
  });
  it.each([async()=>{throw new Error("private transport");},async()=>new Response("invalid json"),async()=>new Response(null,{status:302})])
  ("fails closed on transport/JSON/HTTP failures without exposing details",async fetchImpl=>{
    await expect(verifyTurnstile(input,{secret:"fixture-secret",fetchImpl})).rejects.toMatchObject({code:"AUTH_CHALLENGE_UNAVAILABLE"});
  });
  it("aborts and finishes after five seconds even if a transport never settles",async()=>{
    vi.useFakeTimers();
    let signal:AbortSignal|undefined;
    const pending=verifyTurnstile(input,{secret:"fixture-secret",fetchImpl:vi.fn((_url,init)=>{
      signal=init?.signal as AbortSignal;return new Promise<Response>(()=>{});
    })});
    const rejected=expect(pending).rejects.toMatchObject({code:"AUTH_CHALLENGE_UNAVAILABLE"});
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });
});
