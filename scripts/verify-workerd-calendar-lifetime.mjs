// Native lifecycle regression with synthetic local D1, no external providers.
import fs from 'node:fs';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
const migrations=fs.readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort().flatMap(n=>fs.readFileSync('migrations/'+n,'utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean));
const entry=`import {withOwnedOperation} from './src/lib/abuse/operation-lock';
export default {async fetch(request,env){
 const db=env.DB,path=new URL(request.url).pathname;
 if(path==='/init'){for(const sql of ${JSON.stringify(migrations)})await db.prepare(sql).run();await db.prepare("INSERT INTO users(id) VALUES ('synthetic-lifetime')").run();await db.prepare('CREATE TABLE probe_completion (n INTEGER)').run();await db.prepare('INSERT INTO probe_completion VALUES (0)').run();return new Response('ready');}
 if(path==='/status')return Response.json({owner:await db.prepare("SELECT state FROM operation_locks WHERE user_id='synthetic-lifetime'").first(),completed:await db.prepare('SELECT n FROM probe_completion').first()});
 if(path==='/start'){
  let begin;const started=new Promise(resolve=>begin=resolve);
  const pending=withOwnedOperation(db,{userId:'synthetic-lifetime'},'calendar:microsoft',async()=>{begin();await new Promise(resolve=>setTimeout(resolve,250));await db.prepare('UPDATE probe_completion SET n=n+1').run();});
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
 if((await fetch(new URL('/start',origin))).status!==202)throw new Error('START_FAILED');
 let complete=false;
 for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));const state=await(await fetch(new URL('/status',origin))).json();if(state.completed.n===1&&state.owner?.state==='idle'){complete=true;break;}}
 if(!complete)throw new Error('CALENDAR_SETTLEMENT_CANCELLED_AFTER_RESPONSE');
 console.log('Native calendar lifetime: retained work completes once and releases its durable owner after response; external requests: 0');
}catch(error){console.error(error.message);process.exitCode=1;}finally{if(mf)await mf.dispose();}
