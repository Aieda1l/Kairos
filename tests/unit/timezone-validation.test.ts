import { expect,it } from "vitest";import { validateTimeZone } from "@/lib/dates/validate-timezone";
it("accepts IANA zones and rejects invalid zones",()=>{expect(validateTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");expect(()=>validateTimeZone("Pacific-ish")).toThrowError(/INVALID_TIMEZONE/);});
