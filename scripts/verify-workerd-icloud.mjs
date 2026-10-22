// Compiled application, synthetic D1/session/Apple fixture, sealed networking.
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const entry=path.resolve(process.env.KAIROS_ICLOUD_PROBE_ENTRY??'dist/server/index.js');
if(!entry.startsWith(process.cwd()+path.sep))throw new Error('Probe artifact outside workspace');
const built=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',external:['node:*','cloudflare:*'],logLevel:'silent'});
let script=built.outputFiles[0].text;
const exportAt=script.lastIndexOf('\nexport {'),name=script.slice(exportAt).match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\s*[,}]/)?.[1];
if(exportAt<0||!name)throw new Error('Compiled export missing');
script=script.slice(0,exportAt)+`
const probeFetch=${name}.fetch;${name}.fetch=async(request,env,ctx)=>{
 const db=env.DB,prepare=db.prepare,batch=db.batch,rawFetch=globalThis.fetch;let statements=0,external=0;
 const tick=(n=1)=>{statements+=n;if(statements>1000)throw new Error('Synthetic D1 bound exceeded');};
 const wrap=s=>{const bind=s.bind.bind(s);s.bind=(...values)=>wrap(bind(...values));for(const key of ['first','all','run']){const call=s[key].bind(s);s[key]=(...args)=>{tick();return call(...args);};}return s;};
 db.prepare=sql=>wrap(prepare.call(db,sql));db.batch=rows=>{tick(rows.length);return batch.call(db,rows);};
 globalThis.fetch=(...args)=>{if(++external>50)throw new Error('Synthetic external request bound exceeded');return rawFetch(...args);};
 try{const r=await probeFetch.call(${name},request,env,ctx),h=new Headers(r.headers);h.set('x-probe-statements',String(statements));h.set('x-probe-external',String(external));return new Response(r.body,{status:r.status,headers:h});}
 finally{db.prepare=prepare;db.batch=batch;globalThis.fetch=rawFetch;}
};
`+script.slice(exportAt);
const calendar='https://p12-caldav.icloud.com/synthetic/kairos/';
const fixture=`const calendar=${JSON.stringify(calendar)};let events=new Map(),attempts=new Map(),mode='',target='',active=0,maxActive=0,sequence=0,reports=0;
export default {async fetch(request){
 const url=new URL(request.url),id=url.pathname.split('/').at(-1);
 if(url.pathname==='/reset'){const input=await request.json();events=new Map(input.events);attempts=new Map();mode=input.mode;target=input.target;active=0;maxActive=0;sequence=0;reports=0;return Response.json({ok:true});}
 if(url.pathname==='/summary')return Response.json({events:events.size,originals:[...events.keys()].filter(id=>id.startsWith('unmapped-')).length,targetAttempts:attempts.get(target)??0,maxActive,reports});
 if(!/^(?:p\\d+-)?caldav\\.icloud\\.com$/.test(url.hostname))return new Response(null,{status:502});
 if(request.method==='PROPFIND'){
  let prop;if(url.hostname==='caldav.icloud.com')prop='<d:current-user-principal><d:href>https://p12-caldav.icloud.com/principal/</d:href></d:current-user-principal>';
  else if(url.pathname==='/principal/')prop='<c:calendar-home-set><d:href>https://p12-caldav.icloud.com/home/</d:href></c:calendar-home-set>';
  else prop='<d:displayname>Kairos</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>';
  return new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>'+calendar+'</d:href><d:propstat><d:prop>'+prop+'</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207});
 }
 if(request.method==='GET'){const e=events.get(id);return e?new Response(e.body,{headers:{etag:e.etag}}):new Response(null,{status:404});}
 if(request.method==='REPORT'){
  reports++;const body=await request.text(),ids=[...body.matchAll(/<d:href>([^<]+)<\\/d:href>/g)].map(match=>match[1].split('/').at(-1));
  if(ids.length<1||ids.length>32||body.includes('calendar-data'))return new Response(null,{status:400});
  const rows=ids.map(eventId=>'<d:response><d:href>'+calendar+eventId+'</d:href>'+(events.has(eventId)?'<d:propstat><d:prop><d:getetag>'+events.get(eventId).etag+'</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>':'<d:status>HTTP/1.1 404 Not Found</d:status>')+'</d:response>');
  return new Response('<d:multistatus xmlns:d="DAV:">'+rows.reverse().join('')+'</d:multistatus>',{status:207});
 }
 if(request.method!=='PUT')return new Response(null,{status:405});
 active++;maxActive=Math.max(maxActive,active);try{
  await new Promise(resolve=>setTimeout(resolve,1));const body=await request.text(),old=events.get(id),count=(attempts.get(id)??0)+1;attempts.set(id,count);
  if(request.headers.get('if-none-match')==='*'&&old||request.headers.has('if-match')&&request.headers.get('if-match')!==old?.etag)return new Response(null,{status:412});
  const fail=id===target&&(count===1||mode==='persistent');
  if(!fail||mode==='accepted')events.set(id,{body,etag:'"v'+(++sequence)+'"'});
  return new Response(null,{status:fail?500:old?204:201,headers:{etag:'"v'+sequence+'"'}});
 }finally{active--;}
}};`;
const bindings={KAIROS_APP_URL:'https://mykairos.me',AUTH_URL:'https://mykairos.me',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',AUTH_SECRET:'synthetic-local-auth-secret-only',AUTH_GOOGLE_ID:'synthetic-id',AUTH_GOOGLE_SECRET:'synthetic-secret',AUTH_MICROSOFT_ENTRA_ID_ID:'synthetic-id',AUTH_MICROSOFT_ENTRA_ID_SECRET:'synthetic-secret',KAIROS_TURNSTILE_SITE_KEY:'local-probe-site',KAIROS_TURNSTILE_SECRET_KEY:'local-probe-secret',KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),KAIROS_CREDENTIAL_KEY_V1:Buffer.from(new Uint8Array(32).fill(9)).toString('base64url')};
const options=convertV4MiniflareOptions({cf:false,log:new Log(LogLevel.NONE),workers:[
 {name:'ingress',script:"export default {fetch(request,env){const h=new Headers(request.headers);h.set('host',new URL(request.url).host);return env.APP.fetch(new Request(request,{headers:h}));}};",modules:true,compatibilityDate:'2026-10-06',serviceBindings:{APP:'app'}},
 {name:'app',script,modules:true,compatibilityDate:'2026-10-06',compatibilityFlags:['nodejs_compat'],bindings,d1Databases:{DB:'synthetic-icloud'},outboundService:'fixture',serviceBindings:{ASSETS:()=>new Response(null,{status:404})}},
 {name:'fixture',script:fixture,modules:true,compatibilityDate:'2026-10-06'},
]});options.telemetry={enabled:false};
const mf=new Miniflare(options),results=[];
const hash=text=>createHash('sha256').update(text).digest('hex'),key=(c,a)=>hash(c+'\0'+a),resource=(c,a)=>hash(key(c,a))+'.ics';
const projection=i=>({assignmentId:'assignment-'+i,title:'[Synthetic] Work '+i,description:'Course: Synthetic\nSource: Canvas\nStatus: Pending\nDue: 2026-11-01T00:00:00.000Z',startsAt:'2026-11-01T00:00:00.000Z',endsAt:'2026-11-01T00:15:00.000Z',sourceUrl:null});
const ics=(id,p)=>['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kairos//Calendar Sync//EN','BEGIN:VEVENT','UID:'+id.slice(0,-4)+'@kairos.local','DTSTART:20261101T000000Z','DTEND:20261101T001500Z','SUMMARY:'+p.title,'DESCRIPTION:'+p.description.replaceAll('\n','\\n'),'TRANSP:TRANSPARENT','END:VEVENT','END:VCALENDAR',''].join('\r\n');
try{
 await mf.ready;const db=await mf.getD1Database('DB','app'),remote=await mf.getWorker('fixture'),origin='https://mykairos.me',at=new Date().toISOString();
 for(const name of fs.readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())for(const sql of fs.readFileSync('migrations/'+name,'utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 await db.prepare("INSERT INTO users(id) VALUES ('synthetic-user')").run();
 await db.prepare('INSERT INTO sessions(id,sessionToken,userId,expires) VALUES (?,?,?,?)').bind('synthetic-session','synthetic-cookie','synthetic-user',new Date(Date.now()+3600000).toISOString()).run();
 await db.prepare("INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES ('synthetic-user','source','canvas','Synthetic',?,?)").bind(at,at).run();
 for(let i=0;i<79;i++)await db.prepare("INSERT INTO assignments(user_id,id,source_connection_id,source_kind,external_id,course_name,title,due_at,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES ('synthetic-user',?,'source','canvas',?,'Synthetic',?,?,'pending',?,?,?,?)").bind('assignment-'+i,String(i),'Work '+i,i<18?'2026-11-01T00:00:00.000Z':null,at,at,at,at).run();
 const headers={origin,'content-type':'application/json',cookie:'__Secure-authjs.session-token=synthetic-cookie'};
 for(const mode of ['accepted','absent','persistent']){
  await db.prepare("DELETE FROM calendar_connections WHERE user_id='synthetic-user'").run();await db.prepare('DELETE FROM operation_locks').run();await db.prepare('DELETE FROM abuse_rate_events').run();
  await db.prepare("INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,remote_calendar_name,enabled,created_at,updated_at) VALUES ('synthetic-user','synthetic-caldav','caldav','Synthetic',?,'Kairos',0,?,?)").bind(calendar,at,at).run();
  const events=[];
  for(let i=0;i<12;i++){
   const id=resource('old-connection','assignment-'+i),p=projection(i);events.push([id,{body:ics(id,i<10?p:{...p,title:'Old title'}),etag:'"old-'+i+'"'}]);
   await db.prepare("INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,content_hash,created_at,updated_at) VALUES ('synthetic-user',?,'synthetic-caldav',?,?,?,?,?,?)").bind('link-'+i,'assignment-'+i,key('synthetic-caldav','assignment-'+i),id,i<10?hash(JSON.stringify(p)):null,at,at).run();
  }
  for(let i=0;i<19;i++)events.push(['unmapped-'+i+'.ics',{body:'Synthetic legacy event',etag:'"legacy"'}]);
  await remote.fetch('http://fixture.invalid/reset',{method:'POST',body:JSON.stringify({mode,target:resource('synthetic-caldav','assignment-12'),events})});
  const connected=await mf.dispatchFetch(origin+'/api/calendars/caldav/connect',{method:'POST',headers,body:JSON.stringify({connectionId:'synthetic-caldav',username:'synthetic@example.invalid',secret:'synthetic-private'})});if(connected.status!==200){const failure=await connected.json();throw new Error('Synthetic connect failed: '+JSON.stringify({status:connected.status,code:failure.code,message:failure.message}));}
  for(let pass=0;pass<(mode==='persistent'?1:2);pass++){
   const response=await mf.dispatchFetch(origin+'/api/calendars/synthetic-caldav/sync',{method:'POST',headers}),result=await response.json();
   const owner=await db.prepare("SELECT state FROM operation_locks WHERE user_id='synthetic-user' AND operation_key='calendar:caldav'").first(),summary=await (await remote.fetch('http://fixture.invalid/summary')).json();
   const calls=Number(response.headers.get('x-probe-external')),statements=Number(response.headers.get('x-probe-statements'));
   const ok=mode==='persistent'?response.status===409&&owner.state==='uncertain'&&summary.targetAttempts===2:response.status===200&&result.status==='success'&&owner.state==='idle'&&summary.events===37&&summary.originals===19&&summary.maxActive===1&&(pass===0?result.createdCount===6&&result.updatedCount===2&&result.unchangedCount===10:result.createdCount===0&&result.updatedCount===0&&result.unchangedCount===18);
   results.push({mode,pass,status:response.status,result,owner:owner.state,external:calls,statements,summary,ok:ok&&calls<=50&&(pass===0||calls===2&&statements===20&&summary.reports===2)});
   if(!ok)break;
  }
 }
 const report={code:results.length===5&&results.every(r=>r.ok)?'ICLOUD_COMPILED_CONFIRMATION_PASSED':'ICLOUD_COMPILED_CONFIRMATION_FAILED',realProviderRequests:0,results};
 fs.mkdirSync('artifacts/native-icloud-confirmation',{recursive:true});fs.writeFileSync('artifacts/native-icloud-confirmation/summary.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.code.endsWith('FAILED'))process.exitCode=1;
}finally{await mf.dispose();}
