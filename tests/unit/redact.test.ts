import { describe, expect, it } from "vitest";
import { redactError, redactSecret } from "@/lib/security/redact";
describe("redaction", () => {
  it("never returns a complete secret URL", () => {
    const secret = "https://canvas.example.edu/feeds/calendars/private-token.ics?token=abc";
    const redacted = redactSecret(secret);
    expect(redacted).toContain("canvas.example.edu");
    expect(redacted).not.toContain("private-token");
    expect(redacted).not.toContain("abc");
  });
  it("removes known secrets from errors", () => {
    const secret = "secret-token";
    expect(redactError(new Error(`failed ${secret}`), [secret])).not.toContain(secret);
  });
});
