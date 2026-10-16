import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {Auth,customFetch} from "@auth/core";
import {D1Adapter} from "@auth/d1-adapter";
import {authDiagnostics} from "@/lib/auth/diagnostics";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import type {AbuseRuntime} from "@/lib/abuse/types";
import {signAuthAttempt} from "@/lib/auth/initiation";
import {D1OAuthRequestRepository} from "@/lib/db/d1/repositories/oauth-requests";
import {D1AbuseControlRepository} from "@/lib/db/d1/repositories/abuse-controls";

const fixtures=vi.hoisted(()=>({runtime:vi.fn(),headers:vi.fn(),cookies:vi.fn(),signIn:vi.fn(),signOut:vi.fn(),get:vi.fn(),post:vi.fn(),redirect:vi.fn()}));
const calendar=vi.hoisted(()=>({runtime:vi.fn(),exchange:vi.fn(),connect:vi.fn()}));
vi.mock("@/lib/platform/abuse-runtime",async original=>({...await original<object>(),getAbuseRuntime:fixtures.runtime}));
vi.mock("next/headers",()=>({headers:fixtures.headers,cookies:fixtures.cookies}));
vi.mock("next/navigation",()=>({redirect:fixtures.redirect}));
vi.mock("next-auth",()=>({default:()=>({handlers:{GET:fixtures.get,POST:fixtures.post},auth:vi.fn(),signIn:fixtures.signIn,signOut:fixtures.signOut})}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:calendar.runtime}));
vi.mock("@/lib/calendar/connection-service",()=>({connectOAuthCalendar:calendar.connect}));
vi.mock("@/lib/calendar/google/oauth",async original=>({...await original<object>(),exchangeGoogleAuthorizationCode:calendar.exchange}));
vi.mock("@/lib/calendar/microsoft/oauth",async original=>({...await original<object>(),exchangeMicrosoftAuthorizationCode:calendar.exchange}));
let database:ReturnType<typeof openD1TestDatabase>;
let runtime:AbuseRuntime;
let jar:Map<string,string>;
function headers(extra:Record<string,string>={}){return new Headers({origin:"https://mykairos.me","cf-connecting-ip":"203.0.113.8",...extra});}
function form(token="fixture-token"){const value=new FormData();value.set("cf-turnstile-response",token);return value;}
function req(path:string,method="GET",data?:FormData,extra:Record<string,string>={}){
  return new NextRequest("https://mykairos.me/api/auth/"+path,{method,headers:headers(extra),...(data?{body:data}:{})});
}
async function route(){return import("@/app/api/auth/[...nextauth]/route");}
beforeEach(()=>{
  process.env.KAIROS_NEXT_COMPAT_BUILD="1";
  database=openD1TestDatabase();jar=new Map();
  runtime={db:database.db,hmacKey:new Uint8Array(32).fill(7),appOrigin:"https://mykairos.me",hostname:"mykairos.me",turnstileSecret:"fixture-secret",trustedIngress:"cloudflare",
    fetchImpl:vi.fn(async()=>Response.json({success:true,hostname:"mykairos.me",action:"auth_sign_in"}))};
  fixtures.runtime.mockResolvedValue(runtime);fixtures.headers.mockResolvedValue(headers());
  fixtures.cookies.mockResolvedValue({set:(name:string,value:string)=>jar.set(name,value),get:(name:string)=>jar.has(name)?{value:jar.get(name)}:undefined});
  fixtures.get.mockImplementation(async()=>Response.json({ok:true}));
  fixtures.post.mockImplementation(async()=>new Response(null,{status:302,headers:{location:"https://accounts.google.com/o/oauth2/auth?state=fixture-state"}}));
  fixtures.signIn.mockResolvedValue("https://accounts.google.com/o/oauth2/auth?state=fixture-state");
  fixtures.signOut.mockResolvedValue({redirect:"https://mykairos.me/",cookies:[]});
  fixtures.redirect.mockImplementation(()=>{throw Object.assign(new Error("redirect"),{digest:"NEXT_REDIRECT"});});
  vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});
});
afterEach(()=>{database.close();vi.restoreAllMocks();vi.clearAllMocks();delete process.env.KAIROS_NEXT_COMPAT_BUILD;});
describe("actual Auth.js route and public action admission",()=>{
  async function admittedCookie(provider="google"){
    const response=await (await route()).POST(req("signin/"+provider,"POST",form()));
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  it("allows admitted callbacks under global pause, consumes the stamp once, and clears it",async()=>{
    const cookie=await admittedCookie();
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:initiation'");
    const boundary=await route();
    const response=await boundary.GET(req("callback/google?state=fixture-state&code=fixture-code","GET",undefined,{cookie}));
    expect(response.status).toBe(200);expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const replay=await boundary.GET(req("callback/google?state=fixture-state&code=fixture-code","GET",undefined,{cookie}));
    expect(replay.status).toBe(400);expect(fixtures.get).toHaveBeenCalledTimes(1);
    expect(runtime.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([false,true])("rejects provider shutdown and stale callbacks after reopen=%s",async reopen=>{
    const cookie=await admittedCookie();
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:google'");
    if(reopen)database.sqlite.exec("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='auth:google'");
    expect((await (await route()).GET(req("callback/google?state=fixture-state","GET",undefined,{cookie}))).status).toBe(400);
    expect(fixtures.get).not.toHaveBeenCalled();
  });
  it.each(["callback/google?state=wrong-state","callback/microsoft-entra-id?state=fixture-state"])
  ("rejects a stamp bound to another state/provider before exchange",async path=>{
    const cookie=await admittedCookie();
    expect((await (await route()).GET(req(path,"GET",undefined,{cookie}))).status).toBe(400);
    expect(fixtures.get).not.toHaveBeenCalled();
  });
  it.each(["missing","malformed","tampered","expired","duplicate"])("rejects %s stamp before exchange",async kind=>{
    const valid=await admittedCookie();
    let cookie=kind==="missing"?"":kind==="malformed"?"kairos.auth-attempt.google=bad":kind==="tampered"?valid.slice(0,-1)+"!":kind==="duplicate"?valid+"; "+valid:valid;
    if(kind==="expired")cookie="kairos.auth-attempt.google="+await signAuthAttempt(runtime,{provider:"google",version:0,nonce:crypto.randomUUID(),expiresAt:Date.now()-1},"fixture-state");
    expect((await (await route()).GET(req("callback/google?state=fixture-state","GET",undefined,{cookie}))).status).toBe(400);
    expect(fixtures.get).not.toHaveBeenCalled();
  });
  it("uses independent cookies for providers and shared widget action",async()=>{
    const google=await admittedCookie();
    vi.mocked(runtime.fetchImpl).mockImplementation(async()=>Response.json({success:true,hostname:"mykairos.me",action:"auth_sign_in"}));
    const microsoft=await admittedCookie("microsoft-entra-id");
    expect(google.startsWith("kairos.auth-attempt.google=")).toBe(true);
    expect(microsoft.startsWith("kairos.auth-attempt.microsoft-entra-id=")).toBe(true);
  });
  it.each(["OAuthAccountNotLinked","OAuthCallbackError"])("normalizes %s callback redirect without associations",async error=>{
    const cookie=await admittedCookie();
    fixtures.get.mockImplementation(async()=>new Response(null,{status:302,headers:{location:"https://mykairos.me/sign-in?error="+error}}));
    const response=await (await route()).GET(req("callback/google?state=fixture-state","GET",undefined,{cookie}));
    expect(response.headers.get("location")).toBe("https://mykairos.me/sign-in?error=AUTH_FAILED");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0][0])).toMatchObject({action:"auth.callback",provider:"google",code:"AUTH_FAILED"});
  });
  it("normalizes direct JSON handler and action errors and defers AuthDiagnostics to the owner",async()=>{
    const {authDiagnostics}=await import("@/lib/auth/diagnostics");
    fixtures.post.mockImplementation(async()=>{
      authDiagnostics.error(new Error("private-input"));
      return Response.json({url:"https://mykairos.me/sign-in?error=OAuthAccountNotLinked"});
    });
    const response=await (await route()).POST(req("signin/google","POST",form()));
    expect(await response.json()).toEqual({url:"https://mykairos.me/sign-in?error=AUTH_FAILED"});
    fixtures.signIn.mockResolvedValue("https://mykairos.me/sign-in?error=OAuthAccountNotLinked");
    await expect((await import("../../auth")).startPublicSignIn("google",form())).rejects.toMatchObject({digest:"NEXT_REDIRECT"});
    expect(fixtures.redirect).toHaveBeenCalledWith("https://mykairos.me/sign-in?error=AUTH_FAILED");
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-input");
  });
  it("denies server action with absent/forged origin before all upstream work",async()=>{
    fixtures.headers.mockResolvedValue(new Headers({"x-forwarded-host":"mykairos.me","cf-connecting-ip":"203.0.113.8"}));
    const result=await (await import("../../auth")).startPublicSignIn("google",form());
    expect(result.code).toBe("UNTRUSTED_ORIGIN");expect(fixtures.signIn).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("keeps local loopback challenge/origin/admission checks and clears a rejected local stamp",async()=>{
    runtime.appOrigin="http://127.0.0.1:3000";runtime.hostname="127.0.0.1";runtime.trustedIngress="loopback";
    const boundary=await route();
    const local=(path:string,data?:FormData,extra:Record<string,string>={})=>new NextRequest(runtime.appOrigin+"/api/auth/"+path,{
      method:data?"POST":"GET",headers:{origin:runtime.appOrigin,...extra},...(data?{body:data}:{}),
    });
    expect((await boundary.POST(local("signin/google",form("")))).status).toBe(400);expect(runtime.fetchImpl).not.toHaveBeenCalled();
    expect((await boundary.POST(local("signin/google",form(),{origin:"http://localhost:3000"}))).status).toBe(403);expect(runtime.fetchImpl).not.toHaveBeenCalled();
    // The production hostname is rejected locally; expected-host validation is never disabled.
    expect((await boundary.POST(local("signin/google",form()))).status).toBe(400);expect(fixtures.post).not.toHaveBeenCalled();
    vi.mocked(runtime.fetchImpl).mockImplementation(async()=>Response.json({success:true,hostname:"127.0.0.1",action:"auth_sign_in"}));
    const admitted=await boundary.POST(local("signin/google",form()));
    const cookie=admitted.headers.get("set-cookie")!;
    expect(cookie.includes("Secure")).toBe(false);expect(cookie.includes("HttpOnly")).toBe(true);
    const response=await boundary.GET(local("callback/google?state=wrong-state",undefined,{cookie:cookie.split(";")[0]}));
    expect(response.status).toBe(400);expect(response.headers.get("set-cookie")!.includes("Secure")).toBe(false);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM abuse_rate_events").get()).toEqual({n:3});
  });
  it("rejects direct GET provider initiation before Auth.js or Siteverify",async()=>{
    const response=await (await route()).GET(req("signin/google"));
    expect(response.status).toBe(405);expect(await response.json()).toMatchObject({code:"AUTH_INITIATION_REQUIRES_POST"});
    expect(fixtures.get).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("owns one fresh terminal outcome even for early GET rejection",async()=>{
    await (await route()).GET(req("signin/google","GET",undefined,{"x-request-id":"caller-trace"}));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0][0])).toMatchObject({action:"auth.sign_in",code:"AUTH_REJECTED",result:"rejected",status:405});
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("caller-trace");
  });
  it.each(["/signin/google","/callback/google?state=fixture-state","signin/google/","callback/google/?state=fixture-state"])
  ("rejects noncanonical Auth.js action paths before raw handler work",async path=>{
    const response=await (await route()).POST(req(path,"POST",form()));
    expect(response.status).toBe(400);expect(fixtures.post).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects duplicate callback state and oversized initiation bodies before upstream work",async()=>{
    const cookie=await admittedCookie();fixtures.get.mockClear();vi.mocked(runtime.fetchImpl).mockClear();
    expect((await (await route()).GET(req("callback/google?state=fixture-state&state=other","GET",undefined,{cookie}))).status).toBe(400);
    const data=form();data.append("unknown","x".repeat(17000));
    expect((await (await route()).POST(req("signin/google","POST",data))).status).toBe(400);
    expect(fixtures.get).not.toHaveBeenCalled();expect(fixtures.post).toHaveBeenCalledTimes(1);expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("redirects generic sign-in GET to the custom page",async()=>{
    const response=await (await route()).GET(req("signin"));
    expect(response.headers.get("location")).toBe("/sign-in");expect(fixtures.get).not.toHaveBeenCalled();
  });
  it.each(["", "x".repeat(2049)])("rejects missing/oversized direct POST tokens without OAuth/Siteverify",async token=>{
    const response=await (await route()).POST(req("signin/google","POST",form(token)));
    expect(response.status).toBe(400);expect(fixtures.post).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects duplicate token fields before upstream work",async()=>{
    const data=form();data.append("cf-turnstile-response","duplicate");
    expect((await (await route()).POST(req("signin/google","POST",data))).status).toBe(400);
    expect(fixtures.post).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  const untrustedHeaders:Record<string,string>[]=[{origin:"https://attacker.invalid"},{"cf-worker":"example.invalid"},{"cf-worker":""},{"cf-connecting-ip":"invalid"},
    {"x-forwarded-host":"attacker.invalid"},{"x-forwarded-proto":"http"},{host:"attacker.invalid"}];
  it.each(untrustedHeaders)
  ("rejects untrusted origin/address/Worker ingress before verification",async extra=>{
    expect((await (await route()).POST(req("signin/google","POST",form(),extra))).status).toBeGreaterThanOrEqual(400);
    expect(fixtures.post).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("ignores forged verified headers and fails when Siteverify rejects",async()=>{
    vi.mocked(runtime.fetchImpl).mockResolvedValue(Response.json({success:false}));
    expect((await (await route()).POST(req("signin/google","POST",form(),{"x-turnstile-verified":"true"}))).status).toBe(400);
    expect(fixtures.post).not.toHaveBeenCalled();
  });
  it("blocks paused starts with zero verification and leaves reads/logout usable",async()=>{
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:initiation'");
    expect((await (await route()).POST(req("signin/google","POST",form()))).status).toBe(503);
    expect(fixtures.post).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));
    await (await route()).GET(req("session"));await (await route()).POST(req("signout","POST"));
    const auth=await import("../../auth");await auth.getAuthSessionFromHeaders(headers());
    expect(fixtures.get).toHaveBeenCalledTimes(2);expect(fixtures.post).toHaveBeenCalledTimes(1);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
  });
  it("fails closed when initiation controls are missing with zero verification/OAuth",async()=>{
    database.sqlite.exec("DELETE FROM abuse_controls WHERE control_key='auth:initiation'");
    const response=await (await route()).POST(req("signin/google","POST",form()));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(runtime.fetchImpl).not.toHaveBeenCalled();expect(fixtures.post).not.toHaveBeenCalled();
  });
  it("enforces twenty rolling starts per network/provider and bounded Retry-After",async()=>{
    const boundary=await route();
    for(let i=0;i<20;i++)expect((await boundary.POST(req("signin/google","POST",form()))).status).toBe(302);
    const response=await boundary.POST(req("signin/google","POST",form()));
    expect(response.status).toBe(429);expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(600);
    expect(fixtures.post).toHaveBeenCalledTimes(20);expect(runtime.fetchImpl).toHaveBeenCalledTimes(20);
  });
  it("guards the actual exported action with explicit origin and challenge checks",async()=>{
    const auth=await import("../../auth");
    expect(auth).not.toHaveProperty("signIn");expect(auth).not.toHaveProperty("handlers");
    const rejected=await auth.startPublicSignIn("google",form(""));
    expect(rejected).toMatchObject({code:"AUTH_CHALLENGE_FAILED"});expect(fixtures.signIn).not.toHaveBeenCalled();
    await expect(auth.startPublicSignIn("google",form())).rejects.toMatchObject({digest:"NEXT_REDIRECT"});
    expect(fixtures.signIn).toHaveBeenCalledWith("google",{redirect:false,redirectTo:"/"});
    expect(jar.size).toBe(1);
  });
  it("retains real Auth.js HTTP CSRF enforcement on a challenge-admitted POST",async()=>{
    fixtures.post.mockImplementation(request=>Auth(request,{secret:"fixture-auth-secret",trustHost:true,basePath:"/api/auth",providers:[{id:"google",name:"Google",type:"oidc",issuer:"https://accounts.google.com",clientId:"fixture",clientSecret:"fixture",authorization:"https://accounts.google.com/o/oauth2/auth"}],logger:{error(){},warn(){},debug(){}}}));
    const response=await (await route()).POST(req("signin/google","POST",form()));
    expect(response.headers.get("location")).not.toContain("accounts.google.com");
    expect(response.headers.get("set-cookie")??"").not.toContain("kairos.auth-attempt");
  });
  it("runs real Auth.js authorization with a valid CSRF token and keeps PKCE/state authoritative",async()=>{
    const noNetwork=vi.fn<typeof fetch>(async input=>{
      if(String(input)!=="https://accounts.google.com/.well-known/openid-configuration")throw new Error("Unexpected provider exchange");
      return Response.json({issuer:"https://accounts.google.com",authorization_endpoint:"https://accounts.google.com/o/oauth2/auth",token_endpoint:"https://oauth2.googleapis.com/token",jwks_uri:"https://accounts.google.com/jwks"});
    });
    const config={secret:"fixture-auth-secret",trustHost:true,basePath:"/api/auth",providers:[{id:"google",name:"Google",type:"oidc" as const,issuer:"https://accounts.google.com",clientId:"fixture",clientSecret:"fixture",authorization:"https://accounts.google.com/o/oauth2/auth",checks:["pkce","state"] as ("pkce"|"state")[],[customFetch]:noNetwork}],logger:{error(){},warn(){},debug(){}}};
    const csrf=await Auth(new Request("https://mykairos.me/api/auth/csrf"),config);
    const csrfToken=(await csrf.json()).csrfToken;
    const csrfCookie=csrf.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    fixtures.post.mockImplementation(request=>Auth(request,config));
    const response=await (await route()).POST(new NextRequest("https://mykairos.me/api/auth/signin/google",{
      method:"POST",headers:headers({cookie:csrfCookie,"content-type":"application/x-www-form-urlencoded"}),
      body:new URLSearchParams({csrfToken,"cf-turnstile-response":"fixture-token"}),
    }));
    expect(response.status).toBe(302);
    const destination=new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("redirect_uri")).toBe("https://mykairos.me/api/auth/callback/google");
    expect(destination.searchParams.has("state")).toBe(true);expect(destination.searchParams.has("code_challenge")).toBe(true);
    const cookies=response.headers.getSetCookie();
    expect(cookies.some(value=>value.startsWith("kairos.auth-attempt.google=")&&value.includes("HttpOnly")&&value.includes("Secure")&&value.includes("SameSite=Lax")&&value.includes("Max-Age=600"))).toBe(true);
    fixtures.get.mockImplementation(request=>Auth(request,config));
    const callback=await (await route()).GET(req("callback/google?code=fixture-code&state="+encodeURIComponent(destination.searchParams.get("state")!),"GET",undefined,{
      cookie:cookies.filter(value=>value.startsWith("kairos.auth-attempt")).map(value=>value.split(";")[0]).join("; "),
    }));
    expect(callback.headers.get("location")).toBe("https://mykairos.me/sign-in?error=AUTH_FAILED");
    expect(noNetwork.mock.calls.every(([url])=>String(url).endsWith("/.well-known/openid-configuration"))).toBe(true);
  });
});

describe("truthful logout terminal outcomes",()=>{
  function outcomes(){return [...vi.mocked(console.info).mock.calls,...vi.mocked(console.warn).mock.calls].map(([value])=>JSON.parse(value as string));}
  function core(){
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));
    database.sqlite.exec("INSERT INTO users(id) VALUES ('logout-user')");
    database.sqlite.exec("INSERT INTO sessions(id,sessionToken,userId,expires) VALUES ('logout-session','fixture-session','logout-user','2099-01-01T00:00:00.000Z')");
    const noNetwork=vi.fn<typeof fetch>(()=>{throw new Error("Unexpected provider work");});
    const config={secret:"fixture-auth-secret",trustHost:true,basePath:"/api/auth",session:{strategy:"database" as const},adapter:D1Adapter(database.db as never),
      providers:[{id:"google",name:"Google",type:"oidc" as const,issuer:"https://accounts.google.com",clientId:"fixture",clientSecret:"fixture",authorization:"https://accounts.google.com/o/oauth2/auth",[customFetch]:noNetwork}],logger:authDiagnostics};
    fixtures.get.mockImplementation(request=>Auth(request,config));fixtures.post.mockImplementation(request=>Auth(request,config));
    return {config,noNetwork};
  }
  async function acceptedPost(config:Parameters<typeof Auth>[1],callbackUrl="https://mykairos.me/"){
    const csrf=await Auth(new Request("https://mykairos.me/api/auth/csrf"),config);
    const csrfToken=(await csrf.json()).csrfToken;
    const cookie=csrf.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ")+"; __Secure-authjs.session-token=fixture-session";
    return (await route()).POST(new NextRequest("https://mykairos.me/api/auth/signout",{method:"POST",
      headers:headers({cookie,"content-type":"application/x-www-form-urlencoded"}),body:new URLSearchParams({csrfToken,callbackUrl}),
    }));
  }
  function independent(noNetwork?:ReturnType<typeof vi.fn<typeof fetch>>){
    expect(fixtures.runtime).not.toHaveBeenCalled();expect(runtime.fetchImpl).not.toHaveBeenCalled();
    if(noNetwork)expect(noNetwork).not.toHaveBeenCalled();
    expect(JSON.stringify(outcomes())).not.toContain("fixture-session");expect(JSON.stringify(outcomes())).not.toContain("private-logout");
  }
  it("classifies the real-core GET logout confirmation as AUTH_REQUIRED without deleting the session",async()=>{
    const {noNetwork}=core();
    const response=await (await route()).GET(req("signout","GET",undefined,{cookie:"__Secure-authjs.session-token=fixture-session"}));
    expect(response.status).toBe(200);expect((await response.text()).includes('<form')).toBe(true);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:1});
    expect(outcomes().map(event=>[event.action,event.code,event.result,event.status])).toEqual([["auth.sign_out","AUTH_REQUIRED","ok",200]]);
    independent(noNetwork);
  });
  it.each([false,true])("classifies real-core logout missing-CSRF POST as failure for JSON redirect=%s",async json=>{
    const {noNetwork}=core();
    const response=await (await route()).POST(req("signout","POST",undefined,{
      cookie:"__Secure-authjs.session-token=fixture-session",...(json?{"x-auth-return-redirect":"1"}:{}),
    }));
    const destination=json?(await response.json()).url:response.headers.get("location");
    expect(new URL(destination!).searchParams.get("error")).toBe("MissingCSRF");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:1});
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_FAILED","error"]]);
    independent(noNetwork);
  });
  it("preserves real-core completed logout, session deletion and exactly one success event",async()=>{
    const {config,noNetwork}=core();const response=await acceptedPost(config);
    expect(response.status).toBe(302);expect(response.headers.get("location")).toBe("https://mykairos.me/");
    expect(response.headers.getSetCookie().some(value=>value.startsWith("__Secure-authjs.session-token=")&&value.includes("Max-Age=0"))).toBe(true);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:0});
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_SIGNED_OUT","ok"]]);
    independent(noNetwork);
  });
  it.each(["existing-page-error","MissingCSRF"])("preserves real-core completed logout with an application error query: %s",async error=>{
    const {config,noNetwork}=core();const completed=vi.fn();
    const configured={...config,events:{signOut:completed}};
    fixtures.post.mockImplementation(request=>Auth(request,configured));
    const destination="https://mykairos.me/sources?error="+error;
    const response=await acceptedPost(configured,destination);
    expect(response.status).toBe(302);expect(response.headers.get("location")).toBe(destination);
    expect(completed.mock.calls.length).toBe(1);
    expect(response.headers.getSetCookie().some(value=>value.startsWith("__Secure-authjs.session-token=")&&value.includes("Max-Age=0"))).toBe(true);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:0});
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_SIGNED_OUT","ok"]]);
    independent(noNetwork);
  });
  it.each([false,true])("preserves real-core logout rejection at the configured application error page for JSON=%s",async json=>{
    const {config,noNetwork}=core();const configured={...config,pages:{signIn:"/sign-in",error:"/sign-in"}};
    fixtures.post.mockImplementation(request=>Auth(request,configured));
    const response=await (await route()).POST(req("signout","POST",undefined,{
      cookie:"__Secure-authjs.session-token=fixture-session",...(json?{"x-auth-return-redirect":"1"}:{}),
    }));
    const destination=json?(await response.json()).url:response.headers.get("location");
    expect(destination).toBe("https://mykairos.me/sign-in?error=MissingCSRF");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:1});
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_FAILED","error"]]);
    independent(noNetwork);
  });
  it("classifies a real-core logout adapter failure despite its normal redirect and cookie clearing",async()=>{
    const {config,noNetwork}=core();
    config.adapter.deleteSession=async()=>{throw new Error("private-logout-store");};
    const response=await acceptedPost(config);
    expect(response.status).toBe(302);expect(response.headers.get("location")).toBe("https://mykairos.me/");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n:1});
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_FAILED","error"]]);
    independent(noNetwork);
  });
  const failures=[
    {name:"raw error redirect",make:()=>({redirect:"https://mykairos.me/api/auth/error?error=MissingCSRF",cookies:[]}),code:"AUTH_FAILED"},
    {name:"Response error redirect",make:()=>Response.redirect("https://mykairos.me/api/auth/error?error=MissingCSRF"),code:"AUTH_FAILED"},
    {name:"JSON error redirect",make:()=>Response.json({url:"https://mykairos.me/api/auth/error?error=MissingCSRF"}),code:"AUTH_FAILED"},
    {name:"raw service error",make:()=>({status:503,redirect:"https://mykairos.me/",cookies:[]}),code:"SERVICE_UNAVAILABLE"},
  ];
  it.each(failures)("classifies rawSignOut logout failure result: $name",async({make,code})=>{
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));const result=make();fixtures.signOut.mockResolvedValue(result);
    expect(await (await import("../../auth")).signOut({redirect:false})===result).toBe(true);
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out",code,"error"]]);
    independent();
  });
  it("preserves rawSignOut completed logout and its default redirect",async()=>{
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));
    await expect((await import("../../auth")).signOut({redirectTo:"/"})).rejects.toMatchObject({digest:"NEXT_REDIRECT"});
    expect(fixtures.signOut).toHaveBeenCalledWith({redirectTo:"/",redirect:false});
    expect(fixtures.redirect).toHaveBeenCalledWith("https://mykairos.me/");
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_SIGNED_OUT","ok"]]);
    independent();
  });
  const applicationReturns=[
    {name:"raw result",make:(url:string)=>({redirect:url,cookies:[]})},
    {name:"Response redirect",make:(url:string)=>Response.redirect(url)},
    {name:"JSON redirect",make:(url:string)=>Response.json({url})},
  ];
  it.each(applicationReturns)("preserves rawSignOut completed logout with an application error query: $name",async({make})=>{
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));
    const destination="https://mykairos.me/sources?error=existing-page-error",result=make(destination);
    fixtures.signOut.mockResolvedValue(result);
    expect(await (await import("../../auth")).signOut({redirect:false,redirectTo:destination})===result).toBe(true);
    if(result instanceof Response)expect(result.bodyUsed).toBe(false);
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_SIGNED_OUT","ok"]]);
    expect(fixtures.redirect).not.toHaveBeenCalled();independent();
  });
  it("preserves the rawSignOut default redirect with an application error query",async()=>{
    fixtures.runtime.mockRejectedValue(new Error("unavailable-abuse-bindings"));
    const destination="https://mykairos.me/sources?error=existing-page-error";
    fixtures.signOut.mockResolvedValue({redirect:destination,cookies:[]});
    await expect((await import("../../auth")).signOut({redirectTo:destination})).rejects.toMatchObject({digest:"NEXT_REDIRECT"});
    expect(fixtures.signOut).toHaveBeenCalledWith({redirectTo:destination,redirect:false});
    expect(fixtures.redirect).toHaveBeenCalledWith(destination);
    expect(outcomes().map(event=>[event.action,event.code,event.result])).toEqual([["auth.sign_out","AUTH_SIGNED_OUT","ok"]]);
    independent();
  });
  it("retains a deferred rawSignOut diagnostic failure without leaking it into the next logout",async()=>{
    fixtures.signOut.mockImplementationOnce(async()=>{
      authDiagnostics.error(new Error("private-logout-error"));return {redirect:"https://mykairos.me/",cookies:[]};
    });
    const {signOut}=await import("../../auth");await signOut({redirect:false});await signOut({redirect:false});
    expect(outcomes().map(event=>event.code).sort()).toEqual(["AUTH_FAILED","AUTH_SIGNED_OUT"]);
    expect(new Set(outcomes().map(event=>event.requestId)).size).toBe(2);independent();
  });
});

describe("durable calendar OAuth provider version",()=>{
  it("increments provider versions on every enabled transition and retains the version on a no-op",async()=>{
    const controls=new D1AbuseControlRepository(database.db);
    await controls.setEnabled("auth:google",false);expect(await controls.get("auth:google")).toEqual({enabled:false,version:1});
    await controls.setEnabled("auth:google",true);expect(await controls.get("auth:google")).toEqual({enabled:true,version:2});
    await controls.setEnabled("auth:google",true);expect(await controls.get("auth:google")).toEqual({enabled:true,version:2});
  });
  function repo(){
    database.sqlite.exec("INSERT OR IGNORE INTO users(id) VALUES ('fixture-user')");
    return new D1OAuthRequestRepository(database.db,{userId:"fixture-user"},{activeKeyId:"v1",keys:{v1:new Uint8Array(32).fill(9)}});
  }
  it("blocks disabled calendar starts before registration",async()=>{
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:google'");
    const code=await repo().register({provider:"google",redirectUri:"https://mykairos.me/api/calendars/google/callback"}).then(()=>"unexpected-success",error=>error.code);
    expect(code).toBe("AUTH_INITIATION_PAUSED");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM oauth_requests").get()).toEqual({n:0});
  });
  it.each([false,true])("rejects a durable pending state after disabling/reopen=%s",async reopen=>{
    const repository=repo();const {state}=await repository.register({provider:"microsoft",redirectUri:"https://mykairos.me/api/calendars/microsoft/callback"});
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:microsoft'");
    if(reopen)database.sqlite.exec("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='provider:microsoft'");
    expect((await repository.consume(state,"microsoft"))===null).toBe(true);
  });
  it("binds current version into durable state and ignores global identity initiation pause",async()=>{
    database.sqlite.exec("UPDATE abuse_controls SET version=4 WHERE control_key='provider:google'");
    const repository=repo();const {state}=await repository.register({provider:"google",redirectUri:"https://mykairos.me/api/calendars/google/callback"});
    expect(database.sqlite.prepare("SELECT control_version FROM oauth_requests").get()).toEqual({control_version:4});
    database.sqlite.exec("UPDATE abuse_controls SET enabled=0 WHERE control_key='auth:initiation'");
    expect(await repository.consume(state,"google")).toMatchObject({controlVersion:4});
    expect(await repository.consume(state,"google")).toBeNull();
  });
});

describe("hosted calendar start/callback boundaries",()=>{
  function setup(){
    database.sqlite.exec("INSERT OR IGNORE INTO users(id) VALUES ('fixture-user')");
    const keyring={activeKeyId:"v1",keys:{v1:new Uint8Array(32).fill(9)}};
    calendar.runtime.mockResolvedValue({kind:"hosted",db:database.db,scope:{userId:"fixture-user"},keyring});
    calendar.exchange.mockResolvedValue({accessToken:"fixture-access",refreshToken:"fixture-refresh"});
    process.env.KAIROS_APP_URL="https://mykairos.me";process.env.GOOGLE_CALENDAR_CLIENT_ID="fixture-google";
    process.env.MICROSOFT_CALENDAR_CLIENT_ID="f27ee34d-f693-4ce9-87cd-b438f914ae0d";process.env.MICROSOFT_CALENDAR_CLIENT_SECRET="fixture-secret";
    return new D1OAuthRequestRepository(database.db,{userId:"fixture-user"},keyring);
  }
  afterEach(()=>{delete process.env.KAIROS_APP_URL;delete process.env.GOOGLE_CALENDAR_CLIENT_ID;delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;delete process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;});
  it.each(["google","microsoft"])("blocks disabled %s starts at the actual route",async provider=>{
    setup();database.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run("provider:"+provider);
    const route=provider==="google"?await import("@/app/api/calendars/google/start/route"):await import("@/app/api/calendars/microsoft/start/route");
    const response=await route.POST(new Request("https://mykairos.me/api/calendars/"+provider+"/start",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
    expect(response.status).toBe(503);expect(calendar.exchange).not.toHaveBeenCalled();expect(calendar.connect).not.toHaveBeenCalled();
  });
  it.each(["google","microsoft"])("rejects stale/reopened %s callbacks before exchange or provisioning",async provider=>{
    const repo=setup(),identity=provider as "google"|"microsoft";
    const {state}=await repo.register({provider:identity,redirectUri:"https://mykairos.me/api/calendars/"+provider+"/callback"});
    database.sqlite.prepare("UPDATE abuse_controls SET version=version+2 WHERE control_key=?").run("provider:"+provider);
    const route=provider==="google"?await import("@/app/api/calendars/google/callback/route"):await import("@/app/api/calendars/microsoft/callback/route");
    const response=await route.GET(new Request("https://mykairos.me/api/calendars/"+provider+"/callback?state="+state+"&code=fixture-code"));
    expect(response.status).toBe(400);expect(calendar.exchange).not.toHaveBeenCalled();expect(calendar.connect).not.toHaveBeenCalled();
    if(provider==="microsoft")expect(console.warn).toHaveBeenCalledTimes(1);
  });
  it.each(["google","microsoft"])("fails closed with a stable response when %s callback controls are unavailable",async provider=>{
    const repo=setup(),identity=provider as "google"|"microsoft";
    const {state}=await repo.register({provider:identity,redirectUri:"https://mykairos.me/api/calendars/"+provider+"/callback"});
    database.sqlite.prepare("DELETE FROM abuse_controls WHERE control_key=?").run("provider:"+provider);
    const route=provider==="google"?await import("@/app/api/calendars/google/callback/route"):await import("@/app/api/calendars/microsoft/callback/route");
    const result=await route.GET(new Request("https://mykairos.me/api/calendars/"+provider+"/callback?state="+state+"&code=fixture-code")).catch(()=>null);
    expect(result?.status).toBe(503);expect(calendar.exchange).not.toHaveBeenCalled();expect(calendar.connect).not.toHaveBeenCalled();
  });
  it.each(["google","microsoft"])("rechecks %s shutdown after exchange before provisioning",async provider=>{
    const repo=setup(),identity=provider as "google"|"microsoft";
    const {state}=await repo.register({provider:identity,redirectUri:"https://mykairos.me/api/calendars/"+provider+"/callback"});
    calendar.exchange.mockImplementation(async()=>{
      database.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?").run("provider:"+provider);
      return {accessToken:"fixture-access",refreshToken:"fixture-refresh"};
    });
    const route=provider==="google"?await import("@/app/api/calendars/google/callback/route"):await import("@/app/api/calendars/microsoft/callback/route");
    const response=await route.GET(new Request("https://mykairos.me/api/calendars/"+provider+"/callback?state="+state+"&code=fixture-code"));
    expect(response.status).toBeGreaterThanOrEqual(300);expect(calendar.exchange).toHaveBeenCalledTimes(1);expect(calendar.connect).not.toHaveBeenCalled();
  });
  const storageFailures=[{provider:"google" as const,mode:"missing"},{provider:"google" as const,mode:"storage"},
    {provider:"microsoft" as const,mode:"missing"},{provider:"microsoft" as const,mode:"storage"}];
  it.each(storageFailures)("retains stable post-exchange control storage failure: $provider/$mode",async({provider,mode})=>{
    const repo=setup();const {state}=await repo.register({provider,redirectUri:"https://mykairos.me/api/calendars/"+provider+"/callback"});
    calendar.exchange.mockImplementation(async()=>{
      if(mode==="missing")database.sqlite.prepare("DELETE FROM abuse_controls WHERE control_key=?").run("provider:"+provider);
      else vi.spyOn(database.db,"prepare").mockImplementation(()=>{throw new Error("private-control-store-failure");});
      return {accessToken:"fixture-access",refreshToken:"fixture-refresh"};
    });
    const callback=provider==="google"?await import("@/app/api/calendars/google/callback/route"):await import("@/app/api/calendars/microsoft/callback/route");
    const response=await callback.GET(new Request("https://mykairos.me/api/calendars/"+provider+"/callback?state="+state+"&code=fixture-code"));
    expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({code:"ABUSE_STORAGE_UNAVAILABLE"});
    expect(calendar.exchange).toHaveBeenCalledTimes(1);expect(calendar.connect).not.toHaveBeenCalled();
    const events=[...vi.mocked(console.info).mock.calls,...vi.mocked(console.warn).mock.calls].map(([value])=>JSON.parse(value as string));
    expect(events.map(event=>[event.action,event.code,event.result,event.provider,event.status]))
      .toEqual([["calendar.connect","SERVICE_UNAVAILABLE","error",provider,503]]);
    expect(JSON.stringify(events)).not.toContain("private-control");expect(JSON.stringify(events)).not.toContain(state);
  });
});
