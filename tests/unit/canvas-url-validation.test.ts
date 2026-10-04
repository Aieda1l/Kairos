import { describe, expect, it } from "vitest";
import { validateCanvasFeedUrl } from "@/lib/sources/canvas-ical/validate-url";
describe("Canvas feed URL validation", () => {
  it("accepts HTTPS", () => expect(validateCanvasFeedUrl("https://canvas.example.edu/feeds/calendars/a.ics").protocol).toBe("https:"));
  it.each(["", "file:///etc/passwd", "ftp://example.com/a", "http://example.com/a", "https://user:pass@example.com/a"])("rejects %s", (value) => expect(() => validateCanvasFeedUrl(value)).toThrow());
  it("allows loopback HTTP only when explicit", () => expect(validateCanvasFeedUrl("http://127.0.0.1:3000/a", { allowLoopbackHttp: true }).hostname).toBe("127.0.0.1"));
});
