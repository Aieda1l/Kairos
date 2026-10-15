// Real workerd fetch, routed only to a local fixture service; no external requests.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const entry=`
import {verifyTurnstile} from './src/lib/auth/turnstile';
export default {async fetch(){
 const results=[];
 for(const action of ['auth_google','auth_microsoft']){
  for(const mode of ['valid','rejected','wrong-host','wrong-action','unavailable','redirect']){
   let code='VERIFIED';
   try{await verifyTurnstile({token:mode+':'+action,expectedAction:action,expectedHostname:'mykairos.me'},
    {secret:'synthetic-secret',fetchImpl:fetch});}
   catch(error){code=error.code??'UNEXPECTED_ERROR';}
   const expected=mode==='valid'?'VERIFIED':['unavailable','redirect'].includes(mode)?'AUTH_CHALLENGE_UNAVAILABLE':'AUTH_CHALLENGE_FAILED';
   results.push({action,mode,code,ok:code===expected});
  }
 }
 return Response.json(results);
}};`;
const fixture=`export default {async fetch(request){
 if(request.url!=='https://challenges.cloudflare.com/turnstile/v0/siteverify'||request.method!=='POST')return new Response(null,{status:400});
 const data=await request.formData();
 if(data.get('secret')!=='synthetic-secret'||data.has('remoteip'))return new Response(null,{status:400});
 const [mode,action]=String(data.get('response')).split(':');
 if(mode==='unavailable')return new Response(null,{status:503});
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://rejected.invalid/'}});
 return Response.json({success:mode!=='rejected',hostname:mode==='wrong-host'?'other.invalid':'mykairos.me',action:mode==='wrong-action'?'other':action});
}};`;
let mf;
try{
 const built=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'turnstile-native-probe.ts',loader:'ts'},
  bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent',
  plugins:[{name:'empty-server-only',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
 const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers:[
  {name:'probe',script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],outboundService:'siteverify-fixture'},
  {name:'siteverify-fixture',script:fixture,modules:true,compatibilityDate:'2026-10-06'},
 ]});options.telemetry={enabled:false};mf=new Miniflare(options);await mf.ready;
 const response=await (await mf.getWorker('probe')).fetch('http://localhost/');
 if(!response.ok)throw new Error('NATIVE_TURNSTILE_FAILED');
 const results=await response.json();
 console.log(JSON.stringify({code:results.every(r=>r.ok)?'NATIVE_TURNSTILE_PASSED':'NATIVE_TURNSTILE_FAILED',externalRequests:0,results}));
 if(results.length!==12||results.some(r=>!r.ok))process.exitCode=1;
}catch{console.error('NATIVE_TURNSTILE_FAILED');process.exitCode=1;}
finally{if(mf)await mf.dispose();}
