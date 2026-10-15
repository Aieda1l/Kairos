import {NextResponse,type NextRequest} from "next/server";
import {canonicalAppOrigin,enforceRequestOrigin} from "@/lib/security/request-origin";

const callbacks=new Set(["/api/auth/callback/google","/api/auth/callback/microsoft-entra-id",
  "/api/calendars/google/callback","/api/calendars/microsoft/callback"]);

export function proxy(request:NextRequest){
  const pathname=request.nextUrl.pathname;
  const url=new URL(request.url);
  // Version URLs share production bindings. They are storage-health probes,
  // never an alternate entry to identity, onboarding or provider operations.
  if(url.hostname.replace(/\.$/,'').endsWith('.workers.dev')
    &&!(request.method==='GET'&&pathname==='/api/health'&&!url.search)){
    return NextResponse.json({code:'PREVIEW_HEALTH_ONLY'},{status:404,headers:{'cache-control':'no-store'}});
  }
  const initiation=pathname==="/sign-in"||pathname==="/api/auth/signin"||pathname.startsWith("/api/auth/signin/")
    ||pathname==="/api/calendars/sync-all"||request.headers.has("next-action");
  if(initiation&&!["GET","HEAD","OPTIONS"].includes(request.method)){
    try{enforceRequestOrigin(request.headers,canonicalAppOrigin(process.env).origin);}catch{
      return NextResponse.json({code:"UNTRUSTED_ORIGIN",message:"This request must originate from Kairos."},{status:403,headers:{"cache-control":"no-store"}});
    }
  }
  const callback=request.method==="GET"&&callbacks.has(pathname);
  if(!initiation&&!callback&&!["GET","HEAD","OPTIONS"].includes(request.method)){
    const expected=process.env.E2E_FIXTURES==="1"
      ?new URL(request.url).origin
      :process.env.KAIROS_APP_URL?.trim()||new URL(request.url).origin;
    const origin=request.headers.get("origin");
    const site=request.headers.get("sec-fetch-site");
    if((origin!==null&&origin!==expected)
      ||(origin===null&&(site==="cross-site"||site==="same-site"))){
      return NextResponse.json({
        code:"UNTRUSTED_ORIGIN",message:"This request must originate from Kairos.",
      },{status:403,headers:{"cache-control":"no-store"}});
    }
  }
  const headers=new Headers(request.headers);
  headers.set("x-kairos-pathname",pathname);
  let csp:string|undefined;
  if(pathname==="/sign-in"){
    const nonce=btoa(crypto.randomUUID());
    csp=`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: https:; font-src 'self'`;
    headers.set("content-security-policy",csp);
  }
  const response=NextResponse.next({request:{headers}});
  if(csp)response.headers.set("Content-Security-Policy",csp);
  response.headers.set("Referrer-Policy","no-referrer");
  response.headers.set("X-Content-Type-Options","nosniff");
  return response;
}

// URL-based admission must run even when Host is absent or contradictory.
export const config={matcher:['/:path*']};
