import { expect, it, vi } from "vitest";
import { CanvasIcalSource } from "@/lib/sources/canvas-ical/source";
import { CanvasSourceError } from "@/lib/sources/canvas-ical/errors";
const feed=`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:event-assignment-1\nDTSTART:20261008T065900Z\nSUMMARY:HW [CSE 1]\nEND:VEVENT\nEND:VCALENDAR`;
it("tests and syncs a feed",async()=>{const source=new CanvasIcalSource(new URL("https://example.edu/a.ics"),async()=>new Response(feed,{status:200})); expect(await source.testConnection()).toEqual({ok:true,itemCount:1}); expect(await source.sync()).toHaveLength(1);});
it("can test and sync Canvas feeds when the upstream requires an identified User-Agent",async()=>{
  const upstream:typeof fetch=async(_input,init)=>{
    const headers=new Headers(init?.headers);
    const identified=/^Kairos\//.test(headers.get("user-agent")??"");
    return new Response(identified?feed:"Forbidden",{status:identified?200:403});
  };
  const source=new CanvasIcalSource(new URL("https://example.edu/a.ics"),upstream);
  expect(await source.testConnection()).toEqual({ok:true,itemCount:1});
  expect(await source.sync()).toHaveLength(1);
});
it("maps authorization failures",async()=>{const source=new CanvasIcalSource(new URL("https://example.edu/a.ics"),async()=>new Response("no",{status:403})); await expect(source.sync()).rejects.toMatchObject({code:"UNAUTHORIZED_OR_EXPIRED_FEED"} satisfies Partial<CanvasSourceError>);});

it.each([
  [401,"Copy a fresh feed URL"],
  [403,"hosting network"],
] as const)("reports Canvas HTTP %i without exposing its private feed URL",async(status,expected)=>{
  const feedUrl=new URL("https://canvas.uw.edu/feeds/private-secret.ics?token=hidden-feed-code");
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
  try{
    const error=await new CanvasIcalSource(feedUrl,async()=>new Response("private response body",{status})).sync().catch(e=>e);
    expect(error).toMatchObject({code:"UNAUTHORIZED_OR_EXPIRED_FEED"});
    expect(String(error)).toContain(expected);
    const diagnostic=JSON.stringify(warning.mock.calls);
    expect(diagnostic).toContain(`"status":${status}`);
    expect(diagnostic).not.toContain("private-secret");
    expect(diagnostic).not.toContain("hidden-feed-code");
    expect(diagnostic).not.toContain("private response body");
  }finally{
    warning.mockRestore();
  }
});
