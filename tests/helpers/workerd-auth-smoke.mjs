// Local-only route smoke. All bindings, Siteverify and Auth.js transports are server-owned fixtures.
import {spawn} from "node:child_process";
import {mkdtemp,readFile,readdir,writeFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const directory=await mkdtemp(join(tmpdir(),"kairos-auth-route-smoke-"));
let worker;
let startupLog="";
const entry=`
import {env} from "cloudflare:workers";
import {NextRequest} from "next/server";
import {GET,POST} from "./src/app/api/auth/[...nextauth]/route";
import {startPublicSignIn,getAuthSessionFromHeaders} from "./auth";
import {proxy} from "./src/proxy";
import {Auth} from "@auth/core";
let verifyCalls=0;
globalThis.fetch=async input=>{
  const url=String(input);
  if(url==="https://challenges.cloudflare.com/turnstile/v0/siteverify"){verifyCalls++;return Response.json({success:true,hostname:"mykairos.me",action:"auth_sign_in"});}
  if(url==="https://accounts.google.com/.well-known/openid-configuration")return Response.json({issuer:"https://accounts.google.com",authorization_endpoint:"https://accounts.google.com/o/oauth2/auth",token_endpoint:"https://oauth2.googleapis.com/token",jwks_uri:"https://accounts.google.com/jwks",code_challenge_methods_supported:["S256"]});
  throw new Error("Unexpected fixture transport");
};
const headers=()=>new Headers({origin:"https://mykairos.me","cf-connecting-ip":"203.0.113.8"});
const form=()=>{const data=new FormData();data.set("cf-turnstile-response","fixture-turnstile");return data;};
function request(path,method="GET",data,extra={}){const h=headers();for(const [key,value] of Object.entries(extra))h.set(key,value);return new NextRequest("https://mykairos.me/api/auth/"+path,{method,headers:h,...(data?{body:data}:{})});}
export default {async fetch(requestIn){
  if(new URL(requestIn.url).pathname==="/ready")return new Response("ready");
  for(const sql of __MIGRATIONS__)await env.DB.prepare(sql).run();
  const results=[];
  const check=(name,ok)=>results.push({name,ok});
  check("GET initiation rejected",(await GET(request("signin/google"))).status===405&&verifyCalls===0);
  check("generic sign-in redirect",(await GET(request("signin"))).headers.get("location")==="/sign-in");
  check("missing challenge rejected",(await POST(request("signin/google","POST",new FormData()))).status===400&&verifyCalls===0);
  check("CF-Worker rejected",(await POST(request("signin/google","POST",form(),{"cf-worker":"fixture.invalid"}))).status===400&&verifyCalls===0);
  check("action rejects missing challenge",(await startPublicSignIn("google",new FormData())).code==="AUTH_CHALLENGE_FAILED"&&verifyCalls===0);
  check("session read remains normal",(await GET(request("session"))).status===200&&verifyCalls===0);
  await getAuthSessionFromHeaders(headers());check("private session helper remains normal",verifyCalls===0);
  const coreConfig={secret:"fixture-auth-secret",trustHost:true,basePath:"/api/auth",providers:[{id:"google",name:"Google",type:"oidc",issuer:"https://accounts.google.com",clientId:"fixture-id",clientSecret:"fixture-secret",authorization:"https://accounts.google.com/o/oauth2/auth",checks:["pkce","state"]}],logger:{error(){},warn(){},debug(){}}};
  const csrf=await Auth(new Request("https://mykairos.me/api/auth/csrf"),coreConfig);
  const csrfToken=(await csrf.json()).csrfToken;
  const csrfCookies=csrf.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const h=headers();h.set("content-type","application/x-www-form-urlencoded");h.set("cookie",csrfCookies);
  const admitted=await POST(new NextRequest("https://mykairos.me/api/auth/signin/google",{method:"POST",headers:h,body:new URLSearchParams({csrfToken,"cf-turnstile-response":"fixture-turnstile"})}));
  const location=admitted.headers.get("location");
  const rejected=await admitted.clone().json().catch(()=>null);
  const fixedCode=typeof rejected?.code==="string"&&/^(?:AUTH|ABUSE)_[A-Z_]+$/.test(rejected.code)?rejected.code:"none";
  check("admission diagnostic status "+admitted.status+" code "+fixedCode+" verification count "+verifyCalls,admitted.status===302);
  check("CSRF admitted start",admitted.status===302&&!!location&&new URL(location).searchParams.has("code_challenge"));
  const state=new URL(location).searchParams.get("state");
  const stamp=admitted.headers.getSetCookie().find(value=>value.startsWith("kairos.auth-attempt.google="))?.split(";")[0];
  check("signed attempt issued",!!stamp);
  await env.DB.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:initiation'").run();
  check("global shutdown blocks starts",(await POST(request("signin/google","POST",form()))).status===503&&verifyCalls===1);
  await env.DB.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='auth:google'").run();
  await env.DB.prepare("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='auth:google'").run();
  check("reopen rejects pending callback",(await GET(request("callback/google?state="+encodeURIComponent(state),"GET",undefined,{cookie:stamp}))).status===400&&verifyCalls===1);
  check("proxy rejects cross-origin action",proxy(new NextRequest("https://mykairos.me/sign-in",{method:"POST",headers:{origin:"https://fixture.invalid"}})).status===403);
  check("proxy overwrites pathname",proxy(new NextRequest("https://mykairos.me/sign-in",{headers:{"x-kairos-pathname":"/forged"}})).headers.get("x-middleware-request-x-kairos-pathname")==="/sign-in");
  return Response.json(results);
}};`;
try{
  const migrations=(await Promise.all((await readdir(join(root,"migrations"))).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>readFile(join(root,"migrations",name),"utf8")))).join("\n").replace(/--[^\n]*/g,"").split(";").map(sql=>sql.trim()).filter(Boolean);
  await build({stdin:{contents:entry.replace("__MIGRATIONS__",JSON.stringify(migrations)),resolveDir:root,sourcefile:"auth-route-smoke.ts",loader:"ts"},
    outfile:join(directory,"worker.mjs"),bundle:true,format:"esm",platform:"browser",external:["node:*","cloudflare:workers"],
    plugins:[{name:"server-owned-fixtures",setup(api){
      // Match the application's Vite alias; Next's Node entry is not the Worker runtime.
      api.onResolve({filter:/^next\/server$/},()=>({path:join(root,"node_modules/vinext/dist/shims/server.js")}));
      api.onResolve({filter:/^(server-only|next-auth|next\/headers|next\/navigation)$/},args=>({path:args.path,namespace:"fixture"}));
      api.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",resolveDir:root,contents:args.path==="server-only"?"":args.path==="next/headers"
        ?'export async function headers(){return new Headers({origin:"https://mykairos.me","cf-connecting-ip":"203.0.113.8"});} export async function cookies(){return {set(){}};}'
        :args.path==="next/navigation"?'export function redirect(){throw new Error("Fixture redirect");}'
        :'import {Auth} from "@auth/core";export default function NextAuth(config){const handler=request=>Auth(request,{...config,trustHost:true,basePath:"/api/auth"});return {handlers:{GET:handler,POST:handler},auth:async()=>null,signIn:async()=>{throw new Error("Unexpected fixture signIn");},signOut:async()=>{}};}'}));
    }}]});
  await writeFile(join(directory,"wrangler.json"),JSON.stringify({name:"kairos-auth-local-smoke",main:"worker.mjs",compatibility_date:"2026-10-06",compatibility_flags:["nodejs_compat"],observability:{enabled:false},
    vars:{KAIROS_APP_URL:"https://mykairos.me",AUTH_URL:"https://mykairos.me",AUTH_SECRET:"fixture-auth-secret",AUTH_GOOGLE_ID:"fixture-id",AUTH_GOOGLE_SECRET:"fixture-secret",AUTH_MICROSOFT_ENTRA_ID_ID:"fixture-id",AUTH_MICROSOFT_ENTRA_ID_SECRET:"fixture-secret",KAIROS_TURNSTILE_SITE_KEY:"fixture-site",KAIROS_TURNSTILE_SECRET_KEY:"fixture-secret",KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),KAIROS_ABUSE_TRUSTED_INGRESS:"cloudflare"},
    d1_databases:[{binding:"DB",database_name:"auth-smoke-fixture",database_id:"00000000-0000-0000-0000-000000000000"}]}));
  const socket=createServer();await new Promise(ok=>socket.listen(0,"127.0.0.1",ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
  worker=spawn(process.execPath,[join(root,"node_modules/wrangler/bin/wrangler.js"),"dev","--local","--config",join(directory,"wrangler.json"),"--port",String(port),"--ip","127.0.0.1","--persist-to",join(directory,"state")],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:"false",NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]});
  // Drain native streams without echoing request/binding metadata. Only fixed test results are reported.
  for(const stream of [worker.stdout,worker.stderr]){stream.setEncoding("utf8");stream.on("data",chunk=>{startupLog=(startupLog+chunk).slice(-12000);});}
  let ready=false;
  for(let i=0;i<120;i++){
    if(worker.exitCode!==null)break;
    try{if((await fetch(`http://127.0.0.1:${port}/ready`,{signal:AbortSignal.timeout(300)})).ok){ready=true;break;}}catch{}
    await new Promise(ok=>setTimeout(ok,250));
  }
  if(!ready){
    const categories=["SyntaxError","ReferenceError","TypeError","Uncaught","not supported","No such module","Could not resolve","Cannot find","Unexpected token","node:module","node:async_hooks","cloudflare:workers","Failed to start","EADDRINUSE","Could not proxy"];
    console.error("Startup diagnostic categories: "+categories.filter(value=>startupLog.includes(value)).join(", "));
    const missing=startupLog.match(/ReferenceError: ([A-Za-z_$][A-Za-z0-9_$]*) is not defined/);
    if(missing)console.error("Missing runtime identifier: "+missing[1]);
    throw new Error("WORKER_START_FAILED");
  }
  const response=await fetch(`http://127.0.0.1:${port}/probe`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok){
    const categories=["TypeError","ReferenceError","RangeError","D1_ERROR","D1_EXEC_ERROR","SQLITE_ERROR","incomplete input","syntax error","no such table","getSetCookie","getAuthSessionFromHeaders","nextUrl","Invalid URL","body","prepare","binding","already exists","database"];
    console.error("Route diagnostic categories: "+categories.filter(value=>startupLog.includes(value)).join(", "));
    throw new Error("WORKER_ROUTE_FAILED");
  }
  const results=await response.json();
  for(const result of results)console.log(`${result.ok?"PASS":"FAIL"}: ${result.name}`);
  if(results.some(result=>!result.ok))throw new Error("WORKER_ASSERTION_FAILED");
  console.log(`workerd auth route smoke: ${results.length}/${results.length} passed; external requests: 0`);
}catch(error){console.error(["WORKER_START_FAILED","WORKER_ROUTE_FAILED","WORKER_ASSERTION_FAILED"].includes(error.message)?error.message:"WORKER_SMOKE_FAILED");process.exitCode=1;}
finally{
  if(worker&&worker.exitCode===null){
    if(process.platform==="win32")await new Promise(ok=>spawn("taskkill",["/PID",String(worker.pid),"/T","/F"],{stdio:"ignore"}).once("close",ok));
    else worker.kill("SIGTERM");
  }
  const target=resolve(directory);
  if(!target.startsWith(resolve(tmpdir())+"\\")&&!target.startsWith(resolve(tmpdir())+"/"))throw new Error("Unsafe temporary cleanup target");
  await rm(target,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
