import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const origin='https://mykairos.me';
const failed=(code,status=0)=>({ok:false,code,status});
async function healthyBody(response){
  const reader=response.body?.getReader();if(!reader)return false;
  let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>256){void reader.cancel().catch(()=>{});return false;}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();const body=JSON.parse(text);
    return Boolean(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&Object.hasOwn(body,'status')&&body.status==='ok');
  }finally{reader.releaseLock();}
}
export async function checkProductionHealth(options={}){
  if((options.origin??origin)!==origin)return failed('HEALTH_ORIGIN_INVALID');
  const timeout=options.timeoutMs??10000;
  if(!Number.isInteger(timeout)||timeout<1||timeout>10000)return failed('HEALTH_OPTIONS_INVALID');
  const controller=new AbortController();let timer;
  const deadline=new Promise(done=>{timer=setTimeout(()=>{controller.abort();done(failed('HEALTH_TIMEOUT'));},timeout);});
  const run=(async()=>{
    try{
      const response=await (options.fetchImpl??fetch)(origin+'/api/health',{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
      if(response.status!==200||response.redirected)return failed('HEALTH_CHECK_FAILED',response.status);
      if(!await healthyBody(response))return failed('HEALTH_PAYLOAD_INVALID',response.status);
      return {ok:true,code:'HEALTH_OK',status:200};
    }catch{return failed(controller.signal.aborted?'HEALTH_TIMEOUT':'HEALTH_NETWORK_FAILED');}
  })();
  try{return await Promise.race([run,deadline]);}finally{clearTimeout(timer);}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const result=process.argv.length>3?failed('HEALTH_OPTIONS_INVALID'):await checkProductionHealth({origin:process.argv[2]??origin});
  console.log(JSON.stringify({code:result.code,status:result.status}));
  process.exitCode=result.ok?0:1;
}
