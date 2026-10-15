import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("@/lib/platform/source-api-runtime",()=>({
  resolveSourceApiRuntime:vi.fn(async()=>({
    ok:false as const,
    response:Response.json({
      code:"AUTH_REQUIRED",
      message:"Authentication required.",
    },{status:401}),
  })),
}));

afterEach(()=>vi.unstubAllGlobals());

describe("unauthenticated source connection probes",()=>{
  it.each([
    {
      provider:"Canvas",
      route:()=>import("@/app/api/sources/canvas/test/route"),
      payload:{feedUrl:"https://canvas.example.edu/calendar.ics"},
    },
    {
      provider:"Ed",
      route:()=>import("@/app/api/sources/ed/test/route"),
      payload:{token:"example-ed-token"},
    },
  ])("rejects $provider without sending a provider request",async ({route,payload})=>{
    const providerFetch=vi.fn(async()=>new Response("unexpected fetch",{status:200}));
    vi.stubGlobal("fetch",providerFetch);

    const {POST}=await route();
    const response=await POST(new Request("https://mykairos.me/api/sources/test",{
      method:"POST",
      body:JSON.stringify(payload),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({code:"AUTH_REQUIRED"});
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
