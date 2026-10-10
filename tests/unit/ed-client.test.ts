import { describe, expect, it, vi } from "vitest";
import { EdApiClient } from "@/lib/sources/ed/client";
import { EdSourceError } from "@/lib/sources/ed/errors";

const token="fixture-ed-token-never-echo";

describe("EdApiClient",()=>{
  it("uses receiver-free fetch with a Workers-compatible redirect",async()=>{
    const fetchImpl=function(this:unknown,_input:RequestInfo|URL,init?:RequestInit){
      if(this!==undefined)throw new TypeError("Illegal invocation");
      expect(init?.redirect).toBe("manual");
      return Promise.resolve(Response.json({user:{id:1}}));
    } as typeof fetch;
    await expect(new EdApiClient(token,fetchImpl).fetchUser()).resolves.toEqual({user:{id:1}});
  });

  it("fetches the current user from the fixed Ed API origin with bearer auth",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://us.edstem.org/api/user");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return new Response(JSON.stringify({user:{id:1},courses:[]}),{status:200,headers:{"content-type":"application/json"}});
    });
    const result=await new EdApiClient(token,fetchImpl as typeof fetch).fetchUser();
    expect(result).toEqual({user:{id:1},courses:[]});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches lessons only for a decimal course id",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>new Response(
      JSON.stringify({modules:[],lessons:[]}),
      {status:200,headers:{"content-type":"application/json"}},
    ));
    const client=new EdApiClient(token,fetchImpl as typeof fetch);
    await expect(client.fetchLessons("123")).resolves.toEqual({modules:[],lessons:[]});
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://us.edstem.org/api/courses/123/lessons");
    await expect(client.fetchLessons("../user")).rejects.toMatchObject({code:"ED_COURSE_UNAVAILABLE"});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401,"ED_AUTH_INVALID"],
    [403,"ED_AUTH_INVALID"],
    [429,"ED_RATE_LIMITED"],
    [404,"ED_UPSTREAM_ERROR"],
    [500,"ED_UPSTREAM_ERROR"],
  ] as const)("maps HTTP %i to %s without leaking the token",async(status,code)=>{
    const fetchImpl=vi.fn(async()=>new Response("private upstream body",{status}));
    const client=new EdApiClient(token,fetchImpl as typeof fetch);
    const error=await client.fetchUser().catch(value=>value);
    expect(error).toBeInstanceOf(EdSourceError);
    expect(error).toMatchObject({code});
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain("private upstream body");
    if(code==="ED_UPSTREAM_ERROR") expect(String(error)).toContain(`HTTP ${status}`);
  });

  it("maps network failures without leaking the token",async()=>{
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const fetchImpl=vi.fn(async()=>{throw new Error(`socket failed ${token}`);});
    try{
      const error=await new EdApiClient(token,fetchImpl as typeof fetch).fetchUser().catch(value=>value);
      expect(error).toBeInstanceOf(EdSourceError);
      expect(error).toMatchObject({code:"ED_NETWORK_ERROR"});
      expect(String(error)).not.toContain(token);
      expect(JSON.stringify(warning.mock.calls)).toContain('"reason":"transport"');
      expect(JSON.stringify(warning.mock.calls)).not.toContain(token);
    }finally{
      warning.mockRestore();
    }
  });

  it("distinguishes an Ed timeout from other request failures without logging tokens",async()=>{
    const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(AbortSignal.abort());
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try{
      const fetchImpl=vi.fn(async()=>{throw new Error(`timeout ${token}`);});
      const error=await new EdApiClient(token,fetchImpl as typeof fetch).fetchUser().catch(value=>value);
      expect(error).toMatchObject({code:"ED_NETWORK_ERROR"});
      expect(String(error)).toContain("15 seconds");
      const diagnostic=JSON.stringify(warning.mock.calls);
      expect(diagnostic).toContain('"reason":"timeout"');
      expect(diagnostic).not.toContain(token);
    }finally{
      timeout.mockRestore();
      warning.mockRestore();
    }
  });
});
