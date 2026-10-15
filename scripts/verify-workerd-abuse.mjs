// Isolated native workerd: two services share synthetic D1; no production/network credentials.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=join(root,'artifacts','workerd-abuse',String(Date.now()));
await mkdir(directory,{recursive:true});let mf;let stage='build';
const entry=`
import {resolveAbuseRuntime} from './src/lib/platform/abuse-runtime';
import {enforceBudget,abuseErrorResponse} from './src/lib/abuse/guard';
function counted(db){
 const stats={queries:0,rowsRead:0,rowsWritten:0};
 const count=r=>{stats.queries++;stats.rowsRead+=r.meta.rows_read??0;stats.rowsWritten+=r.meta.rows_written??0;return r;};
 function statement(s){return {
  bind:(...p)=>statement(s.bind(...p)),
  all:async()=>count(await s.all()),run:async()=>count(await s.run()),
  first:async()=>count(await s.all()).results[0]??null,
 };}
 return {db:{prepare:sql=>statement(db.prepare(sql)),batch:db.batch.bind(db),exec:db.exec.bind(db)},stats};
}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/init'){for(const sql of __MIGRATIONS__)await env.DB.prepare(sql).run();await env.DB.prepare("INSERT INTO users(id) VALUES ('synthetic-budget-a'),('synthetic-budget-b')").run();return Response.json({ok:true});}
 if(path==='/expire'){await env.DB.prepare("UPDATE abuse_rate_events SET admitted_at_ms=admitted_at_ms-600001 WHERE user_id='synthetic-budget-a'").run();return Response.json({ok:true});}
 if(path!=='/budget'&&path!=='/other')return new Response(null,{status:404});
 const measured=counted(env.DB),runtime={...resolveAbuseRuntime(env),db:measured.db};
 try{await enforceBudget(runtime,{class:'sync-all',userId:path==='/other'?'synthetic-budget-b':'synthetic-budget-a'});return Response.json({allowed:true,...measured.stats});}
 catch(error){const rejected=abuseErrorResponse(error);return Response.json({allowed:false,...measured.stats},{status:rejected?.status??500});}
}};`;
const results=[];
function check(name,ok){results.push({name,ok});if(!ok)throw new Error('ABUSE_PROBE_FAILED');}
try{
  const migrations=(await Promise.all((await readdir(join(root,'migrations'))).filter(n=>/^\d+.*\.sql$/.test(n)).sort().map(n=>readFile(join(root,'migrations',n),'utf8'))))
    .join('\n').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
  await build({stdin:{contents:entry.replace('__MIGRATIONS__',JSON.stringify(migrations)),resolveDir:root,sourcefile:'abuse-probe.ts',loader:'ts'},
    outfile:join(directory,'worker.mjs'),bundle:true,format:'esm',platform:'browser',logLevel:'silent',external:['node:*','cloudflare:workers'],
    plugins:[{name:'server-only-probe',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
  const script=await readFile(join(directory,'worker.mjs'),'utf8');
  const bindings={KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback',
    KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),KAIROS_CREDENTIAL_KEY_V1:Buffer.from(new Uint8Array(32).fill(9)).toString('base64url'),
    KAIROS_TURNSTILE_SITE_KEY:'synthetic-site',KAIROS_TURNSTILE_SECRET_KEY:'synthetic-secret'};
  const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),resourcePersistencePath:join(directory,'state'),
    workers:['first','second'].map(name=>({name,script,modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],bindings,d1Databases:{DB:'synthetic-shared-budget'}}))});
  options.telemetry={enabled:false};mf=new Miniflare(options);await mf.ready;
  stage='schema';
  const workers=await Promise.all(['first','second'].map(name=>mf.getWorker(name)));
  check('schema initialized',(await workers[0].fetch('http://localhost/init')).ok);
  stage='admission';
  const responses=await Promise.all(Array.from({length:40},(_,i)=>workers[i%2].fetch('http://localhost/budget')));
  const accepted=responses.filter(r=>r.status===200),rejected=responses.filter(r=>r.status===429);
  check('atomic six-request admission across independent services',accepted.length===6&&rejected.length===34);
  const successMetrics=await accepted[0].json(),denialMetrics=await rejected[0].json();
  check('other actor independent',(await workers[1].fetch('http://localhost/other')).ok);
  check('exhausted actor still rejected',(await workers[1].fetch('http://localhost/budget')).status===429);
  check('controlled expiry applied',(await workers[0].fetch('http://localhost/expire')).ok);
  check('rolling window resets',(await workers[1].fetch('http://localhost/budget')).ok);
  check('known admission query costs',successMetrics.queries===1&&denialMetrics.queries===2);
  const summary={native:'workerd',workers:2,externalRequests:0,allowed:6,rejected:34,
    admissionOnly:{accepted:{queries:successMetrics.queries,rowsRead:successMetrics.rowsRead,rowsWritten:successMetrics.rowsWritten},
      rejected:{queries:denialMetrics.queries,rowsRead:denialMetrics.rowsRead,rowsWritten:denialMetrics.rowsWritten}},results};
  await writeFile(join(directory,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({code:'ABUSE_ADMISSION_PROBE_PASSED',scope:'admission',overallComplete:false,...summary}));
  await mf.dispose();mf=undefined;
  stage='ownership';
  const ownership=spawnSync(process.execPath,[join(root,'tests/helpers/workerd-operation-locks.mjs')],{cwd:root,env:process.env,encoding:'utf8',timeout:60000,windowsHide:true});
  if(ownership.status!==0||ownership.error||!ownership.stdout.includes('native workerd ownership:'))throw new Error('ABUSE_PROBE_FAILED');
  console.log(JSON.stringify({code:'ABUSE_PROBE_PASSED',scope:'admission-and-ownership',overallComplete:true,externalRequests:0}));
}catch{console.error(JSON.stringify({code:'ABUSE_PROBE_FAILED',stage}));process.exitCode=1;}
finally{if(mf)await mf.dispose();}
