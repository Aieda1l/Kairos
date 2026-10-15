import {NextResponse,type NextRequest} from "next/server";

export function proxy(request:NextRequest){
  if(!["GET","HEAD","OPTIONS"].includes(request.method)){
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
  const response=NextResponse.next();
  response.headers.set("Referrer-Policy","no-referrer");
  response.headers.set("X-Content-Type-Options","nosniff");
  return response;
}

export const config={matcher:[
  "/api/account",
  "/api/settings/:path*",
  "/api/sources/:path*",
  "/api/calendars/:path*",
]};
