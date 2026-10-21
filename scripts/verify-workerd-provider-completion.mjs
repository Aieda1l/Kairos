// Trusted local compiled-release probe: synthetic keys/D1/OIDC; sealed networking.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const bundled=await build({entryPoints:['dist/server/index.js'],bundle:true,write:false,format:'esm',platform:'browser',external:['node:*','cloudflare:*'],logLevel:'silent'});
let script=bundled.outputFiles[0].text;
const exportAt=script.lastIndexOf('\nexport {');
const defaultName=script.slice(exportAt).match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\s*[,}]/)?.[1];
if(exportAt<0||!defaultName)throw new Error('COMPILED_PROVIDER_EXPORT_INVALID');
// Instrument only the isolated probe. The production artifact is unchanged.
const counter=`const probeFetch=${defaultName}.fetch;${defaultName}.fetch=async(request,env,ctx)=>{
 const db=env.DB,prepare=db.prepare,batch=db.batch,originalFetch=globalThis.fetch;let count=0,external=0;globalThis.fetch=(...args)=>{if(++external>50)throw new Error("Synthetic external request budget exceeded");return originalFetch(...args);};
 const tick=(n=1)=>{count+=n;if(count>1000)throw new Error('Synthetic D1 statement budget exceeded');};
 const wrap=statement=>{const bind=statement.bind.bind(statement);statement.bind=(...args)=>wrap(bind(...args));
  for(const method of ['first','all','run']){const call=statement[method].bind(statement);statement[method]=(...args)=>{tick();return call(...args);};}return statement;};
 db.prepare=sql=>wrap(prepare.call(db,sql));db.batch=statements=>{tick(statements.length);return batch.call(db,statements);};
 try{const response=await probeFetch.call(${defaultName},request,env,ctx);const headers=new Headers(response.headers);headers.set('x-probe-d1-statements',String(count));headers.set('x-probe-external-requests',String(external));return new Response(response.body,{status:response.status,headers});}
 finally{db.prepare=prepare;db.batch=batch;globalThis.fetch=originalFetch;}
};`;
script=script.slice(0,exportAt)+'\n'+counter+script.slice(exportAt);
const fixture=`let calendarWrites=0,sequence=0,capacityActive=false;const events=new Map(),transactions=new Map();export default {async fetch(request){
 const url=new URL(request.url);
 if(url.pathname==='/__probe/reset'){
  capacityActive=true;events.clear();transactions.clear();calendarWrites=0;
  for(const row of await request.json())events.set(row.provider+':'+row.event.id,row.event);
  return Response.json({ok:true});
 }
 const provider=url.hostname==='graph.microsoft.com'?'microsoft':url.hostname==='www.googleapis.com'?'google':null;
 if(capacityActive&&provider&&url.pathname.includes('/events')){
  const collection=url.pathname.endsWith('/events'),id=decodeURIComponent(url.pathname.split('/').at(-1)),key=provider+':'+id;
  if(request.method==='GET'){
   if(!collection)return events.has(key)?Response.json(events.get(key)):new Response(null,{status:404});
   const query=url.searchParams.get('$filter')??'',assignment=query.match(/value eq '([^']+)'/)?.[1];
   const all=[...events.entries()].filter(([k])=>k.startsWith(provider+':')).map(([,e])=>e);
   return Response.json({value:assignment?all.filter(e=>e.singleValueExtendedProperties?.some(p=>p.value===assignment)):all});
  }
  if(request.method==='DELETE'){calendarWrites++;events.delete(key);return new Response(null,{status:204});}
  const body=await request.json();calendarWrites++;
  if(request.method==='POST'){
   const eventId=body.id??transactions.get(body.transactionId)??'created-'+(++sequence);
   if(body.transactionId)transactions.set(body.transactionId,eventId);
   const event={...body,id:eventId};events.set(provider+':'+eventId,event);return Response.json(event);
  }
  if(request.method==='PATCH'){
   if(!events.has(key))return new Response(null,{status:404});
   const event={...events.get(key),...body,id};events.set(key,event);return Response.json(event);
  }
 }

 if(url.hostname==='login.microsoftonline.com'&&url.pathname.endsWith('/token'))return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer'});
 if(url.hostname==='graph.microsoft.com'){
  if(request.method==='GET'&&!url.pathname.includes('/events'))return Response.json({id:'synthetic-existing-microsoft',name:'Kairos',canEdit:true});
  if(request.method==='GET'&&url.pathname.includes('/events/')){const id=decodeURIComponent(url.pathname.split('/').at(-1));return Response.json({id,singleValueExtendedProperties:[{id:'String {2f7d7a8c-8936-4e44-a436-9d7878afc0b1} Name KairosAssignmentId',value:id.replace('event-','')}]});}
  calendarWrites++;return new Response(null,{status:502});
 }
 if(url.pathname==='/__probe/summary')return Response.json({calendarWrites});
 if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer'});
 if(url.href==='https://www.googleapis.com/calendar/v3/calendars/synthetic-existing-calendar'&&request.method==='GET')return Response.json({id:'synthetic-existing-calendar',summary:'Kairos'});
 if(url.hostname==='www.googleapis.com'&&url.pathname.includes('/events/')){
  const id=decodeURIComponent(url.pathname.split('/').at(-1));
  if(request.method==='GET')return Response.json({id});
  if(request.method==='PATCH'){calendarWrites++;return Response.json({id});}
 }
 if(url.href==='https://www.googleapis.com/calendar/v3/users/me/calendarList/synthetic-existing-calendar'&&request.method==='GET')return Response.json({error:{errors:[{reason:'authError'}]}},{status:401});
 if(url.href==='https://www.googleapis.com/calendar/v3/calendars/synthetic-existing-calendar/events?maxResults=1&fields=accessRole'&&request.method==='GET')return Response.json({accessRole:'owner'});
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
bindings.MICROSOFT_CALENDAR_CLIENT_ID='00000000-0000-4000-8000-000000000001';bindings.MICROSOFT_CALENDAR_CLIENT_SECRET='synthetic-secret';bindings.MICROSOFT_CALENDAR_TENANT='common';bindings.GOOGLE_CALENDAR_CLIENT_ID='synthetic-client';bindings.GOOGLE_CALENDAR_CLIENT_SECRET='synthetic-client-secret';const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers:[
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

 await db.prepare("INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,remote_calendar_name,enabled,created_at,updated_at) VALUES (?,?,'microsoft','Microsoft Calendar','synthetic-existing-microsoft','Kairos',0,?,?)").bind(user,'synthetic-microsoft',at,at).run();
 const msStart=await worker.fetch(origin+'/api/calendars/microsoft/start',{method:'POST',redirect:'manual',headers,body:JSON.stringify({connectionId:'synthetic-microsoft'})});
 const msBody=await msStart.json();if(msStart.status!==200)throw new Error('MS_AUTH_START');
 const msState=new URL(msBody.authorizationUrl).searchParams.get('state');
 const msCallback=await worker.fetch(origin+'/api/calendars/microsoft/callback?state='+encodeURIComponent(msState)+'&code=synthetic-code',{redirect:'manual',headers});
 if(msCallback.status!==307)throw new Error('MS_AUTH_CALLBACK');
 const msAssignments=(await db.prepare('SELECT id,course_name,title,source_status_text,source_url FROM assignments WHERE user_id=? LIMIT 17').bind(user).all()).results;
 const startsAt='2026-10-20T23:59:00.000Z',endsAt='2026-10-21T00:14:00.000Z';
 for(const a of msAssignments){
  await db.prepare('UPDATE assignments SET due_at=? WHERE user_id=? AND id=?').bind(startsAt,user,a.id).run();
  const projection={assignmentId:a.id,title:'['+a.course_name+'] '+a.title,description:['Course: '+a.course_name,'Source: Gradescope','Status: '+a.source_status_text,'Due: '+startsAt,'','Open in source:',a.source_url].join('\n'),startsAt,endsAt,sourceUrl:a.source_url};
  const hash=createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  await db.prepare("INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,content_hash,created_at,updated_at) VALUES (?,?,'synthetic-microsoft',?,?,?,?,?,?)").bind(user,'ms-link-'+a.id,a.id,'key-'+a.id,'event-'+a.id,hash,at,at).run();
 }
 await db.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,'calendar_hide_submitted','0',?)").bind(user,at).run();
 const msSync=await worker.fetch(origin+'/api/calendars/synthetic-microsoft/sync',{method:'POST',redirect:'manual',headers});
 const msResult=await msSync.json(),msOwner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='calendar:microsoft'").bind(user).first();
 results.push({mode:'microsoft17-existing-events',status:msSync.status,statements:msSync.headers.get('x-probe-d1-statements'),owner:msOwner?.state,result:msResult,ok:msSync.status===200&&msResult.unchangedCount===17&&msOwner?.state==='idle'&&Number(msSync.headers.get('x-probe-d1-statements'))<=45});


 // Recovered Google mappings have no trusted content hash. Their first sync
 // updates existing events; any attempted calendar/event creation fails closed.
 await db.prepare('UPDATE assignments SET due_at=NULL WHERE user_id=?').bind(user).run();
 const googleAssignments=[assignment,...msAssignments.filter(a=>a.id!==assignment.id)].slice(0,11);
 for(let i=0;i<googleAssignments.length;i++){
  const a=googleAssignments[i];await db.prepare('UPDATE assignments SET due_at=? WHERE user_id=? AND id=?').bind(startsAt,user,a.id).run();
  if(i>0)await db.prepare("INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,created_at,updated_at) VALUES (?,?,'synthetic-google',?,?,?,?,?)").bind(user,'google-link-'+i,a.id,'google-key-'+i,createHash('sha256').update('synthetic-google-event-'+i).digest('hex'),at,at).run();
 }
 const googleSync=await worker.fetch(origin+'/api/calendars/synthetic-google/sync',{method:'POST',redirect:'manual',headers});
 const googleSyncResult=await googleSync.json(),googleSyncOwner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key='calendar:google'").bind(user).first();
 const afterEvents=await (await (await mf.getWorker('fixture')).fetch('http://fixture.invalid/__probe/summary')).json();
 results.push({mode:'google11-recovered-events',status:googleSync.status,statements:Number(googleSync.headers.get('x-probe-d1-statements')),owner:googleSyncOwner?.state,result:googleSyncResult,
  ok:googleSync.status===200&&googleSyncResult.updatedCount===11&&googleSyncResult.createdCount===0&&googleSyncOwner?.state==='idle'&&afterEvents.calendarWrites===11&&Number(googleSync.headers.get('x-probe-d1-statements'))<=50});


 {
 const startsAt='2026-10-22T23:59:00.000Z',endsAt='2026-10-23T00:14:00.000Z';
 const property='String {2f7d7a8c-8936-4e44-a436-9d7878afc0b1} Name KairosAssignmentId';
 await db.prepare('DELETE FROM assignments WHERE user_id=?').bind(user).run();
 for(let i=0;i<66;i++)await db.prepare("INSERT INTO assignments(user_id,id,source_connection_id,source_kind,external_id,course_name,title,due_at,status,source_status_text,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'synthetic-gs','gradescope',?,'Synthetic',?,?,?, ?,?,?,?,?)")
  .bind(user,'synthetic-a-'+i,String(i),'Assignment '+i,startsAt,i<16?'pending':'submitted',i<16?'Not Submitted':'Submitted',at,at,at,at).run();
 await db.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,'calendar_hide_submitted','1',?) ON CONFLICT(user_id,key) DO UPDATE SET value='1'").bind(user,at).run();
 async function reset(){
  await db.prepare('DELETE FROM calendar_event_links WHERE user_id=?').bind(user).run();
  await db.prepare("UPDATE calendar_connections SET enabled=1 WHERE user_id=?").bind(user).run();
  const seeds=[];
  for(const [provider,eligible,hidden] of [['google',3,8],['microsoft',10,7]]){
   for(const i of [...Array.from({length:eligible},(_,i)=>i),...Array.from({length:hidden},(_,i)=>16+i)]){
    const id='synthetic-a-'+i,eventId=provider+'-event-'+i;
    const projection={assignmentId:id,title:'[Synthetic] Assignment '+i,description:['Course: Synthetic','Source: Gradescope','Status: Not Submitted','Due: '+startsAt].join('\n'),startsAt,endsAt,sourceUrl:null};
    const hash=provider==='microsoft'&&i<16?createHash('sha256').update(JSON.stringify(projection)).digest('hex'):null;
    await db.prepare('INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
     .bind(user,provider+'-link-'+i,'synthetic-'+provider,id,provider+'-key-'+i,eventId,hash,at,at).run();
    seeds.push({provider,event:{id:eventId,...(provider==='microsoft'?{singleValueExtendedProperties:[{id:property,value:id}]}:{})}});
   }
  }
  await (await mf.getWorker('fixture')).fetch('http://fixture.invalid/__probe/reset',{method:'POST',body:JSON.stringify(seeds)});
 }

 const calls=[];
 async function splitPass(){
  const planned=await worker.fetch(origin+'/api/calendars/sync-all',{method:'POST',redirect:'manual',headers:{...headers,'x-kairos-calendar-invocations':'separate'}});
  const plan=await planned.json();
  if(planned.status!==200||plan.invocations?.length!==2||Number(planned.headers.get('x-probe-external-requests'))!==0)throw new Error('SPLIT_PREPARATION_FAILED');
  const pass=[];
  for(const ticket of plan.invocations){
   const response=await worker.fetch(origin+'/api/calendars/'+ticket.connectionId+'/sync',{method:'POST',redirect:'manual',headers:{...headers,'x-kairos-calendar-run':ticket.runId}});
   const result=await response.json(),externalRequests=Number(response.headers.get('x-probe-external-requests')),statements=Number(response.headers.get('x-probe-d1-statements'));
   const owner=await db.prepare("SELECT state FROM operation_locks WHERE user_id=? AND operation_key=?").bind(user,'calendar:'+ticket.connectionId.replace('synthetic-','')).first();
   const replayed=await worker.fetch(origin+'/api/calendars/'+ticket.connectionId+'/sync',{method:'POST',redirect:'manual',headers:{...headers,'x-kairos-calendar-run':ticket.runId}});
   pass.push({provider:ticket.connectionId.replace('synthetic-',''),status:response.status,externalRequests,statements,result,ok:response.status===200&&result.status==='success'&&externalRequests<=50&&statements<1000&&owner.state==='idle'&&replayed.status===400});
  }
  calls.push(pass);return pass;
 }
 await reset();
 const oldBatch=await worker.fetch(origin+'/api/calendars/sync-all',{method:'POST',redirect:'manual',headers});
 const initial=await splitPass(),repeat=await splitPass();
 const google=initial.find(r=>r.provider==='google').result,microsoft=initial.find(r=>r.provider==='microsoft').result;
 results.push({mode:'free-plan-split-recovery',calls,ok:oldBatch.status===409&&initial.length===2&&calls.flat().every(r=>r.ok)
  &&google.createdCount===13&&google.updatedCount===3&&google.deletedCount===8
  &&microsoft.createdCount===6&&microsoft.deletedCount===7&&microsoft.unchangedCount===10
  &&repeat.every(r=>r.result.unchangedCount===16&&r.result.createdCount===0&&r.result.deletedCount===0)});
 }

 await db.prepare("UPDATE sessions SET expires='2000-01-01T00:00:00.000Z'").run();
 const expired=await worker.fetch(origin+'/sign-in?returnTo=/sources',{redirect:'manual',headers:{cookie:'__Secure-authjs.session-token=synthetic-live-session'}});
 const markup=await expired.text();
 results.push({mode:'expired-session-shared-widget',status:expired.status,ok:expired.status===200&&(markup.match(/<form[ >]/g)??[]).length===1&&markup.includes('Continue with Google')&&markup.includes('Continue with Microsoft')});
 const summary={code:results.every(r=>r.ok)?'COMPILED_PROVIDER_WORK_PASSED':'COMPILED_PROVIDER_WORK_FAILED',externalRequests:0,results};
 fs.mkdirSync('artifacts/native-provider-completion',{recursive:true});fs.writeFileSync('artifacts/native-provider-completion/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
 if(results.length!==12||results.some(r=>!r.ok))process.exitCode=1;
}catch{console.error('COMPILED_PROVIDER_WORK_FAILED');process.exitCode=1;}finally{await mf.dispose();}
