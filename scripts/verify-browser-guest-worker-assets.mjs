// Execute emitted production workers; no app server, credentials or provider access.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {chromium,firefox} from '@playwright/test';
import {cases,bytesForCase,requestId,checkedAt} from '../tests/helpers/guest-parser-cases.mjs';

const source=resolve(process.argv[2]??'.');
const out=resolve('artifacts/guest-worker-assets',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const golden=JSON.parse(await readFile(new URL('../tests/helpers/guest-parser-golden.json',import.meta.url),'utf8'));
const receipt={status:'incomplete',kind:'production-worker-assets',source,results:[],assets:[],unexpectedRequests:0,disposed:false,scope:'Emitted Vite and Next worker entrypoints with actual compiled dependencies in Chromium/Firefox under self-only CSP. Synthetic fixed golden cases; not full production page navigation or hosted CPU/capacity.'};
let server,browser;
try{
 const viteRoot=join(source,'dist/client'),nextRoot=join(source,'.next/static');
 const viteFiles=await readdir(viteRoot,{recursive:true}),nextFiles=await readdir(nextRoot,{recursive:true});
 const viteWorkers=viteFiles.filter(f=>/^_next[\\/]static[\\/]workers[\\/]source-parser\.worker-[^/\\]+\.js$/.test(f));
 assert.equal(viteWorkers.length,1,'one Vite parser worker');
 const vitePath='/'+viteWorkers[0].replaceAll('\\','/');
 let viteReferenced=false,nextConfig;
 for(const f of viteFiles.filter(f=>f.endsWith('.js')&&f.includes('transient-client'))){const body=await readFile(join(viteRoot,f),'utf8');if(body.includes(vitePath))viteReferenced=true;}
 assert(viteReferenced,'Vite client references emitted worker');
 for(const f of nextFiles.filter(f=>f.endsWith('.js'))){
  const body=await readFile(join(nextRoot,f),'utf8');
  const matches=[...body.matchAll(/\.f\("(static\/chunks\/turbopack-worker-[^"]+\.js)",(\["static\/chunks\/[^\]]+\])\)/g)];
  for(const match of matches){const chunks=JSON.parse(match[2]);assert(!nextConfig,'one Next parser worker');nextConfig={path:'/_next/'+match[1],chunks:chunks.map(c=>'/_next/'+c),reference:f};}
 }
 assert(nextConfig,'Next client references emitted worker bootstrap');
 // Turbopack's emitted factory reverses chunk URLs and uses the hash for a Worker.
 const variants=[{name:'vite',path:vitePath,type:'module'}, {name:'next',path:nextConfig.path+'#params='+encodeURIComponent(JSON.stringify([[...nextConfig.chunks].reverse(),'','/_next/','','']))}];
 const served=new Map();
 const asset=(path)=>path.startsWith('/_next/')?(path===vitePath?join(viteRoot,path.slice(1)):join(nextRoot,path.slice('/_next/static/'.length))):null;
 const harness=`const variants=${JSON.stringify(variants)},cases=${JSON.stringify(cases.map(c=>({name:c.name,operation:c.operation,courseId:c.courseId,digestOnly:!!c.digestOnly})))},requestId=${JSON.stringify(requestId)},checkedAt=${JSON.stringify(checkedAt)};
 globalThis.runWorkerCase=async (variant,index)=>{const c=cases[index],v=variants[variant],bytes=await (await fetch('/fixture/'+index)).arrayBuffer();
 const result=await new Promise((resolve,reject)=>{const w=new Worker(v.path,v.type?{type:v.type}:undefined),id=crypto.randomUUID();
 const timer=setTimeout(()=>{w.terminate();reject(Error('WORKER_TIMEOUT'));},15000);
 const done=f=>{clearTimeout(timer);w.terminate();f();};
 w.onerror=()=>done(()=>reject(Error('WORKER_ERROR')));w.onmessageerror=()=>done(()=>reject(Error('WORKER_MESSAGE_ERROR')));
 w.onmessage=e=>done(()=>e.data.id===id?resolve(e.data.ok?e.data.result:{error:e.data.code}):reject(Error('WORKER_CORRELATION')));
 w.postMessage({id,input:{operation:c.operation,requestId,checkedAt,bytes,...(c.operation==='ed-lessons'?{courseId:c.courseId}:{})}},[bytes]);});
 if(!c.digestOnly||result.error)return result;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result)));
 return {sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),count:(result.assignments??result.courses??result.lessons).length};};`;
 server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'");
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><script type="module" src="/harness.js"></script>');return;}
   if(url.pathname==='/harness.js'){res.setHeader('content-type','application/javascript');res.end(harness);return;}
   const fixture=url.pathname.match(/^\/fixture\/(\d+)$/);if(fixture&&cases[Number(fixture[1])]){res.setHeader('content-type','application/octet-stream');res.end(bytesForCase(cases[Number(fixture[1])]));return;}
   const file=asset(url.pathname);assert(file&&url.pathname.startsWith('/_next/static/'));
   const rel=relative(source,file);assert(rel&&!rel.startsWith('..'+sep)&&rel!=='..');
   const body=await readFile(file);served.set(url.pathname,{path:url.pathname,sha256:hash(body),bytes:body.length});
   res.setHeader('content-type','application/javascript');res.end(body);
  }catch{console.log(JSON.stringify({unservedPath:new URL(req.url,'http://127.0.0.1').pathname}));res.statusCode=404;res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 for(const [name,type] of [['chromium',chromium],['firefox',firefox]]){
  browser=await type.launch({headless:true});const context=await browser.newContext({timezoneId:'UTC'});
  try{
   const page=await context.newPage();page.on('request',r=>{if(new URL(r.url()).origin!==origin)receipt.unexpectedRequests++;});
   await page.goto(origin);await page.waitForFunction(()=>typeof globalThis.runWorkerCase==='function');
   for(let variant=0;variant<variants.length;variant++)for(let index=0;index<cases.length;index++){
    const actual=await page.evaluate(([v,i])=>globalThis.runWorkerCase(v,i),[variant,index]);
    assert.deepEqual(actual,golden[cases[index].name],name+'/'+variants[variant].name+'/'+cases[index].name);
    receipt.results.push({browser:name,version:browser.version(),build:variants[variant].name,case:cases[index].name,passed:true});
   }
  }finally{await context.close();await browser.close();browser=null;}
 }
 receipt.assets=[...served.values()];assert.equal(receipt.unexpectedRequests,0);receipt.status='passed';
}catch(e){receipt.failure={reason:e?.message??'WORKER_ASSET_CHECK_FAILED'};process.exitCode=1;}
finally{
 await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 receipt.disposed=true;await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,passedCases:receipt.results.length,unexpectedRequests:receipt.unexpectedRequests,disposed:receipt.disposed,failure:receipt.failure,receipt:join(out,'receipt.json')}));
}
