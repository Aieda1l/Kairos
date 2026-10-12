// Local-only native workerd probe: two distinct Worker services, one synthetic
// D1 database, and a separately observed HTTP transport. No application fixture
// switch, production config, external provider, or raw ownership diagnostics.
import {createServer} from "node:http";
import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from "miniflare";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const setOnly=process.argv.includes("--set-only");
const directory=join(root,"artifacts/task7b-4",`workerd-${Date.now()}`);
await mkdir(directory,{recursive:true});
const counts=new Map(),held=new Map();
const transport=createServer((request,response)=>{
  const path=new URL(request.url,"http://localhost").pathname;
  counts.set(path,(counts.get(path)??0)+1);
  if(path.endsWith("hold")){const pending=held.get(path)??[];pending.push(response);held.set(path,pending);return;}
  if(path==="/throttle"){response.writeHead(429,{"Retry-After":"5"});response.end();return;}
  response.setHeader("content-type","application/json");
  response.end(JSON.stringify(path.startsWith("/cal")?{remoteEventId:"synthetic-event",etag:null}:{user:{id:1},courses:[]}));
});
await new Promise(ok=>transport.listen(0,"127.0.0.1",ok));
const origin=`http://127.0.0.1:${transport.address().port}`;
const entry=`
import {resolveAbuseRuntime} from "./src/lib/platform/abuse-runtime";
import {withOwnedOperation,ownedFetch,uncertainOwnedWork,acquireOperation,runWithOperationOwnership,releaseOperation} from "./src/lib/abuse/operation-lock";
import {prepareOwned} from "./src/lib/db/d1/owned-mutation";
import {abuseErrorResponse} from "./src/lib/abuse/guard";
import {connectEd} from "./src/lib/ed/discovery-service";
import {startGradescopeDiscovery,completeGradescopeDiscovery} from "./src/lib/gradescope/discovery-service";
import {D1SourceConnectionRepository} from "./src/lib/db/d1/repositories/source-connections";
import {D1AssignmentRepository} from "./src/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "./src/lib/db/d1/repositories/calendar-connections";
import {reconcileCalendarConnection,reconcileAllCalendars} from "./src/lib/calendar/reconcile";
import {reconcileCalendarsAfterSourceWrite} from "./src/lib/calendar/post-source-sync";
import {connectOAuthCalendar} from "./src/lib/calendar/connection-service";
import {CalendarSyncError} from "./src/lib/calendar/errors";
const scope={userId:"synthetic-owner"},other={userId:"synthetic-other"};
const keyring={activeKeyId:"fixture",keys:{fixture:new Uint8Array(32).fill(9)}};
const origin=__ORIGIN__;
const transport=path=>()=>fetch(origin+path);
const calendarFactory=path=>async()=>({provider:"google",testConnection:async()=>{},ensureCalendar:async()=>({remoteCalendarId:"synthetic-calendar",name:"Synthetic"}),getEvent:async()=>null,
 createEvent:async()=>{const response=await ownedFetch(fetch)(origin+path,{method:"POST"});if(response.status===429)throw new CalendarSyncError("CALENDAR_RATE_LIMITED","Synthetic throttle");return response.json();},
 updateEvent:async()=>({remoteEventId:"synthetic-event",etag:null}),deleteEvent:async()=>{}});
async function calendar(db){return db.prepare("SELECT id FROM calendar_connections WHERE user_id=? AND provider='google'").bind(scope.userId).first();}
let issued,issuedWork;
export default {async fetch(request,env,ctx){
 const db=env.DB,path=new URL(request.url).pathname,runtime=resolveAbuseRuntime(env);
 try{
  if(path==="/ready")return new Response("ready");
  if(path==="/init"){
   for(const sql of __MIGRATIONS__)await db.prepare(sql).run();
   await db.prepare("INSERT INTO users(id) VALUES (?),(?)").bind(scope.userId,other.userId).run();return Response.json({ok:true});
  }
  if(path==="/set-regressions"){
   const connections=new D1CalendarConnectionRepository(db,scope);
   const connection=await connections.create({provider:"google",label:"Synthetic"});
   const results=[];
   const rejects=[
    ["quoted WHERE UPDATE",false,"label='WHERE', provider='microsoft'"],
    ["nested WHERE UPDATE",false,"label=(SELECT 'Synthetic' WHERE 1), provider='microsoft'"],
    ["quoted WHERE conflict",true,"label='WHERE', provider='microsoft'"],
    ["nested WHERE conflict",true,"label=(SELECT 'Synthetic' WHERE 1), provider='microsoft'"],
    ["tuple UPDATE",false,"(label,provider)=('WHERE','microsoft')"],
    ["quoted identifier UPDATE",false,"label='WHERE', \\\"provider\\\"='microsoft'"],
    ["tuple conflict",true,"(label,provider)=('WHERE','microsoft')"],
    ["quoted identifier conflict",true,"label='WHERE', \\\"provider\\\"='microsoft'"],
   ];
   for(const [name,conflict,set] of rejects){
    const before=JSON.stringify(await connections.getById(connection.id));let rejected=false;
    await withOwnedOperation(db,scope,"calendar:google",async()=>{
     const sql=conflict?"INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES (?,?,'google','Synthetic','2026-10-12','2026-10-12') ON CONFLICT(user_id,id) DO UPDATE SET "+set+" WHERE 1"
      :"UPDATE calendar_connections SET "+set+" WHERE user_id=? AND id=?";
     try{await prepareOwned(db,scope,sql,{kind:"calendar",id:connection.id}).bind(scope.userId,connection.id).run();}catch(error){rejected=error.message==="Unsupported owned mutation";}
    });
    results.push({name:"native SET rejects "+name,ok:rejected&&JSON.stringify(await connections.getById(connection.id))===before});
   }
   for(const [name,conflict,set,label] of [
    ["mutable literal UPDATE",false,"label='WHERE'","WHERE"],
    ["mutable subquery UPDATE",false,"label=(SELECT 'Synthetic' WHERE 1)","Synthetic"],
    ["mutable literal conflict without outer WHERE",true,"label='WHERE'","WHERE"],
    ["mutable subquery conflict",true,"label=(SELECT 'Synthetic' WHERE 1)","Synthetic"],
   ]){
    await withOwnedOperation(db,scope,"calendar:google",async()=>{
     const sql=conflict?"INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES (?,?,'google','Synthetic','2026-10-12','2026-10-12') ON CONFLICT(user_id,id) DO UPDATE SET "+set
      :"UPDATE calendar_connections SET "+set+" WHERE user_id=? AND id=?";
     await prepareOwned(db,scope,sql,{kind:"calendar",id:connection.id}).bind(scope.userId,connection.id).run();
    });
    const after=await connections.getById(connection.id);
    results.push({name:"native SET supports "+name,ok:after.label===label&&after.provider==="google"});
   }
   return Response.json(results);
  }
  if(path==="/source-hold"||path==="/source-compete"||path==="/source-other"){
   await connectEd(db,path==="/source-other"?other:scope,keyring,"synthetic-token",transport(path==="/source-hold"?"/source-hold":path==="/source-other"?"/other":"/competing"));return Response.json({ok:true});
  }
  if(path==="/stale-ed"){await db.prepare("UPDATE operation_locks SET stale_at_ms=started_at_ms WHERE user_id=? AND operation_key='source:ed'").bind(scope.userId).run();return Response.json({ok:true});}
  if(path==="/issued-start"){
   issued=await acquireOperation(runtime,scope,"source:ed");
   issuedWork=runWithOperationOwnership(issued,()=>ownedFetch(fetch)(origin+"/issued-hold"));
   ctx.waitUntil(issuedWork.catch(()=>undefined));
   const duplicate=await runWithOperationOwnership(issued,()=>fetch(origin+"/issued-competing")).then(()=>false,error=>error.code==="SYNC_IN_PROGRESS");
   return Response.json({duplicate});
  }
  if(path==="/issued-release"){
   const refused=!(await releaseOperation(issued));
   const row=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='source:ed'").bind(scope.userId).first();
   return Response.json({refused,running:row.state==="running"});
  }
  if(path==="/issued-complete"){await issuedWork;return Response.json({ok:true});}
  if(path==="/sql-regressions"){
   const source=await new D1SourceConnectionRepository(db,scope).getByKind("ed");let update,remove;
   await withOwnedOperation(db,scope,"source:ed",async()=>{
    update=prepareOwned(db,scope,"UPDATE source_connections SET label=? WHERE user_id=? OR id=?",{kind:"source",id:source.id}).bind("Changed",scope.userId,source.id);
    remove=prepareOwned(db,scope,"DELETE FROM source_connections WHERE user_id=? OR id=?",{kind:"source",id:source.id}).bind(scope.userId,source.id);
   });
   const replacement=await acquireOperation(runtime,scope,"source:ed");
   const updated=await update.run(),deleted=await remove.run();await releaseOperation(replacement);
   const after=await new D1SourceConnectionRepository(db,scope).getByKind("ed");
   const connection=await calendar(db),connections=new D1CalendarConnectionRepository(db,scope),before=await connections.getById(connection.id);
   await db.prepare("UPDATE operation_locks SET state='uncertain' WHERE user_id=? AND operation_key='calendar:google'").bind(scope.userId).run();
   const wrongSource=await withOwnedOperation(db,scope,"source:ed",()=>connections.updateRemoteCalendar(connection.id,"changed","Changed")).then(()=>false,error=>error.code==="SYNC_RECOVERY_REQUIRED");
   const wrongProvider=await withOwnedOperation(db,scope,"calendar:microsoft",()=>connections.updateRemoteCalendar(connection.id,"changed","Changed")).then(()=>false,error=>error.code==="SYNC_RECOVERY_REQUIRED");
   const retained=await connections.getById(connection.id);
   const target=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='calendar:google'").bind(scope.userId).first();
   return Response.json({orUpdate:updated.meta.changes===0,orDelete:deleted.meta.changes===0,sourceRetained:after?.label===source.label,wrongSource,wrongProvider,calendarRetained:retained.remoteCalendarId===before.remoteCalendarId&&target.state==="uncertain"});
  }
  if(path==="/version-regression"){
   const row=await db.prepare("SELECT version FROM abuse_controls WHERE control_key='provider:canvas'").first();
   await db.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
   await db.prepare("UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='provider:canvas'").run();
   const rejected=await withOwnedOperation(db,scope,"source:canvas",()=>fetch(origin+"/version-competing"),{expectedControlVersion:row.version}).then(()=>false,error=>error.code==="PROVIDER_AUTHORIZATION_CHANGED");
   return Response.json({rejected});
  }
  if(path==="/bridge-start")return Response.json(await startGradescopeDiscovery(db,scope));
  if(path==="/bridge-complete"||path==="/bridge-foreign"){
   const row=await db.prepare("SELECT request_id FROM sync_requests WHERE user_id=? ORDER BY rowid DESC LIMIT 1").bind(scope.userId).first();
   await completeGradescopeDiscovery(db,path==="/bridge-foreign"?other:scope,{requestId:row.request_id,protocolVersion:1,courses:[],errorCode:null});return Response.json({ok:true});
  }
  if(path==="/bridge-expire"){await db.prepare("UPDATE sync_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=? AND consumed_at IS NULL").bind(scope.userId).run();return Response.json({ok:true});}
  if(path==="/seed-calendar"){
   const source=await new D1SourceConnectionRepository(db,scope).upsertCanvas("Synthetic");
   const rows=Array.from({length:150},(_,i)=>({source:"canvas",externalId:"synthetic-"+i,courseId:null,courseName:"Synthetic",title:"Synthetic",releaseAt:null,dueAt:"2026-11-01T00:00:00.000Z",lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}));
   await withOwnedOperation(db,scope,"source:canvas",async()=>{const repo=new D1AssignmentRepository(db,scope);await db.batch([repo.prepareUpsertMany(source.id,rows,new Date().toISOString())]);});
   const connections=new D1CalendarConnectionRepository(db,scope);const connection=await connections.create({provider:"google",label:"Synthetic"});await connections.updateRemoteCalendar(connection.id,"synthetic-calendar","Synthetic");return Response.json({ok:true});
  }
  if(path==="/calendar-hold"||path==="/calendar-compete"||path==="/calendar-throttle"){
   const connection=await calendar(db);await reconcileCalendarConnection(db,scope,connection.id,{adapterFactory:calendarFactory(path==="/calendar-hold"?"/cal-hold":path==="/calendar-throttle"?"/throttle":"/cal-competing")});return Response.json({ok:true});
  }
  if(path==="/calendar-auto"){await reconcileCalendarsAfterSourceWrite(db,scope,keyring,{defer:false,changed:true,adapterFactory:calendarFactory("/cal-competing")});return Response.json({ok:true});}
  if(path==="/calendar-all"){await reconcileAllCalendars(db,scope,{adapterFactory:calendarFactory("/cal-competing")});return Response.json({ok:true});}
  if(path==="/calendar-connect"){const connection=await calendar(db);await connectOAuthCalendar(db,scope,keyring,{provider:"google",connectionId:connection.id,accessToken:"synthetic-token",refreshToken:"synthetic-token",fetchImpl:transport("/cal-competing")});return Response.json({ok:true});}
  if(path==="/summary"){
   const row=await db.prepare("SELECT state,not_before_ms-CAST(strftime('%s','now') AS INTEGER)*1000 AS cooldown FROM operation_locks WHERE user_id=? AND operation_key='calendar:google'").bind(scope.userId).first();
   const count=await db.prepare("SELECT count(*) AS n FROM assignments WHERE user_id=?").bind(scope.userId).first();return Response.json({state:row?.state??null,cooldown:row?.cooldown??0,assignments:count.n});
  }
  if(path==="/abandon"){
   // A separate request begins an ambiguous write and remains unresolved. Probe
   // destroys workerd before completion; a fresh process must retain ownership.
   await withOwnedOperation(db,scope,"calendar:microsoft",async()=>{await ownedFetch(fetch)(origin+"/abandon-hold",{method:"POST"});});return Response.json({ok:true});
  }
  if(path==="/stale-abandon"){await db.prepare("UPDATE operation_locks SET stale_at_ms=started_at_ms WHERE operation_key='calendar:microsoft'").run();return Response.json({ok:true});}
  if(path==="/compete-abandon"){await withOwnedOperation(db,scope,"calendar:microsoft",()=>fetch(origin+"/abandon-competing"));return Response.json({ok:true});}
  if(path==="/uncertain"){
   await withOwnedOperation(db,scope,"calendar:caldav",async()=>{uncertainOwnedWork();});return Response.json({ok:true});
  }
  if(path==="/compete-uncertain"){await withOwnedOperation(db,scope,"calendar:caldav",()=>fetch(origin+"/uncertain-competing"));return Response.json({ok:true});}
  return new Response(null,{status:404});
 }catch(error){return abuseErrorResponse(error)??Response.json({code:"PROBE_INTERNAL_FAILURE"},{status:500});}
}};`;
const migrations=(await Promise.all((await readdir(join(root,"migrations"))).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>readFile(join(root,"migrations",name),"utf8")))).join("\n").replace(/--[^\n]*/g,"").split(";").map(sql=>sql.trim()).filter(Boolean);
let mf;const results=[];
const check=(name,ok)=>{results.push({name,ok});console.log(`${ok?"PASS":"FAIL"}: ${name}`);if(!ok)throw new Error("PROBE_ASSERTION_FAILED");};
const count=path=>counts.get(path)??0;
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(ok=>setTimeout(ok,50));}throw new Error("PROBE_TIMEOUT");}
function settle(path){for(const response of held.get(path)??[]){response.setHeader("content-type","application/json");response.end(JSON.stringify(path.startsWith("/cal")?{remoteEventId:"synthetic-event",etag:null}:{user:{id:1},courses:[]}));}held.delete(path);}
const bindings={KAIROS_APP_URL:"http://localhost:3000",AUTH_URL:"http://localhost:3000",KAIROS_LOCAL_AUTH:"loopback",KAIROS_ABUSE_TRUSTED_INGRESS:"loopback",KAIROS_TURNSTILE_SITE_KEY:"synthetic-site",KAIROS_TURNSTILE_SECRET_KEY:"synthetic-secret",KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString("base64url")};
try{
  await build({stdin:{contents:entry.replace("__ORIGIN__",JSON.stringify(origin)).replace("__MIGRATIONS__",JSON.stringify(migrations)),resolveDir:root,sourcefile:"ownership-native.ts",loader:"ts"},outfile:join(directory,"worker.mjs"),bundle:true,format:"esm",platform:"browser",external:["node:*","cloudflare:workers"],plugins:[{name:"server-only-fixture",setup(api){api.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"fixture"}));api.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"",loader:"js"}));}}]});
  const script=await readFile(join(directory,"worker.mjs"),"utf8");
  const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),resourcePersistencePath:join(directory,"state"),workers:["owner","contender"].map(name=>({name,script,modules:true,compatibilityDate:"2026-10-06",compatibilityFlags:["nodejs_compat"],bindings,d1Databases:{DB:"synthetic-shared-ownership"}}))});
  options.telemetry={enabled:false};
  mf=new Miniflare(options);await mf.ready;
  let owner=await mf.getWorker("owner"),contender=await mf.getWorker("contender");
  const call=(worker,path)=>worker.fetch("http://localhost"+path);
  check("synthetic D1 initialization",(await call(owner,"/init")).ok);
  if(setOnly){
    const response=await call(owner,"/set-regressions");
    check("native SET fixture response",response.ok);
    for(const result of await response.json())check(result.name,result.ok);
    console.log(`native workerd SET boundary: ${results.length}/${results.length} passed; external requests: 0`);
  }else{
  const pending=call(owner,"/source-hold");await waitFor(()=>count("/source-hold")===1);
  check("independent Worker excludes unresolved source work",(await call(contender,"/source-compete")).status===409&&count("/competing")===0);
  await call(contender,"/stale-ed");const stale=await call(contender,"/source-compete");
  check("staleness never permits competing transport",stale.status===409&&(await stale.json()).code==="SYNC_RECOVERY_REQUIRED"&&count("/competing")===0);
  check("other actor can perform independent work",(await call(contender,"/source-other")).ok&&count("/other")===1);
  check("other source can own bridge work",(await call(contender,"/bridge-start")).ok);
  settle("/source-hold");check("original owner settles and accepts atomically",(await pending).ok);
  const issuedStart=await (await call(owner,"/issued-start")).json();await waitFor(()=>count("/issued-hold")===1);
  check("issued capability concurrent entry rejected before await",issuedStart.duplicate&&count("/issued-competing")===0);
  const heldExecution=await (await call(owner,"/issued-release")).json();
  check("issued execution refuses early release while transport held",heldExecution.refused&&heldExecution.running);
  check("independent Worker cannot compete with issued execution",(await call(contender,"/source-compete")).status===409&&count("/competing")===0);
  settle("/issued-hold");check("exact issued execution settles and completes",(await call(owner,"/issued-complete")).ok);
  check("bridge duplicate start excluded",(await call(owner,"/bridge-start")).status===409);
  check("foreign bridge completion excluded",(await call(contender,"/bridge-foreign")).status===409);
  check("bridge completion from independent Worker accepted",(await call(owner,"/bridge-complete")).ok);
  check("bridge replay excluded",(await call(contender,"/bridge-complete")).status===409);
  await call(owner,"/bridge-start");await call(contender,"/bridge-expire");
  check("expired bridge requires recovery",(await call(owner,"/bridge-complete")).status===409&&(await call(contender,"/bridge-start")).status===409);
  check("150-row fenced JSON set runs on native D1",(await call(owner,"/seed-calendar")).ok&&(await (await call(owner,"/summary")).json()).assignments===150);
  const calendarPending=call(owner,"/calendar-hold");await waitFor(()=>count("/cal-hold")===4);
  check("exactly four calendar calls held",count("/cal-hold")===4);
  check("manual/all-destination excluded",(await call(contender,"/calendar-compete")).status===409&&(await call(contender,"/calendar-all")).status===409);
  check("automatic reconciliation coalesces and makes zero calls",(await call(contender,"/calendar-auto")).ok&&count("/cal-competing")===0);
  check("connection shares calendar sync ownership",(await call(contender,"/calendar-connect")).status===409&&count("/cal-competing")===0);
  // Return a known rejection to the four existing promises. No new calls are
  // scheduled after these throttle responses; all four settle before release.
  for(const response of held.get("/cal-hold")??[]){response.writeHead(429,{"Retry-After":"5"});response.end();}held.delete("/cal-hold");
  check("all outstanding throttled promises settle",(await calendarPending).ok&&count("/cal-hold")===4);
  const summary=await (await call(contender,"/summary")).json();
  check("cooldown persisted and blocks new calls",summary.state==="idle"&&summary.cooldown>0&&summary.cooldown<=5000&&(await call(contender,"/calendar-compete")).status===429&&count("/cal-competing")===0);
  const sql=await (await call(owner,"/sql-regressions")).json();
  check("native stale OR UPDATE rejected",sql.orUpdate&&sql.sourceRetained);
  check("native stale OR DELETE rejected",sql.orDelete&&sql.sourceRetained);
  check("native wrong source cannot mutate uncertain calendar",sql.wrongSource&&sql.calendarRetained);
  check("native wrong provider cannot mutate uncertain calendar",sql.wrongProvider&&sql.calendarRetained);
  const version=await (await call(contender,"/version-regression")).json();
  check("native stored control version rejects reopened admission",version.rejected&&count("/version-competing")===0);
  const abandoned=call(owner,"/abandon").catch(()=>null);await waitFor(()=>count("/abandon-hold")===1);
  await mf.dispose();mf=undefined;
  mf=new Miniflare(options);await mf.ready;contender=await mf.getWorker("contender");
  const staleInterrupted=await call(contender,"/stale-abandon");const interrupted=await call(contender,"/compete-abandon");
  const interruptedBody=await interrupted.json();console.log("Interruption diagnostics: "+JSON.stringify({staleStatus:staleInterrupted.status,status:interrupted.status,recovery:interruptedBody.code==="SYNC_RECOVERY_REQUIRED",competingCalls:count("/abandon-competing")}));
  check("fresh workerd retains interrupted ownership",interrupted.status===409&&interruptedBody.code==="SYNC_RECOVERY_REQUIRED"&&count("/abandon-competing")===0);
  settle("/abandon-hold");await abandoned;
  check("explicit ambiguity retained",(await call(contender,"/uncertain")).status===409&&(await call(contender,"/compete-uncertain")).status===409&&count("/uncertain-competing")===0);
  console.log(`native workerd ownership: ${results.length}/${results.length} passed; external requests: 0`);
  }
}catch(error){console.error("Diagnostic categories: "+["ERR_VALIDATION","ERR_RUNTIME_FAILURE","SyntaxError","ReferenceError","TypeError","Unexpected","binding","localhost","loopback","D1_ERROR","already exists","node:module","Module"].filter(value=>String(error.code)+String(error.message)+String(error.cause?.message)===value||(String(error.code)+String(error.message)+String(error.cause?.message)).includes(value)).join(", "));console.error(["PROBE_ASSERTION_FAILED","PROBE_TIMEOUT"].includes(error.message)?error.message:"NATIVE_OWNERSHIP_PROBE_FAILED");process.exitCode=1;}
finally{
  if(mf)await mf.dispose();for(const path of held.keys())settle(path);
  transport.closeAllConnections();await new Promise(ok=>transport.close(ok));
  // Evidence/state are retained. No existing ignored artifact is removed.
  await writeFile(join(directory,"summary.json"),JSON.stringify({native:"workerd",workers:2,externalRequests:0,results,exit:process.exitCode??0},null,2));
}
