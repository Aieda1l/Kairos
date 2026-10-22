import {afterEach,describe,expect,it,vi} from 'vitest';
import {XMLParser} from 'fast-xml-parser';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1AssignmentRepository} from '@/lib/db/d1/repositories/assignments';
import {D1CalendarCredentialRepository} from '@/lib/db/d1/repositories/calendar-credentials';
import {D1CalendarEventLinkRepository} from '@/lib/db/d1/repositories/calendar-event-links';
import {createCalendarAdapterFactory} from '@/lib/calendar/provider-factory';
import {reconcileCalendarConnection} from '@/lib/calendar/reconcile';
import {hashCalendarProjection,projectAssignment} from '@/lib/calendar/projection';
import {caldavResourceName} from '@/lib/calendar/caldav/ical';
import {createCalendarSyncKey} from '@/lib/calendar/sync-key';

const scope={userId:'batch-user'},calendar='https://p12-caldav.icloud.com/synthetic/kairos/';
const keyring={activeKeyId:'test',keys:{test:new Uint8Array(32).fill(42)}};
type Mode='normal'|'omitted'|'property404'|'foreign'|'duplicate'|'malformed'|'unsupported'|'throttled'|'resource-throttled'|'server-error'|'paused'|'changed-etag';
afterEach(()=>vi.restoreAllMocks());

async function setup(options:{count?:number;mode?:Mode;update?:boolean;missing?:boolean}={}){
 const test=openD1TestDatabase();installProviderRuntime(test.db);
 test.sqlite.exec(`INSERT INTO users(id) VALUES ('batch-user'),('other');
  INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES ('batch-user','source','canvas','Synthetic','2026','2026');
  INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,created_at,updated_at) VALUES ('batch-user','caldav','caldav','Synthetic','${calendar}','2026','2026'),('other','keep','caldav','Keep','https://p12-caldav.icloud.com/other/kairos/','2026','2026');`);
 const rows=Array.from({length:options.count??16},(_,i)=>({source:'canvas' as const,externalId:String(i),courseId:'synthetic',courseName:'Synthetic',title:'Synthetic '+i,releaseAt:null,dueAt:'2026-11-01T00:00:00Z',lateDueAt:null,status:'pending' as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}));
 await new D1AssignmentRepository(test.db,scope).upsertMany('source',rows,'2026-10-21T00:00:00Z');
 await new D1CalendarCredentialRepository(test.db,scope,keyring).setCaldavCredentials('caldav','synthetic@example.invalid','synthetic-private');
 const links=new D1CalendarEventLinkRepository(test.db,scope),events=new Map<string,string>();
 for(const [i,assignment] of (await new D1AssignmentRepository(test.db,scope).list()).entries()){
  const syncKey=createCalendarSyncKey('caldav',assignment.id),id=caldavResourceName(syncKey);
  const link=await links.ensure('caldav',assignment.id,syncKey);
  await links.markSynced(link.id,id,'"old"',options.update?'old-hash':hashCalendarProjection(projectAssignment(assignment)!), '2026-10-20T00:00:00Z');
  if(!options.missing||i!==0)events.set(id,'"old"');
 }
 events.set('unmapped.ics','"keep"');
 const calls:Array<{method:string;ids:string[]}>=[],writes:string[]=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??'GET',id=url.pathname.split('/').at(-1)!;
  if(!url.href.startsWith(calendar))throw new Error('Unexpected calendar access');
  const call={method,ids:[] as string[]};calls.push(call);
  if(method==='PROPFIND')return new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>'+calendar+'</d:href><d:propstat><d:prop><d:displayname>Kairos</d:displayname><d:resourcetype><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207});
  if(method==='REPORT'){
   const parsed=new XMLParser({removeNSPrefix:true}).parse(String(init?.body))['calendar-multiget'];
   const hrefs=Array.isArray(parsed.href)?parsed.href:[parsed.href];
   call.ids=hrefs.map((href:string)=>new URL(href,calendar).pathname.split('/').at(-1)!);
   if(options.mode==='unsupported')return new Response(null,{status:405});
   if(options.mode==='throttled')return new Response(null,{status:429,headers:{'retry-after':'60'}});
   if(options.mode==='server-error')return new Response(null,{status:500});
   if(options.mode==='paused')test.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:caldav'");
   let responses=call.ids.map(eventId=>{
    const href=calendar+eventId;
    if(options.mode==='resource-throttled')return '<d:response><d:href>'+href+'</d:href><d:status>HTTP/1.1 429 Too Many Requests</d:status></d:response>';
    if(options.mode==='property404')return '<d:response><d:href>'+href+'</d:href><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>';
    return '<d:response><d:href>'+href+'</d:href>'+(events.has(eventId)?'<d:propstat><d:prop><d:getetag>'+events.get(eventId)+'</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>':'<d:status>HTTP/1.1 404 Not Found</d:status>')+'</d:response>';
   });
   if(options.mode==='omitted')responses=responses.slice(1);
   if(options.mode==='foreign')responses.push('<d:response><d:href>https://p12-caldav.icloud.com/other/kairos/unmapped.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>');
   if(options.mode==='duplicate')responses.push(responses[0]!);
   if(options.mode==='changed-etag')for(const eventId of call.ids)events.set(eventId,'"newer"');
   return new Response(options.mode==='malformed'?'<d:multistatus>':'<d:multistatus xmlns:d="DAV:">'+responses.reverse().join('')+'</d:multistatus>',{status:207});
  }
  if(method==='GET')return events.has(id)?new Response('Synthetic event',{headers:{etag:events.get(id)!}}):new Response(null,{status:404});
  writes.push(method);
  if(method==='PUT'){
   const headers=new Headers(init?.headers);
   if(headers.get('if-none-match')==='*'&&events.has(id)||headers.has('if-match')&&headers.get('if-match')!==events.get(id))return new Response(null,{status:412});
   events.set(id,'"written"');return new Response(null,{status:201,headers:{etag:'"written"'}});
  }
  throw new Error('Unexpected calendar mutation');
 };
 const run=()=>reconcileCalendarConnection(test.db,scope,'caldav',{adapterFactory:createCalendarAdapterFactory(test.db,scope,keyring,{fetchImpl})});
 return {...test,run,calls,writes,events};
}

describe('iCloud batched managed-event reads',()=>{
 it('checks sixteen unchanged mappings with one calendar check and one REPORT',async()=>{
  const t=await setup();try{
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:16,createdCount:0,updatedCount:0});
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT']);
   expect(t.writes).toEqual([]);expect(t.events.size).toBe(17);expect(t.events.get('unmapped.ics')).toBe('"keep"');
   expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:caldav'").get()).toEqual({state:'idle'});
   expect(t.sqlite.prepare("SELECT label FROM calendar_connections WHERE user_id='other'").get()).toEqual({label:'Keep'});
  }finally{t.close();}
 });
 it('bounds each REPORT while visiting every mapping',async()=>{
  const t=await setup({count:65});try{
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:65});
   expect(t.calls.filter(c=>c.method==='REPORT').map(c=>c.ids.length)).toEqual([32,32]);
   expect(t.calls.filter(c=>c.method==='GET')).toHaveLength(1);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('keeps the simpler GET path for a single mapped event',async()=>{
  const t=await setup({count:1});try{
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:1});
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','GET']);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it.each(['omitted','property404','foreign','duplicate','malformed','server-error'] as const)('does not recreate events from a %s response',async mode=>{
  const t=await setup({mode});try{
   await expect(t.run()).resolves.toMatchObject({status:'error',createdCount:0,updatedCount:0,failedCount:16});
   expect(t.writes).toEqual([]);expect(t.events.size).toBe(17);
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT']);
  }finally{t.close();}
 });
 it('recreates only an explicitly missing resource',async()=>{
  const t=await setup({missing:true});try{
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:1,unchangedCount:15});
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT','PUT']);expect(t.events.size).toBe(17);
  }finally{t.close();}
 });
 it('falls back once when REPORT is unsupported',async()=>{
  const t=await setup({count:33,mode:'unsupported'});try{
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:33});
   expect(t.calls.filter(c=>c.method==='REPORT')).toHaveLength(1);
   expect(t.calls.filter(c=>c.method==='GET')).toHaveLength(33);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('rechecks a provider pause after the batch before writing',async()=>{
  const t=await setup({mode:'paused',update:true});try{
   await expect(t.run()).rejects.toBeDefined();expect(t.writes).toEqual([]);
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT']);
  }finally{t.close();}
 });
 it('uses each observed ETag so a concurrent edit cannot be overwritten',async()=>{
  const t=await setup({count:2,mode:'changed-etag',update:true});try{
   await expect(t.run()).resolves.toMatchObject({status:'error',failedCount:2,createdCount:0,updatedCount:0});
   expect(t.events.values().next().value).toBe('"newer"');
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT','PUT','PUT']);
  }finally{t.close();}
 });
 it('stops on a throttled batch without individual-read fallback',async()=>{
  const t=await setup({mode:'throttled'});try{
   await expect(t.run()).resolves.toMatchObject({status:'error',createdCount:0});
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT']);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('stops scheduling later batches when an individual resource is throttled',async()=>{
  const t=await setup({count:65,mode:'resource-throttled'});try{
   await expect(t.run()).resolves.toMatchObject({status:'error',createdCount:0});
   expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','REPORT']);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
});
