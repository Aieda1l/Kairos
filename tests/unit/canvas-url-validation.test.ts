import {afterEach,describe,expect,it,vi} from "vitest";
import { validateCanvasFeedUrl } from "@/lib/sources/canvas-ical/validate-url";
describe("Canvas feed URL validation", () => {
  afterEach(()=>vi.unstubAllEnvs());
  it("retains a UW private feed path and query",()=>{
    const raw="https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=synthetic-token";
    expect(validateCanvasFeedUrl(raw).href).toBe(raw);
  });
  it("accepts the standard HTTPS port and canonicalizes the UW hostname",()=>{
    expect(validateCanvasFeedUrl("https://CANVAS.UW.EDU:443/feeds/calendars/synthetic.ics").origin).toBe("https://canvas.uw.edu");
  });
  it.each([
    "", "file:///synthetic.ics", "ftp://canvas.uw.edu/a", "http://canvas.uw.edu/a",
    "https://user:pass@canvas.uw.edu/a", "https://canvas.other.example.invalid/a",
    "https://canvas.uw.edu.example.invalid/a", "https://sub.canvas.uw.edu/a",
    "https://canvas.uw.edu./a", "https://canvas.uw.edu:8443/a", "https://127.0.0.1/a",
    "http://127.0.0.1:3000/a",
  ])("rejects unsupported destination %s",value=>{
    expect(()=>validateCanvasFeedUrl(value)).toThrow(expect.objectContaining({code:"INVALID_FEED_URL"}));
  });
  it("does not waive the destination policy in fixture mode",()=>{
    vi.stubEnv("E2E_FIXTURES","1");
    expect(()=>validateCanvasFeedUrl("http://127.0.0.1:3000/a")).toThrow();
    expect(()=>validateCanvasFeedUrl("https://canvas.other.example.invalid/a")).toThrow();
  });
});
