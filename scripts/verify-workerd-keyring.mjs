// Synthetic local workerd probe; no production credential bindings or provider calls.
import {build} from 'esbuild';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));let child;
try{
  const base=join(root,'artifacts','maintenance');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'keyring-probe-'));
  const entry=`
import {credentialKeyringFromBindings} from './src/lib/security/keyring-environment';
import {encryptCredential,decryptCredential} from './src/lib/security/credential-cipher';
const encode=n=>btoa(String.fromCharCode(...new Uint8Array(32).fill(n))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
export default {async fetch(){try{
 const input={plaintext:'synthetic-only',userId:'synthetic-actor',purpose:'ed_api_token',contextId:'synthetic-context'};
 const bindings={KAIROS_CREDENTIAL_KEY_V1:encode(1),KAIROS_CREDENTIAL_KEY_V2:encode(2)};
 const old=credentialKeyringFromBindings(bindings),next=credentialKeyringFromBindings({...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'});
 const before=await encryptCredential(input,old),after=await encryptCredential(input,next);
 if(!before.startsWith('v1.v1.')||!after.startsWith('v1.v2.')||await decryptCredential({...input,envelope:before},next)!==input.plaintext||await decryptCredential({...input,envelope:after},old)!==input.plaintext)throw new Error();
 let rejected=0;for(const config of [{KAIROS_CREDENTIAL_KEY_V1:encode(1),KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'},{...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'invalid'}]){try{credentialKeyringFromBindings(config);}catch{rejected++;}}
 if(rejected!==2)throw new Error();return Response.json({code:'KEYRING_PROBE_PASSED',checks:6});
 }catch{return Response.json({code:'KEYRING_PROBE_FAILED'},{status:500});}}};`;
  await build({stdin:{contents:entry,resolveDir:root,sourcefile:'keyring-probe.ts',loader:'ts'},outfile:join(directory,'worker.mjs'),bundle:true,format:'esm',platform:'browser',logLevel:'silent',
    plugins:[{name:'server-only-marker',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
  await writeFile(join(directory,'wrangler.json'),JSON.stringify({name:'kairos-keyring-local-probe',main:'./worker.mjs',compatibility_date:'2026-10-06'}));
  const server=createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',join(directory,'wrangler.json'),'--port',String(port),'--ip','127.0.0.1','--persist-to',join(directory,'state')],
    {cwd:directory,env:{...process.env,CLOUDFLARE_API_TOKEN:'',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();child.on('error',()=>{});
  let passed=false;
  for(let i=0;i<120;i++){
    if(child.exitCode!==null)break;
    try{const response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(500)});if(response.ok){const value=await response.json();if(value.code==='KEYRING_PROBE_PASSED'&&value.checks===6){passed=true;break;}throw new Error();}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!passed)throw new Error();console.log(JSON.stringify({code:'KEYRING_PROBE_PASSED',checks:6}));
}catch{console.error(JSON.stringify({code:'KEYRING_PROBE_FAILED'}));process.exitCode=1;}
finally{
  if(child&&child.exitCode===null&&child.pid){
    if(process.platform==='win32')await new Promise(resolve=>spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('close',resolve));
    else child.kill('SIGTERM');
  }
}
