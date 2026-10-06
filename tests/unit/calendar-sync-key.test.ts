import {describe,expect,it} from "vitest";
import {createCalendarSyncKey} from "@/lib/calendar/sync-key";

describe("calendar sync key",()=>{
  it("is stable lowercase sha256 hex for one destination assignment pair",()=>{
    const first=createCalendarSyncKey("connection-1","assignment-1");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(createCalendarSyncKey("connection-1","assignment-1")).toBe(first);
    expect(createCalendarSyncKey("connection-2","assignment-1")).not.toBe(first);
    expect(createCalendarSyncKey("connection-1","assignment-2")).not.toBe(first);
  });
});
