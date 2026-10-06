import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {
  consumeOAuthRequest,
  registerOAuthRequest,
  resetOAuthRequestRegistryForTests,
} from "@/lib/calendar/oauth-registry";
import {getLocalOAuthRedirectUri} from "@/lib/calendar/local-oauth-origin";

function challenge(verifier:string){
  return createHash("sha256").update(verifier).digest("base64url");
}

beforeEach(()=>resetOAuthRequestRegistryForTests());

describe("calendar oauth request registry",()=>{
  it("uses S256 PKCE and keeps the verifier server-side",()=>{
    const created=registerOAuthRequest({
      provider:"google",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
      returnTo:"/sources",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(created.state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const stored=consumeOAuthRequest(created.state,"google",new Date("2026-10-06T00:05:00.000Z"))!;
    expect(created.codeChallenge).toBe(challenge(stored.codeVerifier));
    expect(created.codeChallenge).not.toContain(stored.codeVerifier);
  });

  it("survives server module re-evaluation within the same process",async()=>{
    const first=await import("@/lib/calendar/oauth-registry");
    const created=first.registerOAuthRequest({
      provider:"microsoft",
      redirectUri:"http://localhost:3000/api/calendars/microsoft/callback",
    },new Date("2026-10-06T00:00:00.000Z"));

    vi.resetModules();
    const reloaded=await import("@/lib/calendar/oauth-registry");
    expect(reloaded.consumeOAuthRequest(
      created.state,
      "microsoft",
      new Date("2026-10-06T00:01:00.000Z"),
    )).not.toBeNull();
    reloaded.resetOAuthRequestRegistryForTests();
  });

  it("is one-time, provider-bound, and expires after about ten minutes",()=>{
    const replay=registerOAuthRequest({
      provider:"microsoft",
      redirectUri:"http://localhost:3000/api/calendars/microsoft/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(consumeOAuthRequest(replay.state,"google",new Date("2026-10-06T00:01:00.000Z"))).toBeNull();
    expect(consumeOAuthRequest(replay.state,"microsoft",new Date("2026-10-06T00:02:00.000Z"))).not.toBeNull();
    expect(consumeOAuthRequest(replay.state,"microsoft",new Date("2026-10-06T00:03:00.000Z"))).toBeNull();

    const expired=registerOAuthRequest({
      provider:"google",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(consumeOAuthRequest(expired.state,"google",new Date("2026-10-06T00:10:01.000Z"))).toBeNull();
  });
});

describe("local oauth redirect origins",()=>{
  it("accepts only HTTP localhost and 127.0.0.1",()=>{
    expect(getLocalOAuthRedirectUri(
      "http://127.0.0.1:3000/api/calendars/google/start",
      "/api/calendars/google/callback",
    )).toBe("http://127.0.0.1:3000/api/calendars/google/callback");
    expect(getLocalOAuthRedirectUri(
      "http://localhost:3000/api/calendars/microsoft/start",
      "/api/calendars/microsoft/callback",
    )).toBe("http://localhost:3000/api/calendars/microsoft/callback");

    for(const unsafe of [
      "https://evil.example/api/calendars/google/start",
      "http://localhost.evil.example:3000/api/calendars/google/start",
      "http://user:pass@localhost:3000/api/calendars/google/start",
      "https://localhost:3000/api/calendars/google/start",
    ]){
      expect(()=>getLocalOAuthRedirectUri(unsafe,"/api/calendars/google/callback")).toThrow();
    }
  });
});
