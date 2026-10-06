import {describe,expect,it,vi} from "vitest";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {
  buildMicrosoftAuthorizationUrl,
  exchangeMicrosoftAuthorizationCode,
  getMicrosoftCalendarConfig,
  refreshMicrosoftAccessToken,
} from "@/lib/calendar/microsoft/oauth";

describe("Microsoft Calendar OAuth",()=>{
  it("uses the public-client PKCE flow with only offline calendar write scopes",()=>{
    const url=buildMicrosoftAuthorizationUrl({
      clientId:"fixture-ms-client",
      tenant:"common",
      state:"fixture-state",
      codeChallenge:"fixture-challenge",
      redirectUri:"http://127.0.0.1:3000/api/calendars/microsoft/callback",
    });
    expect(url.origin+url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("fixture-ms-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/calendars/microsoft/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("offline_access Calendars.ReadWrite");
    expect(url.searchParams.get("state")).toBe("fixture-state");
    expect(url.searchParams.get("code_challenge")).toBe("fixture-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("User.Read");
    expect(url.toString()).not.toMatch(/Mail\.|Files\.|Contacts\./);
    expect(url.toString()).not.toContain("client_secret");
    expect(url.toString()).not.toContain("code_verifier");
  });

  it("requires a client id and defaults the tenant to common",()=>{
    expect(getMicrosoftCalendarConfig({MICROSOFT_CALENDAR_CLIENT_ID:"client"})).toEqual({
      clientId:"client",
      clientSecret:null,
      tenant:"common",
    });
    expect(getMicrosoftCalendarConfig({
      MICROSOFT_CALENDAR_CLIENT_ID:"client",
      MICROSOFT_CALENDAR_TENANT:"organizations",
    })).toEqual({clientId:"client",clientSecret:null,tenant:"organizations"});
    expect(getMicrosoftCalendarConfig({
      MICROSOFT_CALENDAR_CLIENT_ID:"client",
      MICROSOFT_CALENDAR_CLIENT_SECRET:"hosted-secret",
      MICROSOFT_CALENDAR_TENANT:"organizations",
    })).toEqual({clientId:"client",clientSecret:"hosted-secret",tenant:"organizations"});
    expect(()=>getMicrosoftCalendarConfig({})).toThrowError(expect.objectContaining({
      code:"CALENDAR_CONFIG_MISSING",
    }));
  });

  it("exchanges authorization codes at the configured fixed Microsoft tenant endpoint",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
      expect(init?.method).toBe("POST");
      const body=new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe("client");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("scope")).toBe("offline_access Calendars.ReadWrite");
      expect(body.get("code")).toBe("fixture-code-never-echo");
      expect(body.get("code_verifier")).toBe("fixture-verifier-never-echo");
      expect(body.has("client_secret")).toBe(false);
      return Response.json({
        access_token:"fixture-access",
        expires_in:3600,
        refresh_token:"fixture-refresh",
        token_type:"Bearer",
      });
    });
    await expect(exchangeMicrosoftAuthorizationCode({
      clientId:"client",
      tenant:"common",
      code:"fixture-code-never-echo",
      codeVerifier:"fixture-verifier-never-echo",
      redirectUri:"http://127.0.0.1:3000/api/calendars/microsoft/callback",
    },fetchMock as typeof fetch)).resolves.toEqual({
      accessToken:"fixture-access",
      expiresIn:3600,
      refreshToken:"fixture-refresh",
    });
  });

  it("sends a confidential client secret for hosted token redemption when configured",async()=>{
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const body=new URLSearchParams(String(init?.body));
      expect(body.get("client_secret")).toBe("hosted-secret");
      expect(body.get("code_verifier")).toBe("fixture-verifier");
      return Response.json({
        access_token:"fixture-access",
        expires_in:3600,
        refresh_token:"fixture-refresh",
      });
    });
    await exchangeMicrosoftAuthorizationCode({
      clientId:"client",
      clientSecret:"hosted-secret",
      tenant:"common",
      code:"fixture-code",
      codeVerifier:"fixture-verifier",
      redirectUri:"https://mykairos.me/api/calendars/microsoft/callback",
    },fetchMock as typeof fetch);
  });

  it("refreshes tokens and preserves provider refresh-token rotation",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
      const body=new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("fixture-old-refresh-never-echo");
      expect(body.get("scope")).toBe("offline_access Calendars.ReadWrite");
      return Response.json({
        access_token:"fixture-new-access",
        expires_in:1800,
        refresh_token:"fixture-new-refresh",
      });
    });
    await expect(refreshMicrosoftAccessToken({
      clientId:"client",
      tenant:"common",
      refreshToken:"fixture-old-refresh-never-echo",
    },fetchMock as typeof fetch)).resolves.toEqual({
      accessToken:"fixture-new-access",
      expiresIn:1800,
      refreshToken:"fixture-new-refresh",
    });
  });

  it.each([
    [400,{error:"invalid_grant"},"CALENDAR_AUTH_EXPIRED"],
    [401,{error:"invalid_client"},"CALENDAR_AUTH_EXPIRED"],
    [429,{error:"temporarily_unavailable"},"CALENDAR_RATE_LIMITED"],
    [500,{error:"server_error"},"CALENDAR_UPSTREAM_ERROR"],
  ] as const)("maps HTTP %s without echoing refresh secrets",async(status,payload,code)=>{
    const secret="fixture-ms-refresh-never-echo";
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}}));
    try{
      await refreshMicrosoftAccessToken({
        clientId:"client",
        tenant:"common",
        refreshToken:secret,
      },fetchMock as typeof fetch);
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code});
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("maps network failure without leaking authorization codes",async()=>{
    const secret="fixture-ms-code-never-echo";
    const fetchMock=vi.fn(async()=>{throw new Error("socket failed "+secret);});
    try{
      await exchangeMicrosoftAuthorizationCode({
        clientId:"client",tenant:"common",code:secret,codeVerifier:"verifier",
        redirectUri:"http://localhost:3000/api/calendars/microsoft/callback",
      },fetchMock as typeof fetch);
      throw new Error("expected rejection");
    }catch(error){
      expect(error).toBeInstanceOf(CalendarSyncError);
      expect(error).toMatchObject({code:"CALENDAR_NETWORK_ERROR"});
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
