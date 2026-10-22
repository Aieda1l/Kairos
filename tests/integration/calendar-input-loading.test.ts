import {afterEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {reconcileCalendarConnection} from '@/lib/calendar/reconcile';
import type {CalendarDestinationAdapter,RemoteCalendarEvent} from '@/lib/calendar/adapter';
import type {CalendarEventProjection} from '@/lib/calendar/projection';
import {hashCalendarProjection,projectAssignment} from '@/lib/calendar/projection';
import {D1AssignmentRepository} from '@/lib/db/d1/repositories/assignments';
import {D1CalendarEventLinkRepository} from '@/lib/db/d1/repositories/calendar-event-links';
import {createCalendarSyncKey} from '@/lib/calendar/sync-key';
import type {D1PreparedStatementLike,D1ResultLike} from '@/lib/db/d1/types';

const scope={userId:'alice'},due='2026-11-01T00:00:00.000Z';
afterEach(()=>vi.restoreAllMocks());

function setup(){
 const test=openD1TestDatabase();installProviderRuntime(test.db);
 for(const user of ['alice','bob']){
  test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(user);
  for(const kind of ['canvas','gradescope'])test.sqlite.prepare("INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES (?,?,?,'Synthetic','2026','2026')").run(user,kind,kind);
  for(const id of ['calendar','second'])test.sqlite.prepare("INSERT INTO calendar_connections(user_id,id,provider,label,remote_calendar_id,created_at,updated_at) VALUES (?,?,'caldav','Synthetic',?,'2026','2026')").run(user,id,user+'/'+id);
 }
 const events=new Map<string,RemoteCalendarEvent>(),writes:Array<{method:string;id:string;projection?:CalendarEventProjection}>=[];
 const adapter:CalendarDestinationAdapter={
  provider:'caldav',testConnection:async()=>{},ensureCalendar:async()=>{throw new Error('Unexpected calendar creation');},
  getEvent:async(_calendar,id)=>events.get(id)??null,
  createEvent:async(_calendar,projection)=>{const id='event-'+projection.assignmentId;writes.push({method:'create',id,projection});const event={remoteEventId:id,etag:'"new"',managedAssignmentId:projection.assignmentId};events.set(id,event);return event;},
  updateEvent:async(_calendar,id,projection)=>{writes.push({method:'update',id,projection});const event={remoteEventId:id,etag:'"new"',managedAssignmentId:projection.assignmentId};events.set(id,event);return event;},
  deleteEvent:async(_calendar,id)=>{writes.push({method:'delete',id});events.delete(id);},
 };
 function add(id:string,options:{user?:string;dueAt?:string|null;status?:string;source?:string;statusText?:string|null}={}){
  const user=options.user??'alice',source=options.source??'canvas';
  test.sqlite.prepare("INSERT INTO assignments(user_id,id,source_connection_id,source_kind,external_id,course_name,title,due_at,status,source_status_text,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,'Synthetic',?,?,?,?, '2026','2026','2026','2026')")
   .run(user,id,source,source,id,id,options.dueAt===undefined?due:options.dueAt,options.status??'pending',options.statusText??null);
 }
 async function link(id:string,options:{user?:string;calendar?:string;hash?:string|null}={}){
  const user=options.user??'alice',calendar=options.calendar??'calendar',repo=new D1CalendarEventLinkRepository(test.db,{userId:user});
  const assignment=(await new D1AssignmentRepository(test.db,{userId:user}).list()).find(a=>a.id===id)!;
  const projection=projectAssignment(assignment),row=await repo.ensure(calendar,id,createCalendarSyncKey(calendar,id));
  const remoteId=user+'-'+calendar+'-'+id;
  await repo.markSynced(row.id,remoteId,'"old"',options.hash??(projection?hashCalendarProjection(projection):'old'),'2026');
  events.set(remoteId,{remoteEventId:remoteId,etag:'"old"',managedAssignmentId:id});
  return row;
 }
 const run=()=>reconcileCalendarConnection(test.db,scope,'calendar',{adapterFactory:async()=>adapter});
 return {...test,add,link,run,events,writes};
}

// Count actual binding calls and returned assignment rows, including batch reads.
// The SQLite-backed statements and their normal execution remain intact.
function measure(test:ReturnType<typeof setup>){
 let calls=0;const assignmentRows:number[]=[],sqlByStatement=new WeakMap<D1PreparedStatementLike,string>();
 const prepare=test.db.prepare.bind(test.db),batch=test.db.batch.bind(test.db);
 const rows=(sql:string,result:D1ResultLike<unknown>)=>{if(sql.includes('FROM assignments a'))assignmentRows.push(result.results.length);};
 const wrap=(statement:D1PreparedStatementLike,sql:string):D1PreparedStatementLike=>{
  sqlByStatement.set(statement,sql);const bind=statement.bind.bind(statement);
  statement.bind=(...values)=>wrap(bind(...values),sql);
  const first=statement.first.bind(statement),all=statement.all.bind(statement),run=statement.run.bind(statement);
  statement.first=async<T>()=>{calls++;return first<T>();};
  statement.all=async<T>()=>{calls++;const result=await all<T>();rows(sql,result);return result;};
  statement.run=async<T>()=>{calls++;return run<T>();};
  return statement;
 };
 vi.spyOn(test.db,'prepare').mockImplementation(sql=>wrap(prepare(sql),sql));
 vi.spyOn(test.db,'batch').mockImplementation(async statements=>{calls++;const results=await batch(statements);statements.forEach((s,i)=>rows(sqlByStatement.get(s)??'',results[i]!));return results;});
 return {get calls(){return calls;},assignmentRows};
}

describe('hosted calendar input loading',()=>{
 it('keeps an unchanged mapped event within fifteen database calls while omitting undated unmapped rows',async()=>{
  const t=setup();try{
   t.add('dated');await t.link('dated');for(let i=0;i<78;i++)t.add('undated-'+i,{dueAt:null});
   const measured=measure(t);
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:1,createdCount:0,updatedCount:0,deletedCount:0});
   expect(measured.assignmentRows).toEqual([1]);expect(measured.calls).toBeLessThanOrEqual(15);
   expect(t.writes).toEqual([]);expect(t.events.size).toBe(1);
  }finally{t.close();}
 });
 it('loads no assignments when every assignment is undated and unmapped',async()=>{
  const t=setup();try{t.add('one',{dueAt:null});t.add('two',{dueAt:null});const measured=measure(t);
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:0,deletedCount:0});
   expect(measured.assignmentRows).toEqual([0]);expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('retains undated mapped assignments so their old events are removed',async()=>{
  const t=setup();try{t.add('mapped',{dueAt:null});t.add('unmapped',{dueAt:null});await t.link('mapped');const measured=measure(t);
   await expect(t.run()).resolves.toMatchObject({status:'success',deletedCount:1});
   expect(measured.assignmentRows).toEqual([1]);expect(t.writes).toEqual([{method:'delete',id:'alice-calendar-mapped'}]);
   expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM calendar_event_links WHERE user_id='alice' AND calendar_connection_id='calendar'").get()).toEqual({n:0});
  }finally{t.close();}
 });
 it('does not load undated assignments mapped only to another destination',async()=>{
  const t=setup();try{t.add('mapped',{dueAt:null});await t.link('mapped',{calendar:'second'});const measured=measure(t);
   await expect(t.run()).resolves.toMatchObject({status:'success',deletedCount:0});
   expect(measured.assignmentRows).toEqual([0]);expect(t.writes).toEqual([]);expect(t.events.has('alice-second-mapped')).toBe(true);
  }finally{t.close();}
 });
 it('scopes assignment selection to the authenticated account even when identifiers overlap',async()=>{
  const t=setup();try{t.add('same',{dueAt:null});t.add('same',{user:'bob',dueAt:null});await t.link('same',{user:'bob'});t.add('bob-dated',{user:'bob'});
   t.sqlite.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('bob','calendar_hide_submitted','0','2026')").run();const measured=measure(t);
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:0,updatedCount:0,deletedCount:0});
   expect(measured.assignmentRows).toEqual([0]);expect(t.writes).toEqual([]);expect(t.events.has('bob-calendar-same')).toBe(true);
  }finally{t.close();}
 });
 it('does not use another account\'s mapping for the same assignment and connection identifiers',async()=>{
  const t=setup();try{t.add('same');t.add('same',{user:'bob'});await t.link('same',{user:'bob'});
   await expect(t.run()).resolves.toMatchObject({status:'success',createdCount:1,unchangedCount:0});
   expect(t.writes).toMatchObject([{method:'create',id:'event-same'}]);expect(t.events.has('bob-calendar-same')).toBe(true);
   expect(t.sqlite.prepare("SELECT remote_etag FROM calendar_event_links WHERE user_id='bob'").get()).toEqual({remote_etag:'"old"'});
  }finally{t.close();}
 });
 it('does not apply another account\'s hide-submitted setting',async()=>{
  const t=setup();try{t.add('completed',{status:'submitted'});await t.link('completed');
   t.sqlite.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('bob','calendar_hide_submitted','0','2026')").run();
   await expect(t.run()).resolves.toMatchObject({status:'success',deletedCount:1,unchangedCount:0});expect(t.events.size).toBe(0);
  }finally{t.close();}
 });
 it('retains an undated mapping without a remote ID so its existing error is recorded',async()=>{
  const t=setup();try{t.add('incomplete',{dueAt:null});const repo=new D1CalendarEventLinkRepository(t.db,scope);
   const row=await repo.ensure('calendar','incomplete',createCalendarSyncKey('calendar','incomplete'));
   await expect(t.run()).resolves.toMatchObject({status:'error',failedCount:1,createdCount:0});
   expect(await repo.get('calendar','incomplete')).toMatchObject({id:row.id,lastErrorCode:'CALENDAR_EVENT_INVALID'});expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('removes mapped completed work with the default hide-submitted setting',async()=>{
  const t=setup();try{t.add('completed',{status:'submitted'});await t.link('completed');
   await expect(t.run()).resolves.toMatchObject({status:'success',deletedCount:1});expect(t.events.size).toBe(0);
  }finally{t.close();}
 });
 it('keeps completed work when hiding submitted assignments is disabled',async()=>{
  const t=setup();try{t.add('completed',{status:'submitted'});await t.link('completed');
   t.sqlite.prepare("INSERT INTO app_settings(user_id,key,value,updated_at) VALUES ('alice','calendar_hide_submitted','0','2026')").run();
   await expect(t.run()).resolves.toMatchObject({status:'success',unchangedCount:1,deletedCount:0});expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
 it('preserves saved Gradescope status normalization before deciding whether to remove an event',async()=>{
  const t=setup();try{t.add('completed',{source:'gradescope',status:'unknown',statusText:'Submitted 3 Days Late'});await t.link('completed');
   await expect(t.run()).resolves.toMatchObject({status:'success',deletedCount:1});expect(t.events.size).toBe(0);
  }finally{t.close();}
 });
 it('updates the existing event with changed title, due date and status text',async()=>{
  const t=setup();try{t.add('work');await t.link('work');
   t.sqlite.prepare("UPDATE assignments SET title='Revised',due_at='2026-11-02T03:00:00.000Z',source_status_text='Ready' WHERE user_id='alice' AND id='work'").run();
   await expect(t.run()).resolves.toMatchObject({status:'success',updatedCount:1,createdCount:0});
   expect(t.writes).toMatchObject([{method:'update',id:'alice-calendar-work',projection:{title:'[Synthetic] Revised',startsAt:'2026-11-02T03:00:00.000Z'}}]);
   expect(t.writes[0]?.projection?.description).toContain('Status: Ready');
  }finally{t.close();}
 });
 it.each(['missing','failed','malformed'] as const)('rejects a %s batch result before any event mutation',async mode=>{
  const t=setup();try{t.add('work');
   const good={success:true,results:[],meta:{changes:0}};
   vi.spyOn(t.db,'batch').mockResolvedValueOnce(mode==='missing'?[]:mode==='failed'?[good,{...good,success:false},good]:[good,{...good,results:null} as unknown as D1ResultLike,good]);
   await expect(t.run()).rejects.toBeDefined();expect(t.writes).toEqual([]);
   expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM calendar_event_links WHERE user_id='alice'").get()).toEqual({n:0});
   expect(t.sqlite.prepare("SELECT state FROM operation_locks WHERE user_id='alice'").get()).toEqual({state:'idle'});
  }finally{t.close();}
 });
 it('stops remote writes if the provider is paused after the input batch',async()=>{
  const t=setup();try{t.add('work');const batch=t.db.batch.bind(t.db);
   vi.spyOn(t.db,'batch').mockImplementationOnce(async statements=>{const result=await batch(statements);t.sqlite.exec("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:caldav'");return result;});
   await expect(t.run()).rejects.toBeDefined();expect(t.writes).toEqual([]);
  }finally{t.close();}
 });
});
