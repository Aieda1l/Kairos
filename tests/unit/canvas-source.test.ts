import { expect, it } from "vitest";
import { CanvasIcalSource } from "@/lib/sources/canvas-ical/source";
import { CanvasSourceError } from "@/lib/sources/canvas-ical/errors";
const feed=`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:event-assignment-1\nDTSTART:20261008T065900Z\nSUMMARY:HW [CSE 1]\nEND:VEVENT\nEND:VCALENDAR`;
it("tests and syncs a feed",async()=>{const source=new CanvasIcalSource(new URL("https://example.edu/a.ics"),async()=>new Response(feed,{status:200})); expect(await source.testConnection()).toEqual({ok:true,itemCount:1}); expect(await source.sync()).toHaveLength(1);});
it("maps authorization failures",async()=>{const source=new CanvasIcalSource(new URL("https://example.edu/a.ics"),async()=>new Response("no",{status:403})); await expect(source.sync()).rejects.toMatchObject({code:"UNAUTHORIZED_OR_EXPIRED_FEED"} satisfies Partial<CanvasSourceError>);});
