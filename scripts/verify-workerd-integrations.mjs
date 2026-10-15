// Run the real provider clients inside local workerd with deliberately invalid credentials.
// Canvas uses an isolated local HTTP fixture. This tests fetch semantics, not real upstream access.
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {createServer as createHttpServer} from "node:http";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const tmp=await mkdtemp(join(tmpdir(),"kairos-workerd-check-"));
const canvasOnly=process.argv.includes("--canvas-only");
const keepEvidence=process.argv.includes("--keep-evidence");

const entry=`
import {EdApiClient} from "./src/lib/sources/ed/client";
import {GoogleCalendarClient} from "./src/lib/calendar/google/client";
import {MicrosoftCalendarClient} from "./src/lib/calendar/microsoft/client";
import {CalDavClient} from "./src/lib/calendar/caldav/client";
import {fetchCanvasFeed} from "./src/lib/sources/canvas-ical/fetch-feed";

const canvasBase="http://127.0.0.1:__CANVAS_PORT__";
const canvasOnly=__CANVAS_ONLY__;
let forbiddenAttempts=0;
const canvasFixtureFetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.origin!=="https://canvas.uw.edu"){
    forbiddenAttempts++;
    throw new Error("Fixture transport rejected a forbidden destination");
  }
  // Real workerd fetch reaches only the local fixture; URL policy still sees UW URLs.
  return fetch(canvasBase+url.pathname+url.search,init);
};
const canvasUrl=path=>new URL("https://canvas.uw.edu"+path);

async function run(name, action) {
  try { await action(); return {provider:name, code:"OK"}; }
  catch (error) { return {provider:name, code:typeof error?.code==="string"?error.code:"UNEXPECTED_ERROR"}; }
}
export default {
  async fetch(request) {
    if(new URL(request.url).pathname==="/ready")return new Response("ready");
    const results=await Promise.all([
      ...(!canvasOnly?[
      run("ed",()=>new EdApiClient("invalid-worker-probe-token").fetchUser()),
      run("google",()=>new GoogleCalendarClient("invalid-worker-probe-token").getCalendar("invalid-probe-id")),
      run("microsoft",()=>new MicrosoftCalendarClient("invalid-worker-probe-token").getCalendar("invalid-probe-id")),
      run("caldav",()=>new CalDavClient("invalid-probe@example.com","invalid-probe-secret").discoverCalendars()),
      ]:[]),
      run("canvas-ok",()=>fetchCanvasFeed(canvasUrl("/canvas-ok"),canvasFixtureFetch)),
      run("canvas-401",()=>fetchCanvasFeed(canvasUrl("/canvas-401"),canvasFixtureFetch)),
      run("canvas-403",()=>fetchCanvasFeed(canvasUrl("/canvas-403"),canvasFixtureFetch)),
      run("canvas-redirect",()=>fetchCanvasFeed(canvasUrl("/canvas-redirect"),canvasFixtureFetch)),
      run("canvas-initial-unsupported",()=>fetchCanvasFeed(new URL("https://unsupported.example.invalid/feed.ics"),canvasFixtureFetch)),
      run("canvas-redirect-escape",()=>fetchCanvasFeed(canvasUrl("/canvas-escape"),canvasFixtureFetch)),
      run("canvas-later-hop-escape",()=>fetchCanvasFeed(canvasUrl("/canvas-hop-one"),canvasFixtureFetch)),
      run("canvas-redirect-loop",()=>fetchCanvasFeed(canvasUrl("/canvas-loop"),canvasFixtureFetch)),
    ]);
    results.push({provider:"canvas-forbidden-transport",code:forbiddenAttempts===0?"OK":"UNEXPECTED_ERROR"});
    return Response.json(results);
  },
};`;

async function availablePort(){
  const server=createServer();
  await new Promise((ok,reject)=>server.once("error",reject).listen(0,"127.0.0.1",ok));
  const port=server.address().port;
  await new Promise(ok=>server.close(ok));
  return port;
}

let worker;
let canvasStub;
let workerLog="";
let canvasRequestHeaders;
let forbiddenRequests=0;
try{
  canvasStub=createHttpServer((request,response)=>{
    const path=new URL(request.url,"http://localhost").pathname;
    if(path==="/canvas-forbidden")forbiddenRequests++;
    if(path==="/canvas-ok"||path==="/canvas-agent-required"){
      canvasRequestHeaders={
        acceptsCalendar:request.headers.accept?.includes("text/calendar")??false,
        hasUserAgent:typeof request.headers["user-agent"]==="string",
      };
    }
    const redirects={
      "/canvas-redirect":"/canvas-agent-required",
      "/canvas-escape":`http://${request.headers.host}/canvas-forbidden`,
      "/canvas-hop-one":"/canvas-hop-two",
      "/canvas-hop-two":`http://${request.headers.host}/canvas-forbidden`,
      "/canvas-loop":"/canvas-loop",
    };
    if(redirects[path]){
      response.writeHead(302,{location:redirects[path]});
      response.end();
      return;
    }
    const status=path==="/canvas-ok"?200
      :path==="/canvas-agent-required"?(/^Kairos\//.test(request.headers["user-agent"]??"")?200:403)
      :path==="/canvas-401"?401:path==="/canvas-403"?403:404;
    response.writeHead(status,{"content-type":status===200?"text/calendar":"text/plain"});
    response.end(status===200?"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n":"fixture response");
  });
  await new Promise((ok,reject)=>canvasStub.once("error",reject).listen(0,"127.0.0.1",ok));
  const canvasPort=canvasStub.address().port;
  await build({
    stdin:{contents:entry.replace("__CANVAS_PORT__",String(canvasPort)).replace("__CANVAS_ONLY__",String(canvasOnly)),resolveDir:root,sourcefile:"workerd-probe.ts",loader:"ts"},
    absWorkingDir:root,
    outfile:join(tmp,"worker.mjs"),
    bundle:true,
    format:"esm",
    platform:"browser",
    mainFields:["browser","module","main"],
    external:["node:*"],
    plugins:[{
      name:"ignore-next-server-only-marker",
      setup(api){
        api.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"empty"}));
        api.onLoad({filter:/.*/,namespace:"empty"},()=>({contents:"",loader:"js"}));
      },
    }],
  });
  await writeFile(join(tmp,"wrangler.json"),JSON.stringify({
    name:"kairos-workerd-integration-check",
    main:"./worker.mjs",
    compatibility_date:"2026-10-06",
    compatibility_flags:["nodejs_compat"],
  }));
  const port=await availablePort();
  worker=spawn(process.execPath,[
    join(root,"node_modules/wrangler/bin/wrangler.js"),"dev","--local",
    "--config",join(tmp,"wrangler.json"),"--port",String(port),
    "--ip","127.0.0.1","--persist-to",join(tmp,"state"),
  ],{cwd:root,env:{...process.env,NO_COLOR:"1"},stdio:["ignore","pipe","pipe"]});
  for(const stream of [worker.stdout,worker.stderr]){
    stream.setEncoding("utf8");
    stream.on("data",chunk=>{workerLog=(workerLog+chunk).slice(-6000);});
  }

  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<120;i++){
    if(worker.exitCode!==null)break;
    try{const response=await fetch(base+"/ready",{signal:AbortSignal.timeout(350)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(ok=>setTimeout(ok,250));
  }
  if(!ready)throw new Error("Local workerd did not start. "+workerLog);
  const response=await fetch(base+"/probe",{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error("workerd probe returned HTTP "+response.status);
  const results=await response.json();
  for(const result of results)console.log(`${result.provider}: ${result.code}`);
  const failures=results.filter(result=>result.code==="UNEXPECTED_ERROR"||(result.code.endsWith("NETWORK_ERROR")&&result.provider!=="canvas-redirect-loop"));
  if(failures.length)throw new Error("Fetch failed inside workerd for: "+failures.map(r=>r.provider).join(", "));
  const canvasExpected={
    "canvas-ok":"OK","canvas-401":"UNAUTHORIZED_OR_EXPIRED_FEED","canvas-403":"UNAUTHORIZED_OR_EXPIRED_FEED","canvas-redirect":"OK",
    "canvas-initial-unsupported":"INVALID_FEED_URL","canvas-redirect-escape":"INVALID_FEED_URL",
    "canvas-later-hop-escape":"INVALID_FEED_URL","canvas-redirect-loop":"NETWORK_ERROR","canvas-forbidden-transport":"OK",
  };
  for(const [provider,expected] of Object.entries(canvasExpected)){
    if(results.find(result=>result.provider===provider)?.code!==expected){
      throw new Error(`Canvas workerd fixture ${provider} did not return ${expected}`);
    }
  }
  if(!canvasRequestHeaders?.acceptsCalendar)throw new Error("Canvas workerd request omitted the calendar Accept header");
  if(!canvasRequestHeaders?.hasUserAgent)throw new Error("Canvas workerd request omitted the required User-Agent header");
  if(forbiddenRequests!==0)throw new Error("Canvas workerd requested a forbidden redirect destination");
  console.log(`canvas outbound User-Agent present: ${canvasRequestHeaders.hasUserAgent}`);
  console.log(`canvas forbidden requests: ${forbiddenRequests}`);
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}finally{
  if(worker&&worker.exitCode===null){
    if(process.platform==="win32"){
      await new Promise(ok=>spawn("taskkill",["/PID",String(worker.pid),"/T","/F"],{stdio:"ignore"}).once("close",ok));
    }else worker.kill("SIGTERM");
  }
  if(canvasStub)await new Promise(ok=>canvasStub.close(ok));
  if(keepEvidence)console.log("workerd evidence retained: "+tmp);
  else await rm(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
