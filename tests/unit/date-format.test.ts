import { expect,it } from "vitest";import { formatDueDate } from "@/lib/dates/format";
it("formats due times in the configured timezone",()=>{expect(formatDueDate("2026-10-08T06:59:00.000Z","America/Los_Angeles")).toContain("11:59 PM");expect(formatDueDate(null)).toBe("No due date");});
