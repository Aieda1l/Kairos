import {afterEach,expect,it,vi} from "vitest";
const bindings=vi.hoisted(()=>({env:{} as Record<string,unknown>,load:vi.fn()}));
vi.mock("cloudflare:workers",()=>{bindings.load();return {env:bindings.env};});
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it("returns only the public scalar without resolving private runtime",async()=>{
  bindings.env={KAIROS_TURNSTILE_SITE_KEY:"public-site"};Object.defineProperty(bindings.env,"DB",{get:()=>{throw Error("D1 forbidden");}});Object.defineProperty(bindings.env,"KAIROS_TURNSTILE_SECRET_KEY",{get:()=>{throw Error("private binding forbidden");}});
  const {getGuestPublicSiteKey}=await import("@/lib/guest/server/public-config");expect(await getGuestPublicSiteKey()).toBe("public-site");
});
it("keeps compatibility build independent of Workers bindings",async()=>{
  vi.stubEnv("KAIROS_NEXT_COMPAT_BUILD","1");const {getGuestPublicSiteKey}=await import("@/lib/guest/server/public-config");expect(await getGuestPublicSiteKey()).toBe("");expect(bindings.load).not.toHaveBeenCalled();
});
