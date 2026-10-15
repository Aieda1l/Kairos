// Local diagnostic only. Wall time is not Cloudflare CPU accounting or headroom.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import fs from 'node:fs';

const root=fileURLToPath(new URL('../',import.meta.url));
// Frozen behavior at 4167dc2, before the bounded validation cache.
const baseline=`export function validateTimeZone(value){const trimmed=value.trim();try{new Intl.DateTimeFormat('en-US',{timeZone:trimmed}).format(new Date());return trimmed;}catch{throw new Error('INVALID_TIMEZONE: Enter a valid IANA timezone.');}}`;
const entry=`import {formatDueDate} from './src/lib/dates/format';
import {classifyDueDate} from './src/lib/dates/classify-due-date';
import {validateTimeZone} from './src/lib/dates/validate-timezone';
let constructors=0;Intl.DateTimeFormat=new Proxy(Intl.DateTimeFormat,{construct(target,args){constructors++;return Reflect.construct(target,args);},apply(target,receiver,args){constructors++;return Reflect.apply(target,receiver,args);}});
export default{async fetch(request){const mode=new URL(request.url).pathname;constructors=0;const values=[];
const now=new Date('2026-10-15T12:00:00Z');
if(mode==='/correctness'||mode==='/holdout'){
 const zones=mode==='/holdout'?[...Intl.supportedValuesOf('timeZone').slice(0,160),'UTC','Pacific-ish','UTC']:[' America/Los_Angeles ','UTC','Europe/London','Asia/Kathmandu','america/new_york','Pacific-ish',''];
 for(const zone of zones)for(const date of ['2026-03-08T09:30:00Z','2026-11-01T09:30:00Z',null]){
  try{values.push([validateTimeZone(zone),formatDueDate(date,zone),classifyDueDate(date,now,zone)]);}catch(error){values.push({error:error.message});}
 }
}else for(let i=0;i<500;i++){
 const zone=i%2?'America/Los_Angeles':'Europe/London',due=i%3?'2026-10-16T09:30:00Z':'2026-10-14T09:30:00Z';
 values.push([formatDueDate(due,zone),classifyDueDate(due,now,zone)]);
}
return Response.json({values,constructors});}};`;

const workers=[];
for(const name of ['baseline','cached']){
  const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent',
    plugins:name==='baseline'?[{name:'frozen-validation-baseline',setup(api){api.onLoad({filter:/validate-timezone\.ts$/},()=>({contents:baseline,loader:'ts'}));}}]:[]});
  workers.push({name,script:new TextDecoder().decode(result.outputFiles[0].contents),modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat']});
}
const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers});
options.telemetry={enabled:false};
const mf=new Miniflare(options),runs=[];
try{
  await mf.ready;
  const handles=Object.fromEntries(await Promise.all(workers.map(async worker=>[worker.name,await mf.getWorker(worker.name)])));
  async function run(name,path){
    const start=performance.now(),response=await handles[name].fetch('http://localhost'+path);
    if(!response.ok)throw new Error('Benchmark request failed');
    const data=await response.json();return {...data,name,wallMs:performance.now()-start};
  }
  for(const path of ['/correctness','/holdout']){
    const old=await run('baseline',path),current=await run('cached',path);
    if(JSON.stringify(old.values)!==JSON.stringify(current.values))throw new Error('Correctness gate failed');
  }
  await run('baseline','/measure');await run('cached','/measure');
  for(let pair=0;pair<4;pair++){
    const results={};
    for(const name of pair%2?['cached','baseline']:['baseline','cached']){
      const result=await run(name,'/measure');results[name]=result;
      runs.push({pair,name,wallMs:result.wallMs,constructors:result.constructors});
    }
    if(JSON.stringify(results.baseline.values)!==JSON.stringify(results.cached.values))throw new Error('Replay gate failed');
  }
  const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[1]+sorted[2])/2;};
  const baselineMs=median(runs.filter(run=>run.name==='baseline').map(run=>run.wallMs));
  const cachedMs=median(runs.filter(run=>run.name==='cached').map(run=>run.wallMs));
  const result={scope:'Native local workerd; wall time for 500 format/classify pairs, not production CPU',
    budget:{variants:2,pairs:4,maxSpend:0,data:'synthetic'},correctness:true,baselineMedianMs:baselineMs,cachedMedianMs:cachedMs,speedup:baselineMs/cachedMs,runs};
  const output=join(root,'artifacts','benchmarks');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(join(output,`timezone-validation-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await mf.dispose();}
