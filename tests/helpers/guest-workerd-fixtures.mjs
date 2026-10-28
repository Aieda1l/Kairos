// Synthetic fixture generation and instrumentation only. Guest policy/parser code
// is imported from production by the entrypoints below, never reimplemented here.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export const fixtureRequestId = '00000000-0000-4000-8000-000000000001';
export const fixtureCheckedAt = '2026-10-24T12:00:00.000Z';

export function canvasBody(count = 1, nearCap = false, partial = false) {
  const events = Array.from({length: count}, (_, i) => [
    'BEGIN:VEVENT', `UID:event-assignment-${i + 1}`,
    `SUMMARY:${nearCap ? 'N'.repeat(440) : 'Homework'} ${i + 1} [Math]`,
    'DTSTART:20261025T120000Z',
    `URL:https://canvas.uw.edu/courses/12/assignments/${i + 1}`, 'END:VEVENT',
  ].join('\n'));
  if (partial) events.push('BEGIN:VEVENT\nUID:event-assignment-bad\nSUMMARY:Malformed\nDTSTART:not-a-date\nEND:VEVENT');
  let body = `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`;
  if (nearCap) body = body.replace('VERSION:2.0', 'VERSION:2.0\nX-PADDING:' + 'x'.repeat(2 * 1024 * 1024 - 64 - new TextEncoder().encode(body).length - 11));
  return body;
}

export function edBody(kind, count = 1, nearCap = false) {
  const payload = kind === 'courses' ? {user: {id: 1}, courses: Array.from({length: count}, (_, i) => ({
    course: {id: i + 1, code: nearCap ? 'C'.repeat(150) : 'C1', name: nearCap ? 'Course '.padEnd(220, 'N') : 'Course', year: 2026, session: 'Autumn'}, role: {role: 'student'},
  }))} : {modules: [], lessons: Array.from({length: count}, (_, i) => ({
    id: i + 1, course_id: 12, title: nearCap ? 'Lesson '.padEnd(450, 'N') : 'Lesson',
    status: 'unattempted', state: 'published', is_hidden: nearCap && i >= 1000,
    is_unlisted: false, due_at: fixtureCheckedAt,
  }))};
  if (nearCap) payload.padding = 'x'.repeat(2 * 1024 * 1024 - 64 - JSON.stringify(payload).length - 13);
  return JSON.stringify(payload);
}

export const emptyServerOnly = {name: 'empty-server-only', setup(api) {
  api.onResolve({filter: /^server-only$/}, () => ({path: 'server-only', namespace: 'empty'}));
  api.onLoad({filter: /.*/, namespace: 'empty'}, () => ({contents: '', loader: 'js'}));
}};

export async function sourceIdentity(root, inputs) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  const files = [...new Set([...inputs, ...git('ls-files', 'src/lib/guest', 'src/lib/sources', 'src/lib/http', 'src/lib/assignments', 'src/lib/abuse', 'src/lib/platform/abuse-runtime.ts', 'src/lib/db/d1', 'src/lib/security', 'src/lib/auth', 'src/lib/testing', 'migrations', 'package-lock.json', 'tsconfig.json').split('\n')])].filter(Boolean).sort();
  const hashes = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')])));
  return {ref: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0,
    qualification: 'Hashes identify measured inputs; a dirty pre-commit run is not exact integrated-source acceptance.', sha256: hashes};
}

const measuredDatabaseEntry = `
function measuredDatabase(db) {
 const stats = {statements:0, admissionStatements:0, admissionReadStatements:0, admissionWriteStatements:0, admissionRowsRead:0, admissionRowsWritten:0, readStatements:0, writeStatements:0, changes:0, protectedWriteStatements:0, accountStatements:0, rowsRead:0, rowsWritten:0, missingRowsRead:0, missingRowsWritten:0};
 const count=(sql,r)=>{
  stats.statements++; if(sql.includes('abuse_rate_events')) stats.admissionStatements++;
  if(!sql.includes('abuse_rate_events')&&!sql.includes('abuse_controls'))stats.accountStatements++;
  const write=/\\b(?:INSERT|UPDATE|DELETE)\\b/i.test(sql);
  if(sql.includes('abuse_rate_events')){stats[write?'admissionWriteStatements':'admissionReadStatements']++;stats.admissionRowsRead+=r.meta?.rows_read??0;stats.admissionRowsWritten+=r.meta?.rows_written??0;}
  stats[write?'writeStatements':'readStatements']++;
  if(write&&!sql.includes('abuse_rate_events'))stats.protectedWriteStatements++;
  stats.changes+=r.meta?.changes??0;
  for(const [field,meta,missing] of [['rowsRead','rows_read','missingRowsRead'],['rowsWritten','rows_written','missingRowsWritten']]){
   if(typeof r.meta?.[meta]==='number')stats[field]+=r.meta[meta];else stats[missing]++;
  }
  return r;
 };
 const wrap=(sql,s)=>({bind:(...args)=>wrap(sql,s.bind(...args)),all:async()=>count(sql,await s.all()),run:async()=>count(sql,await s.run()),first:async(column)=>{const row=count(sql,await s.all()).results[0]??null;return column?row?.[column]??null:row;}});
 return {stats,db:{prepare:sql=>wrap(sql,db.prepare(sql)),batch:()=>{throw new Error('Uninstrumented guest batch');},exec:()=>{throw new Error('Uninstrumented guest exec');}}};
}`;

// Sequential compiled requests only: wrap actual env.DB methods because default
// guest handlers obtain cloudflare:workers.env rather than a factory injection.
export function instrumentCompiledGuest(script) {
 const exportAt=script.lastIndexOf('\nexport {');
 const defaultName=script.slice(exportAt).match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\s*[,}]/)?.[1];
 if(exportAt<0||!defaultName)throw new Error('COMPILED_GUEST_EXPORT_INVALID');
 const instrumentation=`${measuredDatabaseEntry}
 const originalGuestFetch=${defaultName}.fetch;
 ${defaultName}.fetch=async(request,env,ctx)=>{
  const originalDb=env.DB,prepare=originalDb.prepare,batch=originalDb.batch,exec=originalDb.exec,originalFetch=globalThis.fetch;
  const measured=measuredDatabase({prepare:sql=>prepare.call(originalDb,sql)}),network={requests:0,bodyWithoutLength:0};
  originalDb.prepare=measured.db.prepare;originalDb.batch=measured.db.batch;originalDb.exec=measured.db.exec;
  globalThis.fetch=async(...args)=>{network.requests++;const response=await originalFetch(...args);if(!response.headers.has('content-length'))network.bodyWithoutLength++;return response;};
  try{const response=await originalGuestFetch.call(${defaultName},request,env,ctx);const headers=new Headers(response.headers);headers.set('x-probe-metrics',JSON.stringify({...measured.stats,...network}));return new Response(response.body,{status:response.status,headers});}
  finally{originalDb.prepare=prepare;originalDb.batch=batch;originalDb.exec=exec;globalThis.fetch=originalFetch;}
 };`;
 return script.slice(0,exportAt)+'\n'+instrumentation+script.slice(exportAt);
}

export const guestWorkerEntry = `
import {createGuestSourceHandler} from './src/lib/guest/server/source-handler';
import {createGuestSessionHandlers} from './src/lib/guest/server/session';
import {resolveGuestServerRuntime} from './src/lib/guest/server/runtime';
import {getGuestEnabled} from './src/lib/guest/server/feature';
import * as schemas from './src/lib/guest/sources/contracts';
${measuredDatabaseEntry}
export default {async fetch(request,env){
 const measured=measuredDatabase(env.DB), network={requests:0,bodyWithoutLength:0};
 const fetchImpl=async(...args)=>{network.requests++;const response=await fetch(...args);if(!response.headers.has('content-length'))network.bodyWithoutLength++;return response;};
 const getRuntime=async()=>resolveGuestServerRuntime({...env,DB:measured.db},fetchImpl);
 const path=new URL(request.url).pathname;
 const response=path==='/session'?await createGuestSessionHandlers({isEnabled:getGuestEnabled,getRuntime}).start(request):
  await createGuestSourceHandler(path==='/canvas'?'canvas-feed':path==='/courses'?'ed-courses':'ed-lessons',getRuntime)(request);
 const raw=await response.text(),payload=JSON.parse(raw);
 const schema=!payload.ok?schemas.guestApiErrorSchema:path==='/session'?schemas.guestSessionResponseSchema:path==='/canvas'?schemas.guestCanvasFeedResponseSchema:path==='/courses'?schemas.guestEdCoursesResponseSchema:schemas.guestEdLessonsResponseSchema;
 const headers=new Headers(response.headers);
 headers.set('x-probe-metrics',JSON.stringify({...measured.stats,...network,schemaValid:schema.safeParse(payload).success}));
 return new Response(raw,{status:response.status,headers});
}};`;

export const fixtureWorkerEntry = `
import {canvasBody,edBody} from './tests/helpers/guest-workerd-fixtures.mjs';
let mode='valid',providerRequests=0,challengeRequests=0,unexpectedAttempts=0,fixtureBytes=0;
const bodies=new Map();
const controls=[];
export default {async fetch(request,env){
 const url=new URL(request.url);
 // This administration origin is used only via the driver's service handle.
 if(url.origin==='http://fixture.invalid'&&url.pathname==='/configure'){
  mode=(await request.json()).mode;return Response.json({ok:true});
 }
 if(url.origin==='http://fixture.invalid'&&url.pathname==='/stats')return Response.json({providerRequests,challengeRequests,unexpectedAttempts,fixtureBytes,bodies:[...bodies.values()],controls});
 if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify'&&request.method==='POST'){
  challengeRequests++;const data=await request.formData();
  if(data.get('secret')!=='synthetic-guest-secret'||!String(data.get('response')).startsWith('synthetic-guest-')){unexpectedAttempts++;return new Response(null,{status:502});}
  return Response.json({success:true,hostname:'guest.invalid',action:'guest_sync'});
 }
 const canvas=url.origin==='https://canvas.uw.edu'&&url.pathname==='/feeds/calendars/synthetic.ics';
 const ed=url.origin==='https://us.edstem.org'&&['/api/user','/api/courses/12/lessons'].includes(url.pathname);
 if((!canvas&&!ed)||request.method!=='GET'||(ed&&request.headers.get('authorization')!=='Bearer synthetic-ed-secret')){unexpectedAttempts++;return new Response(null,{status:502});}
 providerRequests++;
 if(mode==='pause'||mode==='version'){
  const key=canvas?'provider:canvas':'provider:ed';
  const selected=await env.DB.prepare('SELECT * FROM abuse_controls WHERE control_key=?').bind(key).all();
  const before=selected.results[0];
  const after={...before,version:before.version+1,...(mode==='pause'?{enabled:0}:{})};
  const result=await env.DB.prepare('UPDATE abuse_controls SET enabled=?,version=? WHERE control_key=?').bind(after.enabled,after.version,key).run();
  controls.push({before,after,readMeta:selected.meta,writeMeta:result.meta,statements:2});
 }
 if(mode==='escaped')return new Response(null,{status:302,headers:{location:'https://escape.invalid/credential'}});
 if(mode==='redirect'||mode==='redirect-loop'){
  const hop=Number(url.searchParams.get('hop')??0);
  if(mode==='redirect-loop'||hop<5)return new Response(null,{status:302,headers:{location:'/feeds/calendars/synthetic.ics?hop='+(hop+1)}});
 }
 if(mode==='stalled')return new Response(new ReadableStream({start(c){this.timer=setInterval(()=>{fixtureBytes++;c.enqueue(new TextEncoder().encode(' '));},1000);},cancel(){clearInterval(this.timer);}}));
 let body=mode==='utf8'?new Uint8Array([0xc3,0x28]):mode==='overflow'?new Uint8Array(2*1024*1024+1):
  new TextEncoder().encode(canvas?(mode==='empty'?canvasBody(1).replace('event-assignment-','event-calendar-'):canvasBody(mode==='no-events'?0:mode==='near-cap'?2000:1,mode==='near-cap',mode==='partial')):
   edBody(url.pathname==='/api/user'?'courses':'lessons',mode==='empty'?0:mode==='near-cap'?(url.pathname==='/api/user'?500:2000):1,mode==='near-cap'));
 fixtureBytes+=body.byteLength;
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const identity=mode+':'+(canvas?'canvas':url.pathname==='/api/user'?'ed-courses':'ed-lessons');
 const previous=bodies.get(identity);
 bodies.set(identity,{identity,fixtureBytes:body.byteLength,sha256:digest,responses:(previous?.responses??0)+1});
 // Deliberately streamed without Content-Length, including overflow fixtures.
 return new Response(new ReadableStream({start(c){for(let i=0;i<body.length;i+=16384)c.enqueue(body.slice(i,i+16384));c.close();}}));
}};`;
