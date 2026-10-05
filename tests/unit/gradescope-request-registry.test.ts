import { describe, expect, it } from "vitest";
import { GradescopeRequestRegistry } from "@/lib/gradescope/request-registry";

describe("GradescopeRequestRegistry",()=>{
  it("consumes a registered discovery request once",()=>{
    const registry=new GradescopeRequestRegistry();
    registry.register({
      requestId:"11111111-1111-4111-8111-111111111111",
      kind:"discovery",
      connectionId:null,
      courseIds:[],
      startedAt:"2026-10-05T05:00:00.000Z",
    });
    expect(registry.consume("11111111-1111-4111-8111-111111111111",Date.parse("2026-10-05T05:09:59.000Z"))).toMatchObject({kind:"discovery"});
    expect(registry.consume("11111111-1111-4111-8111-111111111111",Date.parse("2026-10-05T05:10:00.000Z"))).toBeNull();
  });

  it("expires requests after ten minutes",()=>{
    const registry=new GradescopeRequestRegistry();
    registry.register({
      requestId:"22222222-2222-4222-8222-222222222222",
      kind:"discovery",
      connectionId:null,
      courseIds:[],
      startedAt:"2026-10-05T05:00:00.000Z",
    });
    expect(registry.consume("22222222-2222-4222-8222-222222222222",Date.parse("2026-10-05T05:10:00.001Z"))).toBeNull();
  });
});
