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
async function microsoftCallback(){return import("@/app/api/calendars/microsoft/callback/route");}
async function caldavTest(){return import("@/app/api/calendars/caldav/test/route");}
async function caldavConnect(){return import("@/app/api/calendars/caldav/connect/route");}

function post(url:string,body:unknown={}){
  return new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

describe("calendar OAuth and CalDAV connection routes",()=>{
  it.each(['google','microsoft'] as const)('returns %s denial to the registered onboarding target without provider detail or a token request',async provider=>{
    const start=provider==='google'?await googleStart():await microsoftStart();
    const started=await start.POST(post(`http://127.0.0.1:3000/api/calendars/${provider}/start`,{returnTo:'/onboarding'}));
    expect(started.status).toBe(200);
    const state=new URL((await started.json()).authorizationUrl).searchParams.get('state')!;
    const transport=vi.fn(()=>{throw new Error('No remote calls on denial');});vi.stubGlobal('fetch',transport);
    try{
      const callback=provider==='google'?await googleCallback():await microsoftCallback();
      const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&error=access_denied&error_description=private-denial-detail`));
      expect(response.status).toBe(303);
      const destination=new URL(response.headers.get('location')!);
      expect(destination.pathname).toBe('/onboarding');expect(destination.searchParams.get('calendarError')).toBe('CALENDAR_AUTH_REQUIRED');
      expect(destination.href).not.toContain('private-denial-detail');expect(transport).not.toHaveBeenCalled();
      expect((await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&code=synthetic`))).status).toBe(400);
    }finally{vi.unstubAllGlobals();}
  });
  it.each(['google','microsoft'] as const)('rejects unapproved %s OAuth return paths',async provider=>{
    const route=provider==='google'?await googleStart():await microsoftStart();
    for(const returnTo of ['//evil.invalid','/%252f%252fevil.invalid','/upcoming','/onboarding?token=synthetic']){
      expect((await route.POST(post(`http://127.0.0.1:3000/api/calendars/${provider}/start`,{returnTo}))).status).toBe(400);
    }
  });
  it.each(['google','microsoft'] as const)('keeps the registered onboarding target for %s success and upstream failure',async provider=>{
    const start=provider==='google'?await googleStart():await microsoftStart();
    const callback=provider==='google'?await googleCallback():await microsoftCallback();
    for(const fail of [false,true]){
      const started=await start.POST(post(`http://127.0.0.1:3000/api/calendars/${provider}/start`,{returnTo:'/onboarding'}));
      const state=new URL((await started.json()).authorizationUrl).searchParams.get('state')!;
      const transport=vi.fn(async(input:RequestInfo|URL)=>{
        const url=String(input);
        if(url==='https://oauth2.googleapis.com/token'||url.startsWith('https://login.microsoftonline.com/'))return fail?Response.json({error:'invalid_grant',error_description:'private-upstream-detail'},{status:401}):Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600});
        if(url==='https://www.googleapis.com/calendar/v3/calendars')return Response.json({id:'synthetic-calendar',summary:'Kairos'});
        if(url==='https://www.googleapis.com/calendar/v3/users/me/calendarList/synthetic-calendar')return Response.json({id:'synthetic-calendar',summary:'Kairos',accessRole:'owner'});
        if(url==='https://graph.microsoft.com/v1.0/me/calendars')return Response.json({value:[{id:'synthetic-calendar',name:'Kairos',canEdit:true}]});
        if(url==='https://graph.microsoft.com/v1.0/me/calendars/synthetic-calendar')return Response.json({id:'synthetic-calendar',name:'Kairos',canEdit:true});
        throw new Error('Synthetic transport rejected an unexpected destination');
      });vi.stubGlobal('fetch',transport);
      try{
        const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/${provider}/callback?state=${state}&code=synthetic-code`));
        expect(response.status).toBe(fail?303:307);const target=new URL(response.headers.get('location')!);
        expect(target.pathname).toBe('/onboarding');expect(target.href).not.toContain('synthetic-code');expect(target.href).not.toContain('private-upstream-detail');
        if(fail)expect(target.searchParams.get('calendarError')).toBe('CALENDAR_AUTH_EXPIRED');
      }finally{vi.unstubAllGlobals();}
    }
  });
  beforeEach(()=>{
    process.env.ASSIGNMENTS_DB_PATH=":memory:";
    process.env.GOOGLE_CALENDAR_CLIENT_ID="fixture-google-client";
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    process.env.MICROSOFT_CALENDAR_CLIENT_ID="f27ee34d-f693-4ce9-87cd-b438f914ae0d";
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

  it("returns to Sources after a failed Microsoft callback without exposing the authorization code",async()=>{
    const start=await microsoftStart();
    const started=await start.POST(post("http://127.0.0.1:3000/api/calendars/microsoft/start"));
    const authorization=new URL((await started.json()).authorizationUrl);
    const state=authorization.searchParams.get("state")!;
    const secret="fixture-authorization-code-never-echo";
    const fetchMock=vi.fn(async()=>Response.json({
      error:"invalid_client",
      error_description:`Provider detail containing ${secret}`,
    },{status:401}));
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    vi.stubGlobal("fetch",fetchMock);
    try{
      const callback=await microsoftCallback();
      const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/microsoft/callback?state=${state}&code=${secret}`));
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const destination=new URL(response.headers.get("location")!);
      expect(destination.origin+destination.pathname).toBe("http://127.0.0.1:3000/sources");
      expect(destination.searchParams.get("calendarError")).toBe("CALENDAR_CONFIG_MISSING");
      expect(destination.searchParams.get("calendarProvider")).toBe("microsoft");
      expect(destination.searchParams.get("calendarStage")).toBe("token_exchange");
      expect(response.headers.get("location")).not.toContain(secret);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warning.mock.calls[0][0] as string)).toMatchObject({
        event:"kairos.operation",action:"calendar.connect",code:"CALENDAR_CONFIG_MISSING",provider:"microsoft",result:"error",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }finally{
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("distinguishes a completed Microsoft token exchange from denied Graph calendar access",async()=>{
    const start=await microsoftStart();
    const started=await start.POST(post("http://127.0.0.1:3000/api/calendars/microsoft/start"));
    const state=new URL((await started.json()).authorizationUrl).searchParams.get("state")!;
    const secret="fixture-microsoft-code-never-echo";
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).startsWith("https://login.microsoftonline.com/")){
        return Response.json({access_token:"fixture-access",refresh_token:"fixture-refresh",expires_in:3600});
      }
      if(String(input)==="https://graph.microsoft.com/v1.0/me/calendars"){
        return Response.json({error:{code:"ErrorAccessDenied",message:secret}},{status:403});
      }
      throw new Error("unexpected upstream request");
    });
    vi.stubGlobal("fetch",fetchMock);
    try{
      const callback=await microsoftCallback();
      const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/microsoft/callback?state=${state}&code=${secret}`));
      expect(response.status).toBe(303);
      const location=response.headers.get("location")!;
      expect(new URL(location).searchParams.get("calendarError")).toBe("CALENDAR_PERMISSION_DENIED");
      expect(new URL(location).searchParams.get("calendarStage")).toBe("calendar_setup");
      expect(location).not.toContain(secret);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warning.mock.calls[0][0] as string)).toMatchObject({
        event:"kairos.operation",action:"calendar.connect",code:"CALENDAR_PERMISSION_DENIED",provider:"microsoft",result:"error",
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
    }finally{
      vi.unstubAllGlobals();
      warning.mockRestore();
    }
  });

  it("records one successful Microsoft connection without tokens, identity, or callback URL",async()=>{
    const start=await microsoftStart();
    const started=await start.POST(post("http://127.0.0.1:3000/api/calendars/microsoft/start"));
    const state=new URL((await started.json()).authorizationUrl).searchParams.get("state")!;
    const info=vi.spyOn(console,"info").mockImplementation(()=>{});
    vi.stubGlobal("fetch",async(input:RequestInfo|URL)=>String(input).startsWith("https://login.microsoftonline.com/")
      ?Response.json({access_token:"private-access",refresh_token:"private-refresh",expires_in:3600})
      :String(input).endsWith("/me/calendars")
        ?Response.json({value:[{id:"private-calendar",name:"Kairos",canEdit:true}]})
        :Response.json({id:"private-calendar",name:"Kairos",canEdit:true}));
    const callback=await microsoftCallback();
    const response=await callback.GET(new Request(`http://127.0.0.1:3000/api/calendars/microsoft/callback?state=${state}&code=private-code`,{
      headers:{cookie:"private-cookie","x-request-id":"private-trace"},
    }));
    expect(response.status).toBe(307);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0][0] as string)).toMatchObject({
      event:"kairos.operation",action:"calendar.connect",code:"CALENDAR_CONNECTED",result:"ok",provider:"microsoft",status:307,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("private");
    vi.unstubAllGlobals();
  });

  it("records missing Microsoft callback parameters using fresh IDs instead of supplied trace values",async()=>{
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const callback=await microsoftCallback();
    for(let i=0;i<2;i++){
      const response=await callback.GET(new Request("http://127.0.0.1:3000/api/calendars/microsoft/callback?error=private-error",{
        headers:{"x-request-id":"private-trace"},
      }));
      expect(response.status).toBe(400);
    }
    expect(warning).toHaveBeenCalledTimes(2);
    const events=warning.mock.calls.map(([value])=>JSON.parse(value as string));
    expect(events[0]).toMatchObject({action:"calendar.connect",code:"CALENDAR_AUTH_REQUIRED",result:"rejected",status:400});
    expect(events[0].requestId).not.toBe(events[1].requestId);
    expect(JSON.stringify(events)).not.toContain("private");
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
      if(url==="https://www.googleapis.com/calendar/v3/users/me/calendarList/remote-google"){
        expect(init?.method).toBe("GET");
        return Response.json({id:"remote-google",summary:"Kairos",accessRole:"owner"});
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
