import {describe,expect,it,vi} from "vitest";
import {fetchCanvasFeed} from "@/lib/sources/canvas-ical/fetch-feed";

const initial=new URL("https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=synthetic-token");
const body="BEGIN:VCALENDAR\nEND:VCALENDAR";

describe("Canvas destination enforcement at the fetch boundary",()=>{
  it.each([
    "https://unsupported.example.invalid/feed.ics", "https://canvas.uw.edu:8443/feed.ics",
    "http://canvas.uw.edu/feed.ics", "https://user:password@canvas.uw.edu/feed.ics",
  ])("rejects %s before invoking transport",async raw=>{
    const transport=vi.fn(async()=>new Response(body));
    await expect(fetchCanvasFeed(new URL(raw),transport)).rejects.toMatchObject({code:"INVALID_FEED_URL"});
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    "https://unsupported.example.invalid/feed.ics", "//unsupported.example.invalid/feed.ics",
    "http://canvas.uw.edu/feed.ics", "https://canvas.uw.edu:8443/feed.ics",
    "https://user:password@canvas.uw.edu/feed.ics",
  ])("rejects redirect escape %s without requesting it",async location=>{
    const requests:string[]=[];
    const transport:typeof fetch=async(input,init)=>{
      requests.push(String(input));
      expect(init?.redirect).toBe("manual");
      return new Response(null,{status:302,headers:{location}});
    };
    await expect(fetchCanvasFeed(initial,transport)).rejects.toMatchObject({code:"INVALID_FEED_URL"});
    expect(requests).toEqual([initial.href]);
  });
  it.each([301,302,303,307,308])("retains headers and follows an allowed same-origin %i redirect",async status=>{
    const requests:string[]=[];const signals:AbortSignal[]=[];
    const transport:typeof fetch=async(input,init)=>{
      requests.push(String(input));
      expect(init?.redirect).toBe("manual");expect(init?.cache).toBe("no-store");
      expect(new Headers(init?.headers).get("user-agent")).toBe("Kairos/0.1 (+https://mykairos.me)");
      expect(new Headers(init?.headers).get("accept")).toContain("text/calendar");
      expect(init?.signal).toBeInstanceOf(AbortSignal);signals.push(init!.signal!);
      return requests.length===1?new Response(null,{status,headers:{location:"./redirected.ics?token=synthetic-redirect"}}):new Response(body);
    };
    expect(await fetchCanvasFeed(initial,transport)).toBe(body);
    expect(requests).toEqual([initial.href,"https://canvas.uw.edu/feeds/calendars/redirected.ics?token=synthetic-redirect"]);
    expect(signals[1]).toBe(signals[0]);
  });
  it("validates each hop even after a permitted redirect",async()=>{
    const requests:string[]=[];
    const transport:typeof fetch=async(input)=>{
      requests.push(String(input));
      return new Response(null,{status:302,headers:{location:requests.length===1?"./second.ics":"https://unsupported.example.invalid/forbidden"}});
    };
    await expect(fetchCanvasFeed(initial,transport)).rejects.toMatchObject({code:"INVALID_FEED_URL"});
    expect(requests).toEqual([initial.href,"https://canvas.uw.edu/feeds/calendars/second.ics"]);
  });
  it("bounds a same-origin redirect loop",async()=>{
    const transport=vi.fn(async()=>new Response(null,{status:302,headers:{location:"./synthetic.ics"}}));
    await expect(fetchCanvasFeed(initial,transport)).rejects.toMatchObject({code:"NETWORK_ERROR"});
    expect(transport.mock.calls.length).toBeGreaterThan(1);
    expect(transport.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
