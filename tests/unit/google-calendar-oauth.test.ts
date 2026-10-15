import {describe,expect,it,vi} from "vitest";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  getGoogleCalendarConfig,
  refreshGoogleAccessToken,
} from "@/lib/calendar/google/oauth";
import {getOAuthRedirectUri} from "@/lib/calendar/local-oauth-origin";

describe("Google Calendar OAuth",()=>{
  it("uses only the exact configured production origin for Google callbacks",()=>{
    expect(getOAuthRedirectUri(
      "https://attacker.example/api/calendars/google/start",
      "/api/calendars/google/callback",
      {KAIROS_APP_URL:"https://mykairos.me"},
    )).toBe("https://mykairos.me/api/calendars/google/callback");
  });

  it.each([
    "http://mykairos.me",
    "https://www.mykairos.me",
    "https://mykairos.me.evil.example",
    "https://user:password@mykairos.me",
  ])("rejects unsafe configured production origin %s",appUrl=>{
    expect(()=>getOAuthRedirectUri(
      "https://mykairos.me/api/calendars/google/start",
      "/api/calendars/google/callback",
      {KAIROS_APP_URL:appUrl},
    )).toThrowError(expect.objectContaining({code:"CALENDAR_CONFIG_MISSING"}));
  });

  it("rejects protocol-relative callback paths and non-loopback unconfigured request hosts",()=>{
    expect(()=>getOAuthRedirectUri(
      "http://localhost:3000/api/calendars/google/start",
      "//evil.example/callback",
      {},
    )).toThrowError(expect.objectContaining({code:"CALENDAR_CONFIG_MISSING"}));
    expect(()=>getOAuthRedirectUri(
      "https://evil.example/api/calendars/google/start",
      "/api/calendars/google/callback",
      {},
    )).toThrowError(expect.objectContaining({code:"CALENDAR_CONFIG_MISSING"}));
  });

  it("uses the narrow app-created-calendar scope with offline PKCE authorization",()=>{
    const url=buildGoogleAuthorizationUrl({
      clientId:"fixture-google-client",
      state:"fixture-state",
      codeChallenge:"fixture-challenge",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
    });
    expect(url.origin+url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("fixture-google-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/calendars/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge")).toBe("fixture-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("code_verifier");
    expect(url.toString()).not.toContain("refresh");
  });

  it("requires local Google client configuration",()=>{
    expect(getGoogleCalendarConfig({GOOGLE_CALENDAR_CLIENT_ID:"client"})).toEqual({
      clientId:"client",
      clientSecret:null,
    });
    expect(getGoogleCalendarConfig({
      GOOGLE_CALENDAR_CLIENT_ID:"client",
      GOOGLE_CALENDAR_CLIENT_SECRET:"optional-secret",
    })).toEqual({clientId:"client",clientSecret:"optional-secret"});
    expect(()=>getGoogleCalendarConfig({})).toThrowError(expect.objectContaining({
      code:"CALENDAR_CONFIG_MISSING",
    }));
  });

  it("exchanges authorization codes only at the fixed Google token endpoint",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      const body=new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("fixture-code-never-echo");
      expect(body.get("code_verifier")).toBe("fixture-verifier-never-echo");
      return Response.json({
        access_token:"fixture-access",
        expires_in:3600,
        refresh_token:"fixture-refresh",
        token_type:"Bearer",
      });
    });
    await expect(exchangeGoogleAuthorizationCode({
      clientId:"client",
      clientSecret:null,
      code:"fixture-code-never-echo",
      codeVerifier:"fixture-verifier-never-echo",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
    },fetchMock as typeof fetch)).resolves.toEqual({
      accessToken:"fixture-access",
      expiresIn:3600,
      refreshToken:"fixture-refresh",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes tokens and preserves provider refresh-token rotation",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      const body=new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("fixture-old-refresh-never-echo");
      return Response.json({
        access_token:"fixture-new-access",
        expires_in:1800,
        refresh_token:"fixture-new-refresh",
      });
    });
    await expect(refreshGoogleAccessToken({
      clientId:"client",
      clientSecret:null,
      refreshToken:"fixture-old-refresh-never-echo",
    },fetchMock as typeof fetch)).resolves.toEqual({
      accessToken:"fixture-new-access",
      expiresIn:1800,
      refreshToken:"fixture-new-refresh",
    });
  });

  it.each([
    [401,{error:"invalid_grant"},"CALENDAR_AUTH_EXPIRED"],
    [400,{error:"invalid_grant"},"CALENDAR_AUTH_EXPIRED"],
    [429,{error:"rate_limited"},"CALENDAR_RATE_LIMITED"],
    [500,{error:"server_error"},"CALENDAR_UPSTREAM_ERROR"],
  ] as const)("maps HTTP %s without echoing code or refresh secrets",async(status,payload,code)=>{
    const secret="fixture-refresh-never-echo";
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}}));
    try{
      await refreshGoogleAccessToken({clientId:"client",clientSecret:null,refreshToken:secret},fetchMock as typeof fetch);
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code});
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });

  it("maps network failure without leaking authorization codes",async()=>{
    const secret="fixture-oauth-code-never-echo";
    const fetchMock=vi.fn(async()=>{throw new Error("socket failed "+secret);});
    await expect(exchangeGoogleAuthorizationCode({
      clientId:"client",clientSecret:null,code:secret,codeVerifier:"verifier",
      redirectUri:"http://localhost:3000/api/calendars/google/callback",
    },fetchMock as typeof fetch)).rejects.toMatchObject({code:"CALENDAR_NETWORK_ERROR"});
    try{
      await exchangeGoogleAuthorizationCode({
        clientId:"client",clientSecret:null,code:secret,codeVerifier:"verifier",
        redirectUri:"http://localhost:3000/api/calendars/google/callback",
      },fetchMock as typeof fetch);
    }catch(error){
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
