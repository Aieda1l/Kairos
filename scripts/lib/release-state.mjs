const denied=()=>new Error('Release state rejected.');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const approvedMigrations=Object.freeze([
 '0001_auth.sql','0002_kairos_tenant_schema.sql','0003_identity_token_minimization.sql',
 '0004_onboarding_state.sql','0005_abuse_controls.sql','0006_bridge_ownership.sql','0007_provider_admission.sql',
]);
const requiredSecrets=['AUTH_SECRET','AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET',
 'AUTH_MICROSOFT_ENTRA_ID_ID','AUTH_MICROSOFT_ENTRA_ID_SECRET','GOOGLE_CALENDAR_CLIENT_ID',
 'GOOGLE_CALENDAR_CLIENT_SECRET','MICROSOFT_CALENDAR_CLIENT_ID','MICROSOFT_CALENDAR_CLIENT_SECRET',
 'MICROSOFT_CALENDAR_TENANT','KAIROS_CREDENTIAL_KEY_V1','KAIROS_TURNSTILE_SITE_KEY',
 'KAIROS_TURNSTILE_SECRET_KEY','KAIROS_ABUSE_KEY_V1'];

export function assertVersionConfiguration(version,{versionId,sha,databaseId}){
 const runtime=version?.resources?.script_runtime,bindings=version?.resources?.bindings;
 if(version?.id!==versionId||runtime?.compatibility_date!=='2026-10-06'
  ||JSON.stringify(runtime.compatibility_flags)!==JSON.stringify(['nodejs_compat'])||!Array.isArray(bindings))throw denied();
 const values=new Map(bindings.map(b=>[b.name,b]));
 if(values.size!==bindings.length||requiredSecrets.some(name=>values.get(name)?.type!=='secret_text'))throw denied();
 for(const [name,text] of Object.entries({AUTH_URL:'https://mykairos.me',KAIROS_APP_URL:'https://mykairos.me',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_RELEASE_ID:sha})){
  const binding=values.get(name);if(binding?.type!=='plain_text'||binding.text!==text)throw denied();
 }
 const db=values.get('DB');if(db?.type!=='d1'||db.id!==databaseId)throw denied();
 const fixtures=values.get('E2E_FIXTURES'),local=values.get('KAIROS_LOCAL_AUTH');
 if(fixtures&&!(fixtures.type==='plain_text'&&['','0'].includes(fixtures.text)))throw denied();
 if(local&&!(local.type==='plain_text'&&local.text===''))throw denied();
 const key=values.get('KAIROS_CREDENTIAL_ACTIVE_KEY_ID');
 if(key&&(key.type!=='plain_text'||!['v1','v2'].includes(key.text)))throw denied();
 if(key?.text==='v2'&&values.get('KAIROS_CREDENTIAL_KEY_V2')?.type!=='secret_text')throw denied();
}

async function requestJson(url,token,body,fetchImpl){
 const controller=new AbortController();let timer,reader;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(denied());},10000);});
 try{return await Promise.race([deadline,(async()=>{
  const response=await fetchImpl(url,{method:body?'POST':'GET',redirect:'error',signal:controller.signal,
   headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok||response.redirected||!response.body)throw denied();
  reader=response.body.getReader();let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1048576)throw denied();text+=decoder.decode(chunk.value,{stream:true});}
  text+=decoder.decode();const value=JSON.parse(text);if(value?.success!==true)throw denied();return value.result;
 })()]);}finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
}

export async function verifyReleaseState({phase,env,fetchImpl=fetch}){
 const {CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_D1_DATABASE_ID:database,CLOUDFLARE_API_TOKEN:token,
  KAIROS_EXPECTED_ACTIVE_VERSION:active,KAIROS_VERSION_ID:versionId,GITHUB_SHA:sha,GITHUB_REF:ref}=env;
 if(!['baseline','staged','migrated'].includes(phase)||ref!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(sha??'')
  ||!/^[a-f0-9]{32}$/.test(account??'')||!uuid.test(database??'')||!uuid.test(active??'')||!token||/[\r\n]/.test(token)
  ||(phase!=='baseline'&&!uuid.test(versionId??'')))throw denied();
 const root=`https://api.cloudflare.com/client/v4/accounts/${account}`;
 const worker=root+'/workers/scripts/kairos-production';
 const api=(url,body)=>requestJson(url,token,body,fetchImpl);
 const [deployments,migrations,settings,version,subdomain]=await Promise.all([
  api(worker+'/deployments'),api(`${root}/d1/database/${database}/query`,{sql:'SELECT name FROM d1_migrations ORDER BY id',params:[]}),
  api(worker+'/script-settings'),phase==='baseline'?null:api(worker+'/versions/'+versionId),
  phase==='baseline'?api(root+'/workers/subdomain'):null,
 ]);
 const versions=deployments?.deployments?.[0]?.versions;
 if(!Array.isArray(versions)||versions.length!==1||versions[0].version_id!==active||versions[0].percentage!==100)throw denied();
 const observability=settings?.observability;
 if(!settings||settings.logpush!==false||(settings.tail_consumers?.length??0)!==0
  ||observability?.enabled===true||observability?.logs?.enabled===true||observability?.logs?.invocation_logs===true
  ||observability?.logs?.persist===true||observability?.traces?.enabled===true||observability?.traces?.persist===true)throw denied();
 if(!Array.isArray(migrations)||migrations.length!==1||migrations[0]?.success!==true||!Array.isArray(migrations[0].results)
  ||migrations[0].meta?.rows_written!==0)throw denied();
 const expected=phase==='migrated'?approvedMigrations:approvedMigrations.slice(0,3);
 if(JSON.stringify(migrations[0].results.map(row=>row.name))!==JSON.stringify(expected))throw denied();
 if(phase!=='baseline')assertVersionConfiguration(version,{versionId,sha,databaseId:database});
 if(phase==='baseline'&&!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain?.subdomain??''))throw denied();
 return {workersSubdomain:subdomain?.subdomain};
}
