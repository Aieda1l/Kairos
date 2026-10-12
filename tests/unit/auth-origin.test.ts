import {afterEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {proxy} from "@/proxy";
import {resolveAbuseRuntime} from "@/lib/platform/abuse-runtime";
import {canonicalAppOrigin} from "@/lib/security/request-origin";
afterEach(()=>vi.unstubAllEnvs());
const env={DB:{prepare(){},batch(){},exec(){}},KAIROS_APP_URL:"http://127.0.0.1:3000",KAIROS_LOCAL_AUTH:"loopback",KAIROS_ABUSE_TRUSTED_INGRESS:"loopback",
  KAIROS_TURNSTILE_SITE_KEY:"local-site",KAIROS_TURNSTILE_SECRET_KEY:"local-secret",KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString("base64url")};
describe("canonical auth origins and proxy fencing",()=>{
  it("permits explicit server-owned loopback configuration with all guards active",()=>{
    expect(resolveAbuseRuntime(env)).toMatchObject({appOrigin:"http://127.0.0.1:3000",hostname:"127.0.0.1",trustedIngress:"loopback"});
  });
  it.each(["https://mykairos.me","http://mykairos.me","http://127.0.0.2:3000","http://localhost.attacker.invalid:3000"])
  ("cannot promote local mode into a nonloopback origin",origin=>{
    expect(()=>canonicalAppOrigin({...env,KAIROS_APP_URL:origin})).toThrowError(expect.objectContaining({code:"ABUSE_CONFIG_INVALID"}));
  });
  it("rejects HTTP loopback without explicit local mode and loopback ingress without the paired origin",()=>{
    expect(()=>resolveAbuseRuntime({...env,KAIROS_LOCAL_AUTH:undefined})).toThrow();
    expect(()=>resolveAbuseRuntime({...env,KAIROS_APP_URL:"https://mykairos.me",KAIROS_LOCAL_AUTH:undefined})).toThrow();
  });
  it("uses the explicit loopback origin for actions without promoting the existing fixture flag",()=>{
    vi.stubEnv("KAIROS_APP_URL","http://127.0.0.1:3000");vi.stubEnv("KAIROS_LOCAL_AUTH","loopback");
    vi.stubEnv("KAIROS_ABUSE_TRUSTED_INGRESS","loopback");vi.stubEnv("E2E_FIXTURES","1");
    expect(proxy(new NextRequest("http://127.0.0.1:3000/sign-in",{method:"POST",headers:{origin:"http://127.0.0.1:3000"}})).status).toBe(200);
    expect(proxy(new NextRequest("http://127.0.0.1:3000/sign-in",{method:"POST",headers:{origin:"http://localhost:3000"}})).status).toBe(403);
  });
  it.each(["/sign-in","/api/auth/signin/google","/api/calendars/sync-all"])("rejects absent/forged origin for %s",path=>{
    vi.stubEnv("KAIROS_APP_URL","https://mykairos.me");
    for(const origin of [undefined,"https://attacker.invalid"]){
      const headers=origin?{origin}:undefined;
      expect(proxy(new NextRequest("https://mykairos.me"+path,{method:"POST",headers})).status).toBe(403);
    }
  });
  it("exempts only the exact supported GET callbacks from cross-origin protection",()=>{
    vi.stubEnv("KAIROS_APP_URL","https://mykairos.me");
    for(const path of ["/api/auth/callback/google","/api/auth/callback/microsoft-entra-id","/api/calendars/google/callback","/api/calendars/microsoft/callback"]){
      expect(proxy(new NextRequest("https://mykairos.me"+path,{headers:{origin:"https://provider.invalid"}})).status).toBe(200);
    }
    expect(proxy(new NextRequest("https://mykairos.me/api/auth/callback/unknown",{method:"POST",headers:{origin:"https://provider.invalid"}})).status).toBe(403);
  });
  it("overwrites caller pathname and forwards a fresh CSP nonce allowing only Turnstile script/frame hosts",()=>{
    const response=proxy(new NextRequest("https://mykairos.me/sign-in",{headers:{"x-kairos-pathname":"/fake"}}));
    expect(response.headers.get("x-middleware-request-x-kairos-pathname")).toBe("/sign-in");
    const csp=response.headers.get("content-security-policy")!;
    expect(csp).toContain("https://challenges.cloudflare.com");expect(csp).toContain("frame-src");expect(csp).toContain("'nonce-");
    expect(csp).not.toContain("unsafe-eval");expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });
});
