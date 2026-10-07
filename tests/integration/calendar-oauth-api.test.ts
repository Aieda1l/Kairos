import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getDatabase,resetDatabaseSingletonForTests} from "../helpers/legacy-db";
import {migrate} from "../helpers/legacy-db";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarCredentialRepository} from "@/lib/db/repositories/calendar-credentials";
import {resetOAuthRequestRegistryForTests} from "@/lib/calendar/oauth-registry";

const calendarRuntime=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/platform/calendar-runtime",()=>({
  getCalendarRouteRuntime:calendarRuntime.get,
}));

async function googleStart(){return import("@/app/api/calendars/google/start/route");}
async function googleCallback(){return import("@/app/api/calendars/google/callback/route");}
async function microsoftStart(){return import("@/app/api/calendars/microsoft/start/route");}
async function caldavTest(){return import("@/app/api/calendars/caldav/test/route");}
async function caldavConnect(){return import("@/app/api/calendars/caldav/connect/route");}

function post(url:string,body:unknown={}){
  return new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

describe("calendar OAuth and CalDAV connection routes",()=>{
  beforeEach(()=>{
    process.env.ASSIGNMENTS_DB_PATH=":memory:";
    process.env.GOOGLE_CALENDAR_CLIENT_ID="fixture-google-client";
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    process.env.MICROSOFT_CALENDAR_CLIENT_ID="fixture-ms-client";
    process.env.MICROSOFT_CALENDAR_TENANT="common";
    delete process.env.KAIROS_APP_URL;
    resetDatabaseSingletonForTests();
    calendarRuntime.get.mockImplementation(async()=>{
      const db=getDatabase();
      migrate(db);
      return {kind:"legacy" as const,db};
    });
    resetOAuthRequestRegistryForTests();
  });
  afterEach(()=>{
    resetDatabaseSingletonForTests();
    resetOAuthRequestRegistryForTests();
    vi.restoreAllMocks();
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
    delete process.env.MICROSOFT_CALENDAR_TENANT;
    delete process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
    delete process.env.KAIROS_APP_URL;
  });

  it("starts Google OAuth only from a loopback origin and never returns the verifier",async()=>{
    const route=await googleStart();
    const response=await route.POST(post("http://127.0.0.1:3000/api/calendars/google/start"));
    expect(response.status).toBe(200);
    const text=await response.text();
    const body=JSON.parse(text);
    expect(body.authorizationUrl).toContain("accounts.google.com");
    expect(body.authorizationUrl).toContain("code_challenge=");
    expect(text).not.toContain("codeVerifier");
    expect(text).not.toContain("code_verifier");

    const forged=await route.POST(post("https://evil.example/api/calendars/google/start"));
    expect(forged.status).toBe(400);
  });

  it("starts Microsoft OAuth with its narrow delegated scope",async()=>{
    const route=await microsoftStart();
    const response=await route.POST(post("http://localhost:3000/api/calendars/microsoft/start"));
    expect(response.status).toBe(200);
    const body=await response.json();
    const url=new URL(body.authorizationUrl);
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.searchParams.get("scope")).toBe("offline_access Calendars.ReadWrite");
  });

  it("constructs hosted callback URLs from the canonical app URL instead of the request host",async()=>{
    process.env.KAIROS_APP_URL="https://mykairos.me";
    process.env.MICROSOFT_CALENDAR_CLIENT_SECRET="fixture-ms-secret";

    const google=await googleStart();
    const googleResponse=await google.POST(post("https://attacker.example/api/calendars/google/start"));
    expect(googleResponse.status).toBe(200);
    expect(new URL((await googleResponse.json()).authorizationUrl).searchParams.get("redirect_uri"))
      .toBe("https://mykairos.me/api/calendars/google/callback");

    const microsoft=await microsoftStart();
    const microsoftResponse=await microsoft.POST(post("https://attacker.example/api/calendars/microsoft/start"));
    expect(microsoftResponse.status).toBe(200);
    expect(new URL((await microsoftResponse.json()).authorizationUrl).searchParams.get("redirect_uri"))
      .toBe("https://mykairos.me/api/calendars/microsoft/callback");
  });

  it("rejects unknown or replayed Google state before any token request",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const callback=await googleCallback();

    const unknown=await callback.GET(new Request("http://127.0.0.1:3000/api/calendars/google/callback?state=missing&code=fixture-code"));
    expect(unknown.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const start=await googleStart();
    const started=await start.POST(post("http://127.0.0.1:3000/api/calendars/google/start"));
    const auth=new URL((await started.json()).authorizationUrl);
    const state=auth.searchParams.get("state")!;

    fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url==="https://oauth2.googleapis.com/token"){
        const body=new URLSearchParams(String(init?.body));
        expect(body.get("code")).toBe("fixture-code-never-echo");
        return Response.json({access_token:"fixture-access",expires_in:3600,refresh_token:"fixture-refresh-never-echo"});
      }
      if(url==="https://www.googleapis.com/calendar/v3/calendars"){
        return Response.json({id:"remote-google",summary:"Kairos"});
      }
      throw new Error("unexpected "+url);
    });

    const first=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/google/callback?state=${encodeURIComponent(state)}&code=fixture-code-never-echo`));
    expect(first.status).toBe(307);
    const db=getDatabase();migrate(db);
    const connection=new CalendarConnectionRepository(db).list()[0]!;
    expect(connection).toMatchObject({provider:"google",remoteCalendarId:"remote-google"});
    expect(new CalendarCredentialRepository(db).getOAuthRefreshToken(connection.id)).toBe("fixture-refresh-never-echo");
    expect(await first.text()).not.toContain("fixture-refresh-never-echo");

    fetchMock.mockClear();
    const replay=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/google/callback?state=${encodeURIComponent(state)}&code=another`));
    expect(replay.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tests iCloud credentials without persisting them",async()=>{
    const secret="fixture-app-password-never-echo";
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url==="https://caldav.icloud.com/"){
        return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>https://p12-caldav.icloud.com/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
      }
      if(url.endsWith("/principal/")){
        return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>https://p12-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
      }
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>`,{status:207});
    });
    vi.stubGlobal("fetch",fetchMock);
    const route=await caldavTest();
    const response=await route.POST(post("http://127.0.0.1:3000/api/calendars/caldav/test",{username:"student@example.com",secret}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok:true});
    const db=getDatabase();migrate(db);
    expect(new CalendarConnectionRepository(db).list()).toHaveLength(0);
  });

  it("does not replace a working iCloud credential when a new credential fails",async()=>{
    const db=getDatabase();migrate(db);
    const connections=new CalendarConnectionRepository(db);
    const credentials=new CalendarCredentialRepository(db);
    const existing=connections.create({provider:"caldav",label:"Apple iCloud Calendar",accountLabel:"student@example.com"});
    connections.updateRemoteCalendar(existing.id,"https://p12-caldav.icloud.com/123/calendars/kairos/","Kairos");
    credentials.setCaldavCredentials(existing.id,"student@example.com","working-secret");

    vi.stubGlobal("fetch",vi.fn(async()=>new Response("unauthorized",{status:401})));
    const route=await caldavConnect();
    const response=await route.POST(post("http://127.0.0.1:3000/api/calendars/caldav/connect",{
      connectionId:existing.id,
      username:"student@example.com",
      secret:"bad-secret",
    }));
    expect(response.status).toBe(401);
    expect(credentials.getCaldavCredentials(existing.id)).toEqual({
      username:"student@example.com",
      secret:"working-secret",
    });
  });
});
