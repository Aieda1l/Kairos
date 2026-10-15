const rejected=()=>new Error('Release gate rejected.');
const revision=/^[a-f0-9]{40}$/;
const versionId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function assertReleaseGate({ref,sha,repository,runs}){
 if(ref!=='refs/heads/main'||!revision.test(sha??'')||!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!Array.isArray(runs)||runs.length===0||runs.length>100)throw rejected();
 const latest=[...runs].sort((a,b)=>b.id-a.id||b.run_attempt-a.run_attempt)[0];
 if(!Number.isSafeInteger(latest?.id)||latest.id<1||latest.head_sha!==sha||latest.head_branch!=='main'||latest.status!=='completed'||latest.conclusion!=='success'
   ||!['push','workflow_dispatch'].includes(latest.event)||latest.path!=='.github/workflows/milestone-2-ci.yml'||latest.head_repository?.full_name!==repository)throw rejected();
}
function stagedUrl(value,prefix){
 const url=new URL(value);
 const expected=prefix??'[a-f0-9]{8}';
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'
  ||!new RegExp('^'+expected+'-kairos-production\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.workers\\.dev$').test(url.hostname))throw rejected();
 return url.origin;
}
export function parseUploadedVersion(rows,alias,workersSubdomain){
 try{
  if(!/^m7-[a-f0-9]{12}$/.test(alias??'')||!Array.isArray(rows)||rows.length>100
   ||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workersSubdomain??''))throw rejected();
  const uploads=rows.filter(r=>r?.type==='version-upload');
  if(uploads.length!==1||uploads[0].worker_name!=='kairos-production'||!versionId.test(uploads[0].version_id??''))throw rejected();
  const aliasUrl=stagedUrl(uploads[0].preview_alias_url,alias);
  const prefix=uploads[0].version_id.slice(0,8),url=stagedUrl(uploads[0].preview_url,prefix);
  if(new URL(aliasUrl).hostname!==`${alias}-kairos-production.${workersSubdomain}.workers.dev`
   ||new URL(url).hostname!==`${prefix}-kairos-production.${workersSubdomain}.workers.dev`)throw rejected();
  return {versionId:uploads[0].version_id,url};
 }catch{throw rejected();}
}
async function verifyStagedResponse(value,pathname,status,key,expected,fetchImpl){
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Staged health failed.'));},10000);});
 try{
  const origin=stagedUrl(value);
  await Promise.race([timeout,(async()=>{
   const response=await fetchImpl(origin+pathname,{redirect:'error',cache:'no-store',signal:controller.signal});
   if(response.status!==status||!response.body)throw new Error();
   const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
   try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>256)throw new Error();text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{void reader.cancel().catch(()=>{});}
   const body=JSON.parse(text);if(!body||body[key]!==expected||Object.keys(body).length!==1)throw new Error();
  })()]);
 }catch{controller.abort();throw new Error('Staged health failed.');}
 finally{clearTimeout(timer);}
}
export async function verifyStagedHealth(value,fetchImpl=fetch){
 await verifyStagedResponse(value,'/api/health',200,'status','ok',fetchImpl);
}
export async function verifyStagedIsolation(value,fetchImpl=fetch){
 for(const pathname of ['/onboarding','/api/auth/providers']){
  await verifyStagedResponse(value,pathname,404,'code','PREVIEW_HEALTH_ONLY',fetchImpl);
 }
}
