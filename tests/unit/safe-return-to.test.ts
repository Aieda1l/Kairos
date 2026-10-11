import {describe,expect,it} from "vitest";
import {safeReturnTo} from "@/lib/auth/return-to";

describe("safeReturnTo",()=>{
  it.each([
    ["/upcoming","/upcoming"],
    ["/sources?tab=calendar","/sources?tab=calendar"],
    ["/assignments#due-soon","/assignments#due-soon"],
  ])("keeps safe application target %s",(input,expected)=>{
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/%2f%2fevil.example/path",
    "/%252f%252fevil.example/path",
    "\\\\evil.example/path",
    "/%5c%5cevil.example/path",
    "javascript:alert(1)",
    "mailto:student@example.com",
  ])("falls back for unsafe target %s",input=>{
    expect(safeReturnTo(input)).toBe("/upcoming");
  });

  it("supports a caller-provided fallback",()=>{
    expect(safeReturnTo(null,"/sources")).toBe("/sources");
  });
});
