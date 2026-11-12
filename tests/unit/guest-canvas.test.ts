import {afterEach,describe,expect,it,vi} from "vitest";
import {readGuestCanvas} from "@/lib/guest/sources/canvas";
import {guestCanvasFeedResponseSchema} from "@/lib/guest/sources/contracts";
import {GuestSourceError} from "@/lib/guest/sources/errors";
import {canvasEvent,canvasFeed,checkedAt,feedUrl,requestId,sourceContext,textResponse} from "../helpers/guest-source-fixtures";

const input={schemaVersion:1 as const,requestId,feedUrl};
afterEach(()=>vi.useRealTimers());
describe("bounded guest Canvas reader",()=>{
  it("serializes the Canvas output byte bound once",async()=>{
    const original=JSON.stringify;let outputSerializations=0;
    const stringify=vi.spyOn(JSON,"stringify").mockImplementation((...args:Parameters<typeof JSON.stringify>)=>{
      const value=args[0];
      if(value?.ok===true&&value.schemaVersion===1&&value.requestId===requestId&&value.checkedAt===checkedAt&&"assignments" in value)outputSerializations++;
      return original(...args);
    });
    try{await readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed([canvasEvent(1)]))));expect(outputSerializations).toBe(1);}finally{stringify.mockRestore();}
  });
  it("returns only normalized rows and report, replacing unsupported links with null",async()=>{
    const feed=canvasFeed([canvasEvent(1),canvasEvent(2,{url:"https://canvas.uw.edu/feeds/private.ics?token=never-echo"}),canvasEvent(3,{url:"http://canvas.uw.edu/courses/12/assignments/3"})]);
    const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(feed)));
    expect(guestCanvasFeedResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ok:true,schemaVersion:1,requestId,checkedAt,report:{skippedCount:0,malformedCount:0,partial:false}});
    expect(result.assignments.map(row=>row.sourceUrl)).toEqual(["https://canvas.uw.edu/courses/12/assignments/1",null,null]);
    expect(result.assignments.map(row=>row.externalId)).toEqual(["event-assignment-1","event-assignment-2","event-assignment-3"]);
    expect(JSON.stringify(result)).not.toContain("never-echo");
    expect(Object.keys(result).sort()).toEqual(["assignments","checkedAt","ok","report","requestId","schemaVersion"]);
  });
  it("rejects 5001 event blocks before parsing and 2001 assignments without truncating",async()=>{
    for(const [count,ordinary] of [[5001,true],[2001,false]] as const){
      await expect(readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed(Array.from({length:count},(_,i)=>canvasEvent(i+1,{ordinary}))))))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
    }
  });
  it("accepts 5000 ordinary events and 2000 assignments at their exact limits",async()=>{
    for(const [count,ordinary,expected] of [[5000,true,0],[2000,false,2000]] as const){
      const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed(Array.from({length:count},(_,i)=>canvasEvent(i+1,{ordinary}))))));
      expect(result.assignments).toHaveLength(expected);
    }
  });
  it("accepts marker text inside event values at the event limit",async()=>{
    const feed=canvasFeed(Array.from({length:5000},(_,i)=>canvasEvent(i+1,{ordinary:true}).replace("END:VEVENT","DESCRIPTION:literal BEGIN:VEVENT text\nEND:VEVENT")));
    const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(feed)));
    expect(result.assignments).toEqual([]);expect(result.report.skippedCount).toBe(5000);
  });
  it("rejects a feed containing only malformed assignments but accepts ordinary events",async()=>{
    await expect(readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed(["BEGIN:VEVENT\nUID:event-assignment-1\nEND:VEVENT"]))))).rejects.toMatchObject({code:"INVALID_ICAL"});
    expect((await readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed([canvasEvent(1,{ordinary:true})]))))).assignments).toEqual([]);
  });
  it("retains partial parse counts when a valid assignment survives",async()=>{
    const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed([canvasEvent(1),"BEGIN:VEVENT\nUID:event-assignment-2\nEND:VEVENT"]))));
    expect(result.assignments).toHaveLength(1);
    expect(result.report).toEqual({skippedCount:1,malformedCount:1,partial:true});
  });
  it.each(["\n","\r\n"])("reports an unterminated assignment after a valid sibling with %j lines",async newline=>{
    const feed=canvasFeed([canvasEvent(1),canvasEvent(2).replace("\nEND:VEVENT","")]).replaceAll("\n",newline);
    const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(feed)));
    expect(result.assignments.map(row=>row.externalId)).toEqual(["event-assignment-1"]);
    expect(result.report).toEqual({skippedCount:1,malformedCount:1,partial:true});
  });
  it.each([false,true])("rejects an unterminated assignment without a valid assignment (ordinary sibling: %s)",async ordinary=>{
    const events=ordinary?[canvasEvent(1,{ordinary:true})]:[];
    events.push(canvasEvent(2).replace("\nEND:VEVENT",""));
    await expect(readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed(events))))).rejects.toMatchObject({code:"INVALID_ICAL"});
  });
  it.each(["\n","\r\n"])("recovers valid siblings before and after a missing event end with %j lines",async newline=>{
    const feed=canvasFeed([canvasEvent(1),canvasEvent(2).replace("\nEND:VEVENT",""),canvasEvent(3)]).replaceAll("\n",newline);
    const result=await readGuestCanvas(input,sourceContext(async()=>textResponse(feed)));
    expect(result.assignments.map(row=>row.externalId)).toEqual(["event-assignment-1","event-assignment-3"]);
    expect(result.report).toEqual({skippedCount:1,malformedCount:1,partial:true});
  });
  it("bounds orphan event endings as structural records",async()=>{
    await expect(readGuestCanvas(input,sourceContext(async()=>textResponse(canvasFeed(Array(5001).fill("END:VEVENT")))))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it.each([undefined,"1"])("enforces actual bytes with Content-Length %s",async length=>{
    await expect(readGuestCanvas(input,sourceContext(async()=>textResponse("x".repeat(2*1024*1024+1),length?{"content-length":length}:{})))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it.each(["https://canvas.uw.edu:8443/feed.ics","http://canvas.uw.edu/feed.ics","https://elsewhere.invalid/feed.ics"])("rejects unsupported initial destination %s",async url=>{
    const fetchImpl=vi.fn(async()=>new Response());
    await expect(readGuestCanvas({...input,feedUrl:url},sourceContext(fetchImpl))).rejects.toMatchObject({code:"INVALID_FEED_URL"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("checks provider state at every allowed redirect and rejects redirect escapes",async()=>{
    const requests:string[]=[];let checks=0;
    const context=sourceContext(async url=>{requests.push(String(url));return new Response(null,{status:302,headers:{location:requests.length===1?"./second.ics":"https://elsewhere.invalid/private"}});});
    context.assertProviderCurrent=async()=>{checks++;};
    await expect(readGuestCanvas(input,context)).rejects.toMatchObject({code:"INVALID_FEED_URL"});
    expect(requests).toEqual([feedUrl,"https://canvas.uw.edu/feeds/calendars/second.ics"]);
    expect(checks).toBe(2);
  });
  it("bounds redirect loops and never waits for stalled redirect cancellation",async()=>{
    const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({cancel:()=>new Promise(()=>{})}),{status:302,headers:{location:"./loop.ics"}}));
    await expect(readGuestCanvas(input,sourceContext(fetchImpl))).rejects.toMatchObject({code:"NETWORK_ERROR"});
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(6);
  });
  it("preserves provider protection failure as SERVICE_UNAVAILABLE before dispatch and publication",async()=>{
    for(const failAt of [1,2]){
      let checks=0;const fetchImpl=vi.fn(async()=>textResponse(canvasFeed([canvasEvent(1)])));
      const context=sourceContext(fetchImpl);context.assertProviderCurrent=async()=>{if(++checks===failAt)throw new Error("private storage failure");};
      await expect(readGuestCanvas(input,context)).rejects.toMatchObject({code:"SERVICE_UNAVAILABLE"});
      expect(fetchImpl.mock.calls.length).toBe(failAt-1);
    }
  });
  it("uses one 15-second deadline for redirects and stalled body reads",async()=>{
    vi.useFakeTimers();let calls=0;const signals:AbortSignal[]=[];
    const context=sourceContext(async(_url,init)=>{signals.push(init!.signal!);calls++;if(calls===1){await new Promise(resolve=>setTimeout(resolve,10_000));return new Response(null,{status:302,headers:{location:"./second.ics"}});}return new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})}));});
    const pending=readGuestCanvas(input,context).catch(error=>error);
    await vi.advanceTimersByTimeAsync(15_000);expect(await pending).toMatchObject({code:"NETWORK_ERROR"});
    expect(signals).toHaveLength(2);expect(signals[0]).toBe(signals[1]);expect(signals[0].aborted).toBe(true);
  });
  it("does not dispatch after a provider guard resolves past the deadline",async()=>{
    vi.useFakeTimers();let release!:()=>void;const fetchImpl=vi.fn(async()=>textResponse(canvasFeed([canvasEvent(1)])));
    const context=sourceContext(fetchImpl);context.assertProviderCurrent=()=>new Promise(resolve=>{release=resolve;});
    const pending=readGuestCanvas(input,context).catch(error=>error);
    await vi.advanceTimersByTimeAsync(15_000);expect(await pending).toMatchObject({code:"NETWORK_ERROR"});release();await Promise.resolve();await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("discards and cancels a fetch response that arrives after the deadline",async()=>{
    vi.useFakeTimers();let release!:(response:Response)=>void;let cancelled=false;
    const fetchImpl=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;}));
    const pending=readGuestCanvas(input,sourceContext(fetchImpl)).catch(error=>error);
    await vi.advanceTimersByTimeAsync(15_000);expect(await pending).toMatchObject({code:"NETWORK_ERROR"});
    release(new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}),{status:302,headers:{location:"./late.ics"}}));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);expect(cancelled).toBe(true);
  });
  it("checks elapsed time after synchronous parsing",async()=>{
    vi.useFakeTimers();const context=sourceContext(async()=>textResponse(canvasFeed([canvasEvent(1)])));
    const original=Date.prototype.toISOString;let parsed=false;
    const serialize=vi.spyOn(Date.prototype,"toISOString").mockImplementation(function(this:Date){parsed=true;vi.setSystemTime(Date.now()+15_000);return original.call(this);});
    try{await expect(readGuestCanvas(input,context)).rejects.toMatchObject({code:"NETWORK_ERROR"});expect(parsed).toBe(true);}finally{serialize.mockRestore();}
  });
  it("maps all provider guard failures to SERVICE_UNAVAILABLE",async()=>{
    const context=sourceContext(async()=>textResponse(canvasFeed([canvasEvent(1)])));
    context.assertProviderCurrent=async()=>{throw new GuestSourceError("RATE_LIMITED");};
    await expect(readGuestCanvas(input,context)).rejects.toMatchObject({code:"SERVICE_UNAVAILABLE"});
  });
  it("rejects normalized escaped Canvas output above the byte cap",async()=>{
    const feed=canvasFeed(Array.from({length:2000},(_,i)=>canvasEvent(i+1,{title:`${'"'.repeat(500)} [${'"'.repeat(240)}]`})));
    expect(new TextEncoder().encode(feed).length).toBeLessThan(2*1024*1024);
    await expect(readGuestCanvas(input,sourceContext(async()=>textResponse(feed)))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it("cancels an HTTP error body without awaiting stalled cleanup",async()=>{
    let cancelled=false;
    const context=sourceContext(async()=>new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}),{status:403}));
    await expect(readGuestCanvas(input,context)).rejects.toMatchObject({code:"UNAUTHORIZED_OR_EXPIRED_FEED"});
    expect(cancelled).toBe(true);
  });
});
