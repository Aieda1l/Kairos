import {expect,it} from "vitest";import {redactError} from "@/lib/security/redact";
it("does not echo credential URLs from errors",()=>{const secret="https://canvas.example.edu/feeds/calendars/private-secret-token.ics";const rendered=JSON.stringify({code:"NETWORK_ERROR",message:redactError(new Error(`fetch failed ${secret}`),[secret])});expect(rendered).not.toContain("private-secret-token");});

it("does not echo Ed bearer tokens from errors",()=>{
  const token="fixture-ed-token-never-echo";
  const rendered=JSON.stringify({code:"ED_NETWORK_ERROR",message:redactError(new Error(`request failed Bearer ${token}`),[token])});
  expect(rendered).not.toContain(token);
});
