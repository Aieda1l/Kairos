import {afterEach,describe,expect,it,vi} from 'vitest';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1AssignmentRepository} from '@/lib/db/d1/repositories/assignments';
import {D1CalendarCredentialRepository} from '@/lib/db/d1/repositories/calendar-credentials';
import {D1CalendarEventLinkRepository} from '@/lib/db/d1/repositories/calendar-event-links';
import {createCalendarAdapterFactory} from '@/lib/calendar/provider-factory';
import {reconcileCalendarConnection} from '@/lib/calendar/reconcile';
import {projectAssignment} from '@/lib/calendar/projection';
import {caldavResourceName,serializeCalendarEvent} from '@/lib/calendar/caldav/ical';
import {createCalendarSyncKey} from '@/lib/calendar/sync-key';
import {ownedFetch,uncertainOwnedWork,withCaldavPutConfirmation,withOwnedOperation} from '@/lib/abuse/operation-lock';

const scope={userId:'icloud-synthetic'},calendar='https://p12-caldav.icloud.com/synthetic/kairos/';
const keyring={activeKeyId:'test',keys:{test:new Uint8Array(32).fill(42)}};
type Mode='accepted-500'|'rejected-500'|'lost-response'|'persistent-500'|'different-readback'|'paused'|'normal';
afterEach(()=>vi.restoreAllMocks());
async function setup(mode:Mode,options:{update?:boolean;weakEtag?:boolean;count?:number}={}){
 const test=openD1TestDatabase();installProviderRuntime(test.db);
 test.sqlite.exec(`INSERT INTO users(id) VALUES ('icloud-synthetic'),('other');
  INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES ('icloud-synthetic','source','canvas','Synthetic','2026','2026');
  INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,created_at,updated_at) VALUES ('icloud-synthetic','caldav','caldav','Synthetic','${calendar}','2026','2026'),('other','google','google','Keep','remote','2026','2026');`);
 const rows=Array.from({length:options.count??1},(_,i)=>({source:'canvas' as const,externalId:String(i),courseId:'synthetic',courseName:'Synthetic',title:'Synthetic '+i,releaseAt:null,dueAt:'2026-11-01T00:00:00Z',lateDueAt:null,status:'pending' as const,sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}));
 await new D1AssignmentRepository(test.db,scope).upsertMany('source',rows,'2026-10-21T00:00:00Z');
 await new D1CalendarCredentialRepository(test.db,scope,keyring).setCaldavCredentials('caldav','synthetic@example.invalid','synthetic-private');
 const assignments=await new D1AssignmentRepository(test.db,scope).list();
 const events=new Map<string,{body:string;etag:string}>();
 if(options.update){
  const assignment=assignments[0]!,syncKey=createCalendarSyncKey('old-connection',assignment.id),id=caldavResourceName(syncKey);
  const links=new D1CalendarEventLinkRepository(test.db,scope),link=await links.ensure('caldav',assignment.id,createCalendarSyncKey('caldav',assignment.id));
  await links.markSynced(link.id,id,null,'old','2026-10-20T00:00:00Z');
  events.set(id,{body:serializeCalendarEvent({...projectAssignment(assignment)! ,title:'Old title'},syncKey),etag:options.weakEtag?'W/"old"':'"old"'});
 }
 let puts=0,active=0,maxActive=0,sequence=0;const calls:Array<{method:string;id:string}>=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const method=init?.method??'GET',id=new URL(String(input)).pathname.split('/').at(-1)!;calls.push({method,id});
  if(method==='PROPFIND')return new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>'+calendar+'</d:href><d:propstat><d:prop><d:displayname>Kairos</d:displayname><d:resourcetype><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207});
  if(method==='GET'){const event=events.get(id);return event?new Response(event.body,{headers:{etag:event.etag}}):new Response(null,{status:404});}
  if(method==='REPORT'){
   const ids=[...String(init?.body).matchAll(/<d:href>([^<]+)<\/d:href>/g)].map(match=>match[1]!.split('/').at(-1)!);
   const rows=ids.map(eventId=>'<d:response><d:href>'+calendar+eventId+'</d:href>'+(events.has(eventId)?'<d:propstat><d:prop><d:getetag>'+events.get(eventId)!.etag+'</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>':'<d:status>HTTP/1.1 404 Not Found</d:status>')+'</d:response>');
   return new Response('<d:multistatus xmlns:d="DAV:">'+rows.join('')+'</d:multistatus>',{status:207});
  }
  if(method!=='PUT')throw new Error('Unexpected synthetic transport');
  puts++;active++;maxActive=Math.max(active,maxActive);
  try{
   await new Promise(resolve=>setTimeout(resolve,1));
   const headers=new Headers(init?.headers),previous=events.get(id);
   if(headers.get('if-none-match')==='*'&&previous||headers.has('if-match')&&headers.get('if-match')!==previous?.etag)return new Response(null,{status:412});
   const fail=mode==='persistent-500'||puts===1&&mode!=='normal';
   if(mode==='paused'&&puts===1)test.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:caldav'");
   if(!fail||['accepted-500','lost-response','different-readback'].includes(mode))events.set(id,{body:mode==='different-readback'?String(init?.body).replace('SUMMARY:','SUMMARY:Other '):String(init?.body),etag:'"v'+(++sequence)+'"'});
   if(fail&&mode==='lost-response')throw new TypeError('Synthetic response lost');
   return new Response(null,{status:fail?500:previous?204:201,headers:{etag:'"v'+sequence+'"'}});
  }finally{active--;}
 };
 const run=()=>reconcileCalendarConnection(test.db,scope,'caldav',{adapterFactory:createCalendarAdapterFactory(test.db,scope,keyring,{fetchImpl})});
 return {...test,events,calls,run,puts:()=>puts,maxActive:()=>maxActive};
}
describe('conditional iCloud write confirmation',()=>{
 it.each(['accepted-500','lost-response'] as const)('confirms an exact created event after %s without replaying the write',async mode=>{
  const t=await setup(mode);try{
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:1,failedCount:0});
   expect(t.puts()).toBe(1);expect(t.events.size).toBe(1);
   expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:caldav'").get()).toEqual({state:'idle'});
   expect((await new D1CalendarEventLinkRepository(t.db,scope).listByConnection('caldav'))[0]?.remoteEventId).toBe([...t.events.keys()][0]);
  }finally{t.close();}
 });
 it('retries one absent create with the same conditional resource URL',async()=>{
  const t=await setup('rejected-500');try{
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:1});
   expect(t.puts()).toBe(2);expect(new Set(t.calls.filter(c=>c.method==='PUT').map(c=>c.id)).size).toBe(1);expect(t.events.size).toBe(1);
  }finally{t.close();}
 });
 it('confirms an accepted conditional update without creating a replacement',async()=>{
  const t=await setup('accepted-500',{update:true});try{
   const original=[...t.events.keys()];await expect(t.run()).resolves.toMatchObject({status:'success',updatedCount:1,createdCount:0});
   expect(t.puts()).toBe(1);expect([...t.events.keys()]).toEqual(original);
  }finally{t.close();}
 });
 it.each(['persistent-500','different-readback'] as const)('retains uncertainty when %s cannot be confirmed',async mode=>{
  const t=await setup(mode);try{
   await expect(t.run()).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});expect(t.puts()).toBeLessThanOrEqual(2);
   expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:caldav'").get()).toEqual({state:'uncertain'});
  }finally{t.close();}
 });
 it('does not replay an update without a strong precondition',async()=>{
  const t=await setup('accepted-500',{update:true,weakEtag:true});try{
   await expect(t.run()).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});expect(t.puts()).toBe(1);
  }finally{t.close();}
 });
 it('rechecks provider admission before readback or a conditional retry',async()=>{
  const t=await setup('paused');try{
   await expect(t.run()).rejects.toBeDefined();expect(t.puts()).toBe(1);expect(t.calls.map(c=>c.method)).toEqual(['PROPFIND','PUT']);
   expect(t.sqlite.prepare("SELECT enabled FROM abuse_controls WHERE control_key='provider:caldav'").get()).toEqual({enabled:0});
  }finally{t.close();}
 });
 it('serializes iCloud writes while preserving every assignment',async()=>{
  const t=await setup('normal',{count:4});try{
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:4});expect(t.maxActive()).toBe(1);expect(t.events.size).toBe(4);
  }finally{t.close();}
 });
});

describe('iCloud confirmation ownership fences',()=>{
 const url=calendar+'a'.repeat(64)+'.ics',init={method:'PUT',headers:{'if-none-match':'*'},body:'synthetic-body'};
 it.each(['unconfirmed','early-confirm','other-ambiguity','wrong-url','wrong-body','wrong-condition'] as const)('retains uncertainty for %s',async mode=>{
  const t=await setup('normal');try{
   await expect(withOwnedOperation(t.db,scope,'calendar:caldav',()=>withCaldavPutConfirmation(url,init,async confirm=>{
    if(mode==='early-confirm')confirm();
    const transport=ownedFetch(async()=>new Response(null,{status:500}));
    await transport(mode==='wrong-url'?calendar+'b'.repeat(64)+'.ics':url,{
     ...init,...(mode==='wrong-body'?{body:'different'}:{}),...(mode==='wrong-condition'?{headers:{'if-match':'"other"'}}:{}),
    });
    if(mode==='other-ambiguity')uncertainOwnedWork();
    if(!['unconfirmed','early-confirm'].includes(mode))confirm();
   }))).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});
   expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:caldav'").get()).toEqual({state:'uncertain'});
  }finally{t.close();}
 });
 it('retains an unawaited confirmation until its exact result settles',async()=>{
  const t=await setup('normal');try{
   let finished=false;
   await withOwnedOperation(t.db,scope,'calendar:caldav',async()=>{
    void withCaldavPutConfirmation(url,init,async confirm=>{
     await ownedFetch(async()=>new Response(null,{status:500}))(url,init);
     await new Promise(resolve=>setTimeout(resolve,5));confirm();finished=true;
    });
   });
   expect(finished).toBe(true);expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE operation_key='calendar:caldav'").get()).toEqual({state:'idle'});
  }finally{t.close();}
 });
});
