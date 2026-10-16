// Trusted local compiled-release probe: synthetic keys/D1/OIDC; sealed networking.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
const bundled=await build({entryPoints:['dist/server/index.js'],bundle:true,write:false,format:'esm',platform:'browser',external:['node:*','cloudflare:*'],logLevel:'silent'});
let script=bundled.outputFiles[0].text;
const exportAt=script.lastIndexOf('\nexport {');
const defaultName=script.slice(exportAt).match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\s*[,}]/)?.[1];
if(exportAt<0||!defaultName)throw new Error('COMPILED_PROVIDER_EXPORT_INVALID');
// Instrument only the isolated probe. The production artifact is unchanged.
const counter=`const probeFetch=${defaultName}.fetch;${defaultName}.fetch=async(request,env,ctx)=>{
 const db=env.DB,prepare=db.prepare,batch=db.batch;let count=0;
 const tick=(n=1)=>{count+=n;if(count>50)throw new Error('Synthetic D1 statement budget exceeded');};
 const wrap=statement=>{const bind=statement.bind.bind(statement);statement.bind=(...args)=>wrap(bind(...args));
  for(const method of ['first','all','run']){const call=statement[method].bind(statement);statement[method]=(...args)=>{tick();return call(...args);};}return statement;};
 db.prepare=sql=>wrap(prepare.call(db,sql));db.batch=statements=>{tick(statements.length);return batch.call(db,statements);};
 try{const response=await probeFetch.call(${defaultName},request,env,ctx);const headers=new Headers(response.headers);headers.set('x-probe-d1-statements',String(count));return new Response(response.body,{status:response.status,headers});}
 finally{db.prepare=prepare;db.batch=batch;}
};`;
script=script.slice(0,exportAt)+'\n'+counter+script.slice(exportAt);
const fixture=`let calendarWrites=0;export default {async fetch(request){
 const url=new URL(request.url);
 if(url.pathname==='/__probe/summary')return Response.json({calendarWrites});
 if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer'});
 if(url.href==='https://www.googleapis.com/calendar/v3/users/me/calendarList/synthetic-existing-calendar'&&request.method==='GET')return Response.json({id:'synthetic-existing-calendar',accessRole:'owner'});
 if(url.hostname==='www.googleapis.com'&&request.method!=='GET')calendarWrites++;
 if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
  const form=await request.formData(),response=String(form.get('response'));
  return Response.json({success:response.startsWith('valid-'),hostname:'mykairos.me',action:'auth_sign_in'});
 }
 if(url.pathname.endsWith('/.well-known/openid-configuration')){
  const google=url.hostname==='accounts.google.com',issuer=google?'https://accounts.google.com':'https://login.microsoftonline.com/common/v2.0';
  return Response.json({issuer,authorization_endpoint:google?'https://accounts.google.com/o/oauth2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',code_challenge_methods_supported:['S256']});
 }
 return new Response(null,{status:502});
}};`;
const bindings={KAIROS_APP_URL:'https://mykairos.me',AUTH_URL:'https://mykairos.me',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',
 AUTH_SECRET:'synthetic-local-auth-secret-only',AUTH_GOOGLE_ID:'synthetic-id',AUTH_GOOGLE_SECRET:'synthetic-secret',
 AUTH_MICROSOFT_ENTRA_ID_ID:'synthetic-id',AUTH_MICROSOFT_ENTRA_ID_SECRET:'synthetic-secret',
 KAIROS_TURNSTILE_SITE_KEY:'local-probe-site',KAIROS_TURNSTILE_SECRET_KEY:'local-probe-secret',
 KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),KAIROS_CREDENTIAL_KEY_V1:Buffer.from(new Uint8Array(32).fill(9)).toString('base64url')};
bindings.GOOGLE_CALENDAR_CLIENT_ID='synthetic-client';bindings.GOOGLE_CALENDAR_CLIENT_SECRET='synthetic-client-secret';const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers:[
 // Miniflare's HTTP proxy rewrites Host to its loopback listener. The local
 // ingress fixture restores the canonical host before the unchanged app runs.
 {name:'ingress',script:`export default {fetch(request,env){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);return env.APP.fetch(new Request(request,{headers}));}};`,modules:true,compatibilityDate:'2026-10-06',serviceBindings:{APP:'app'}},
 {name:'app',script,modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],bindings,
  d1Databases:{DB:'synthetic-repair-auth'},outboundService:'fixture',serviceBindings:{ASSETS:()=>new Response(null,{status:404})}},
 {name:'fixture',script:fixture,modules:true,compatibilityDate:'2026-10-06'},
]});options.telemetry={enabled:false};
const mf=new Miniflare(options),results=[];
try{
 await mf.ready;const db=await mf.getD1Database('DB','app');
 for(const name of fs.readdirSync('migrations').filter(n=>/\.sql$/.test(n)).sort()){
  for(const sql of fs.readFileSync('migrations/'+name,'utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
 const worker={fetch:mf.dispatchFetch.bind(mf)},origin='https://mykairos.me';
 for(const provider of ['google','microsoft-entra-id']){
  const csrf=await worker.fetch(origin+'/api/auth/csrf');
  const token=(await csrf.json()).csrfToken,cookie=csrf.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  for(const mode of ['invalid','valid']){
   const response=await worker.fetch(origin+'/api/auth/signin/'+provider,{method:'POST',redirect:'manual',headers:{origin,cookie,'cf-connecting-ip':provider==='google'?'203.0.113.8':'203.0.113.9','content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrfToken:token,'cf-turnstile-response':mode+'-'+(provider==='google'?'google':'microsoft')})});
   const code=response.status===302?'IDENTITY_REDIRECT':(await response.json().catch(()=>null))?.code??'UNEXPECTED_RESPONSE';
   const location=response.headers.get('location');
   const ok=mode==='valid'?response.status===302&&!!location&&new URL(location).hostname===(provider==='google'?'accounts.google.com':'login.microsoftonline.com'):response.status===400&&code==='AUTH_CHALLENGE_FAILED';
   results.push({provider,mode,status:response.status,code,ok});
  }
 }

 await db.prepare("INSERT INTO users(id,name,email) VALUES ('synthetic-returning-user','Synthetic','returning@example.invalid')").run();
 await db.prepare('INSERT INTO sessions(id,sessionToken,userId,expires) VALUES (?,?,?,?)').bind('synthetic-session-id','synthetic-live-session','synthetic-returning-user',new Date(Date.now()+3600000).toISOString()).run();
 const returning=await worker.fetch(origin+'/sign-in?returnTo=/sources',{redirect:'manual',headers:{cookie:'__Secure-authjs.session-token=synthetic-live-session'}});
 results.push({mode:'returning-session',status:returning.status,ok:[302,303,307,308].includes(returning.status)&&new URL(returning.headers.get('location')??'/',origin).pathname==='/sources'});

 const user='synthetic-returning-user',at=new Date().toISOString();
 await db.prepare("INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES (?,?,'gradescope','Synthetic',?,?)").bind(user,'synthetic-gs',at,at).run();
 for(const id of ['123','456','789'])await db.prepare("INSERT INTO source_courses(user_id,id,source_connection_id,external_course_id,full_name,enabled,first_seen_at,last_seen_at,updated_at) VALUES (?,?,?,?,'Synthetic course',1,?,?,?)").bind(user,'course-'+id,'synthetic-gs',id,at,at,at).run();
 const headers={origin,'content-type':'application/json',cookie:'__Secure-authjs.session-token=synthetic-live-session'};
 const startedResponse=await worker.fetch(origin+'/api/sources/gradescope/sync/start',{method:'POST',redirect:'manual',headers});
 const started=await startedResponse.json();
 console.log(JSON.stringify({stage:'gradescope-start',status:startedResponse.status,code:started.code??'started'}));
 const courses=['123','456','789'].map((courseId,index)=>({courseId,checkedAt:at,errorCode:null,parseDiagnosticCounts:[],assignments:Array.from({length:7},(_,j)=>({courseId,assignmentId:String(1000+index*7+j),title:'Synthetic assignment '+j,releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:'Submitted25 Minutes Late',state:'unknown',isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,gradeDisplay:null,checkedAt:at,extractorVersion:'gradescope-html-v1'}))}));
 const response=await worker.fetch(origin+'/api/sources/gradescope/sync/complete',{method:'POST',redirect:'manual',headers:{...headers,'x-kairos-calendar-sync':'defer'},body:JSON.stringify({requestId:started.requestId,batches:[{protocolVersion:1,requestId:started.requestId,courses,errorCode:null}]})});
 const completed=await response.json();console.log(JSON.stringify({stage:'gradescope-complete',statements:response.headers.get('x-probe-d1-statements')}));
 const owner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='source:gradescope'").bind(user).first();
 const statuses=(await db.prepare("SELECT COUNT(*) AS n FROM assignment_submission_status WHERE user_id=? AND state='submitted' AND is_late=1").bind(user).first()).n;
 results.push({mode:'gradescope21',status:response.status,code:completed.code??'completed',statuses,owner:owner.state,statements:Number(response.headers.get('x-probe-d1-statements')),ok:Number(response.headers.get('x-probe-d1-statements'))<=35&&response.status===200&&statuses===21&&owner.state==='idle'});

 await db.prepare("INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,remote_calendar_name,enabled,last_error_code,created_at,updated_at) VALUES (?,?,'google','Google Calendar','synthetic-existing-calendar','Kairos',0,'CALENDAR_AUTH_REQUIRED',?,?)").bind(user,'synthetic-google',at,at).run();
 const assignment=await db.prepare('SELECT id FROM assignments WHERE user_id=? LIMIT 1').bind(user).first();
 await db.prepare("INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,created_at,updated_at) VALUES (?,'synthetic-link','synthetic-google',?,'synthetic-key',?,?,?)").bind(user,assignment.id,'a'.repeat(64),at,at).run();
 const googleStart=await worker.fetch(origin+'/api/calendars/google/start',{method:'POST',redirect:'manual',headers,body:JSON.stringify({connectionId:'synthetic-google'})});
 const googleBody=await googleStart.json();console.log(JSON.stringify({stage:'google-start-response',status:googleStart.status,keys:Object.keys(googleBody),code:googleBody.code??null}));
 const googleOwner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='calendar:google'").bind(user).first();
 results.push({mode:'google-reconnect-start',status:googleStart.status,code:googleBody.code??'authorization',statements:googleStart.headers.get('x-probe-d1-statements'),owner:googleOwner?.state,ok:googleStart.status===200&&new URL(googleBody.authorizationUrl??googleBody.url).hostname==='accounts.google.com'&&googleOwner.state==='idle'});
 const state=new URL(googleBody.authorizationUrl).searchParams.get('state');
 const callback=await worker.fetch(origin+'/api/calendars/google/callback?state='+encodeURIComponent(state)+'&code=synthetic-code',{redirect:'manual',headers});
 const connected=await db.prepare("SELECT remote_calendar_id,enabled FROM calendar_connections WHERE user_id=? AND id='synthetic-google'").bind(user).first();
 const link=await db.prepare("SELECT remote_event_id FROM calendar_event_links WHERE user_id=? AND id='synthetic-link'").bind(user).first();
 const grants=await db.prepare("SELECT COUNT(*) AS n FROM calendar_credentials WHERE user_id=? AND calendar_connection_id='synthetic-google'").bind(user).first();
 const fixtureState=await (await (await mf.getWorker('fixture')).fetch('http://fixture.invalid/__probe/summary')).json();
 const callbackOwner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='calendar:google'").bind(user).first();
 results.push({mode:'google-reconnect-preserves-destination-and-events',status:callback.status,calendarWrites:fixtureState.calendarWrites,
   ok:callback.status===307&&connected.remote_calendar_id==='synthetic-existing-calendar'&&connected.enabled===1&&link.remote_event_id==='a'.repeat(64)&&grants.n===1&&callbackOwner.state==='idle'&&fixtureState.calendarWrites===0});
 await db.prepare("UPDATE sessions SET expires='2000-01-01T00:00:00.000Z'").run();
 const expired=await worker.fetch(origin+'/sign-in?returnTo=/sources',{redirect:'manual',headers:{cookie:'__Secure-authjs.session-token=synthetic-live-session'}});
 const markup=await expired.text();
 results.push({mode:'expired-session-shared-widget',status:expired.status,ok:expired.status===200&&(markup.match(/<form[ >]/g)??[]).length===1&&markup.includes('Continue with Google')&&markup.includes('Continue with Microsoft')});
 const summary={code:results.every(r=>r.ok)?'COMPILED_PROVIDER_WORK_PASSED':'COMPILED_PROVIDER_WORK_FAILED',externalRequests:0,results};
 fs.mkdirSync('artifacts/native-provider-completion',{recursive:true});fs.writeFileSync('artifacts/native-provider-completion/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
 if(results.length!==9||results.some(r=>!r.ok))process.exitCode=1;
}catch{console.error('COMPILED_PROVIDER_WORK_FAILED');process.exitCode=1;}finally{await mf.dispose();}
