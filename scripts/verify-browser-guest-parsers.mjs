// Standalone portability proof. No app server, credentials, provider or cloud API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,version as esbuildVersion} from 'esbuild';
import {chromium,firefox} from '@playwright/test';
import {cases,bytesForCase,requestId,checkedAt} from '../tests/helpers/guest-parser-cases.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'artifacts/guest-parser-parity',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const golden=JSON.parse(await readFile(join(root,'tests/helpers/guest-parser-golden.json'),'utf8'));
const helperSource=(await readFile(join(root,'tests/helpers/guest-parser-cases.mjs'),'utf8')).replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
assert.equal(hash(helperSource),golden._reference.casesHelperCanonicalSha256,'Golden fixture generator drift');
for(const item of cases){const bytes=bytesForCase(item);assert.deepEqual({bytes:bytes.byteLength,sha256:hash(bytes)},golden._reference.caseInputs[item.name],'Frozen input drift: '+item.name);}
const receipt={status:'incomplete',kind:'browser-parser-portability',node:process.version,esbuild:esbuildVersion,baseline:golden._reference,goldenSha256:hash(await readFile(join(root,'tests/helpers/guest-parser-golden.json'))),harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),results:[],unexpectedPageRequests:0,disposed:false,
  scope:'Actual portable parser in headless Chromium/Firefox under strict CSP and three timezone contexts; standalone synthetic HTTP fixtures only. Not application worker lifecycle, deployed CPU, isolate memory or capacity.'};
let server,activeBrowser;
try{
 const bundled=await build({stdin:{contents:"export {parseGuestSourceBytes} from './src/lib/guest/sources/parse';",resolveDir:root,loader:'ts',sourcefile:'guest-browser-parser.ts'},tsconfig:join(root,'tsconfig.json'),bundle:true,write:false,format:'esm',platform:'browser',metafile:true,logLevel:'silent',plugins:[{name:'reject-server-boundary',setup(api){api.onResolve({filter:/^server-only$|^node:/},args=>{throw new Error('Non-browser parser dependency: '+args.path);});}}]});
 const parser=bundled.outputFiles[0].contents;receipt.bundleSha256=hash(parser);receipt.inputs={};
 for(const name of Object.keys(bundled.metafile.inputs).filter(x=>x.startsWith('src/')))receipt.inputs[name]=hash(await readFile(join(root,name)));
 const meta=cases.map(c=>({name:c.name,operation:c.operation,...(c.operation==='ed-lessons'?{courseId:c.courseId}:{}),digestOnly:!!c.digestOnly}));
 const harness=`import {parseGuestSourceBytes} from '/parser.js';
 const cases=${JSON.stringify(meta)},requestId=${JSON.stringify(requestId)},checkedAt=${JSON.stringify(checkedAt)};
 globalThis.runParserCase=async index=>{const c=cases[index];const response=await fetch('/fixture/'+index);const bytes=await response.arrayBuffer();
 try{const result=await parseGuestSourceBytes({operation:c.operation,requestId,checkedAt,bytes,...(c.operation==='ed-lessons'?{courseId:c.courseId}:{})});
 if(!c.digestOnly)return result;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result)));return {sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),count:(result.assignments??result.courses??result.lessons).length};
 }catch(e){return {error:e.code??'UNCLASSIFIED'};}};`;
 server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'");
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><script type="module" src="/harness.js"></script>');return;}
  if(req.url==='/parser.js'||req.url==='/harness.js'){res.setHeader('content-type','application/javascript');res.end(req.url==='/parser.js'?parser:harness);return;}
  const m=req.url?.match(/^\/fixture\/(\d+)$/);if(m&&Number(m[1])<cases.length){res.setHeader('content-type','application/octet-stream');res.end(bytesForCase(cases[Number(m[1])]));return;}
  res.statusCode=404;res.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 for(const [name,type]of [['chromium',chromium],['firefox',firefox]]){
  activeBrowser=await type.launch({headless:true});
  for(const timezoneId of ['UTC','America/Los_Angeles','Asia/Kolkata']){
   const context=await activeBrowser.newContext({timezoneId});
   try{
    const page=await context.newPage();page.on('request',r=>{if(new URL(r.url()).origin!==origin)receipt.unexpectedPageRequests++;});
    await page.goto(origin);await page.waitForFunction(()=>typeof globalThis.runParserCase==='function');
    for(let index=0;index<cases.length;index++){
     const actual=await page.evaluate(i=>globalThis.runParserCase(i),index);
     try{assert.deepEqual(actual,golden[cases[index].name]);}catch{receipt.failure={browser:name,timezoneId,case:cases[index].name,reason:'golden_mismatch',actualSha256:hash(JSON.stringify(actual)),expectedSha256:hash(JSON.stringify(golden[cases[index].name]))};throw new Error('BROWSER_PARSER_PARITY_MISMATCH');}
     receipt.results.push({browser:name,version:activeBrowser.version(),timezoneId,case:cases[index].name,passed:true});
    }
   }finally{await context.close();}
  }
  await activeBrowser.close();activeBrowser=null;
 }
 assert.equal(receipt.unexpectedPageRequests,0);receipt.status='passed';
}catch(e){receipt.failure??={reason:e?.message??'BROWSER_PARSER_CHECK_FAILED'};process.exitCode=1;}
finally{
 await activeBrowser?.close();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 receipt.disposed=true;await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,passedCases:receipt.results.length,unexpectedPageRequests:receipt.unexpectedPageRequests,disposed:receipt.disposed,failure:receipt.failure,receipt:join(out,'receipt.json')}));
}
