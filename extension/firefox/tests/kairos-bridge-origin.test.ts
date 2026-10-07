import {describe,expect,it} from "vitest";
import {
  KAIROS_BRIDGE_ORIGINS,
  isAllowedKairosOrigin,
} from "../src/content/kairos-bridge";

describe("Kairos page bridge origins",()=>{
  it("allows only local development and the canonical hosted origin",()=>{
    expect(KAIROS_BRIDGE_ORIGINS).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://mykairos.me",
    ]);
    for(const origin of KAIROS_BRIDGE_ORIGINS){
      expect(isAllowedKairosOrigin(origin)).toBe(true);
    }
  });

  it.each([
    "https://www.mykairos.me",
    "https://mykairos.me.evil.example",
    "https://evilmykairos.me",
    "http://mykairos.me",
    "https://mykairos.me:443.evil.example",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ])("rejects lookalike or non-approved origin %s",origin=>{
    expect(isAllowedKairosOrigin(origin)).toBe(false);
  });
});
