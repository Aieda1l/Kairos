import {expect,it} from "vitest";import {redactError} from "@/lib/security/redact";
it("does not echo credential URLs from errors",()=>{const secret="https://canvas.example.edu/feeds/calendars/private-secret-token.ics";const rendered=JSON.stringify({code:"NETWORK_ERROR",message:redactError(new Error(`fetch failed ${secret}`),[secret])});expect(rendered).not.toContain("private-secret-token");});
