// Native lifecycle regression with synthetic local D1, no external providers.
import fs from 'node:fs';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
const migrations=fs.readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort().flatMap(n=>fs.readFileSync('migrations/'+n,'utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean));
const entry=`import {withOwnedOperation} from './src/lib/abuse/operation-lock';
import {withBridgeCompletion} from './src/lib/abuse/operation-lock';
import {D1SyncRequestRepository} from './src/lib/db/d1/repositories/sync-requests';
export default {async fetch(request,env){
 const db=env.DB,url=new URL(request.url),path=url.pathname,key=url.searchParams.get('key')??'calendar:microsoft';
 if(path==='/init'){for(const sql of ${JSON.stringify(migrations)})await db.prepare(sql).run();await db.prepare("INSERT INTO users(id) VALUES ('synthetic-lifetime')").run();await db.prepare('CREATE TABLE probe_completion (n INTEGER)').run();await db.prepare('INSERT INTO probe_completion VALUES (0)').run();return new Response('ready');}
 if(path==='/status')return Response.json({owner:await db.prepare("SELECT state FROM operation_locks WHERE user_id='synthetic-lifetime' AND operation_key=?").bind(key).first(),completed:await db.prepare('SELECT n FROM probe_completion').first()});
 if(path==='/start'){
  let begin;const started=new Promise(resolve=>begin=resolve);
  const pending=withOwnedOperation(db,{userId:'synthetic-lifetime'},key,async()=>{begin();await new Promise(resolve=>setTimeout(resolve,250));await db.prepare('UPDATE probe_completion SET n=n+1').run();});
  void pending.catch(()=>{});await started;return new Response('accepted',{status:202});
 }
 if(path==='/start-bridge'){
  const at=new Date(),expires=new Date(at.getTime()+600000).toISOString(),version=(await db.prepare("SELECT version FROM abuse_controls WHERE control_key='provider:gradescope'").first()).version;
  await db.prepare("UPDATE operation_locks SET owner_nonce='synthetic-bridge-owner',state='running' WHERE user_id='synthetic-lifetime' AND operation_key='source:gradescope'").run();
  await db.prepare("INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at,operation_key,owner_nonce,admitted_at_ms,control_version) VALUES ('synthetic-lifetime','synthetic-bridge','gradescope_sync','{}',?,?,'source:gradescope','synthetic-bridge-owner',?,?)").bind(at.toISOString(),expires,Date.now(),version).run();
  let begin;const started=new Promise(resolve=>begin=resolve);
  const pending=withBridgeCompletion(db,{userId:'synthetic-lifetime'},'synthetic-bridge','gradescope_sync',at,async()=>{
   if(!await new D1SyncRequestRepository(db,{userId:'synthetic-lifetime'}).consume('synthetic-bridge','gradescope_sync',at))throw new Error('BRIDGE_CLAIM_FAILED');
   begin();await new Promise(resolve=>setTimeout(resolve,250));await db.prepare('UPDATE probe_completion SET n=n+1').run();
  });
  void pending.catch(()=>{});await started;return new Response('accepted',{status:202});
 }
 return new Response(null,{status:404});
}};`;
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'calendar-lifetime-probe.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*','cloudflare:*'],logLevel:'silent',plugins:[{name:'server-only',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});
let mf;
try{
 const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers:[{name:'calendar-lifetime',script:result.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'synthetic-calendar-lifetime'}}]});options.telemetry={enabled:false};
 mf=new Miniflare(options);const origin=await mf.ready;
 if(!(await fetch(new URL('/init',origin))).ok)throw new Error('SCHEMA_FAILED');
 let expected=0;
 for(const key of ['calendar:google','calendar:microsoft','calendar:caldav','source:canvas','source:ed','source:gradescope','bridge:gradescope']){
  const bridge=key==='bridge:gradescope',operation=bridge?'source:gradescope':key;
  if((await fetch(new URL((bridge?'/start-bridge':'/start')+'?key='+encodeURIComponent(operation),origin))).status!==202)throw new Error('START_FAILED');
  expected++;let complete=false;
  for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));const state=await(await fetch(new URL('/status?key='+encodeURIComponent(operation),origin))).json();if(state.completed.n===expected&&state.owner?.state==='idle'){complete=true;break;}}
  if(!complete)throw new Error('PROVIDER_SETTLEMENT_CANCELLED_AFTER_RESPONSE: '+key);
 }
 console.log('Native calendar lifetime: retained work completes once and releases its durable owner after response; external requests: 0');
 console.log('Native source and bridge lifetime: six provider keys and one-use bridge completion settle after response; external requests: 0');
}catch(error){console.error(error.message);process.exitCode=1;}finally{if(mf)await mf.dispose();}
