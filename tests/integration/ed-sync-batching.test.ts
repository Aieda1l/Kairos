import {afterEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {D1SourceCredentialRepository} from '@/lib/db/d1/repositories/source-credentials';
import {D1SourceCourseRepository} from '@/lib/db/d1/repositories/source-courses';
import {D1AssignmentRepository} from '@/lib/db/d1/repositories/assignments';
import {syncEdConnection} from '@/lib/ed/sync-service';
import type {CredentialKeyring} from '@/lib/security/credential-cipher';
import type {D1DatabaseLike,D1PreparedStatementLike,D1ResultLike} from '@/lib/db/d1/types';
import type {NormalizedAssignment} from '@/lib/assignments/normalize';

const scope={userId:'alice'},before='2026-10-05T10:00:00.000Z',now='2026-10-06T12:00:00.000Z';
const keyring:CredentialKeyring={activeKeyId:'fixture',keys:{fixture:new Uint8Array(32).fill(17)}};
const closeDatabases:Array<()=>void>=[];
afterEach(()=>{vi.restoreAllMocks();for(const close of closeDatabases.splice(0))close();});

async function setup(courseIds=['123']){
 const t=openD1TestDatabase();closeDatabases.push(t.close);installProviderRuntime(t.db);
 for(const id of ['alice','bob'])t.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(id);
 const connection=await new D1SourceConnectionRepository(t.db,scope).upsertEd('Ed fixture');
 await new D1SourceCredentialRepository(t.db,scope,keyring).setEdApiToken(connection.id,'synthetic-ed-token');
 const courses=new D1SourceCourseRepository(t.db,scope);
 await courses.upsertDiscovered(connection.id,courseIds.map(id=>({externalCourseId:id,shortName:`CSE ${id}`,fullName:`Course ${id}`,term:'Autumn',year:'2026'})),before);
 await courses.setEnabled(connection.id,courseIds);
 const run=(items:unknown[],at=now)=>syncEdConnection(t.db,scope,keyring,{now:new Date(at),fetchImpl:(async()=>lessons(items)) as typeof fetch});
 const assignments=()=>new D1AssignmentRepository(t.db,scope).list({source:'ed'});
 return {...t,connection,run,assignments};
}
function lesson(id:number,extra:Record<string,unknown>={}){
 return {id,course_id:123,title:`Lesson ${id}`,status:'completed',is_hidden:false,is_unlisted:false,effective_due_at:'2026-11-01T10:00:00Z',...extra};
}
function lessons(items:unknown[]){return new Response(JSON.stringify({modules:[],lessons:items}),{status:200,headers:{'content-type':'application/json'}});}
function saved(externalId:string,courseId='123'):NormalizedAssignment{
 return {source:'ed',externalId,courseId,courseName:`CSE ${courseId}`,title:'Previously saved',releaseAt:null,dueAt:null,lateDueAt:null,status:'pending',sourceStatusText:'unattempted',gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null};
}

// Instrument terminal binding operations without replacing SQLite execution or
// changing the real statement classes required by the atomic batch helper.
function measure(db:D1DatabaseLike,afterBatch?:(sql:string[])=>void){
 let calls=0;const batches:string[][]=[],sqlByStatement=new WeakMap<D1PreparedStatementLike,string>();
 const prepare=db.prepare.bind(db),batch=db.batch.bind(db);
 const wrap=(statement:D1PreparedStatementLike,sql:string):D1PreparedStatementLike=>{
  sqlByStatement.set(statement,sql);const bind=statement.bind.bind(statement);
  statement.bind=(...values)=>wrap(bind(...values),sql);
  const first=statement.first.bind(statement),all=statement.all.bind(statement),run=statement.run.bind(statement);
  statement.first=async<T>()=>{calls++;return first<T>();};
  statement.all=async<T>()=>{calls++;return all<T>();};
  statement.run=async<T>()=>{calls++;return run<T>();};
  return statement;
 };
 vi.spyOn(db,'prepare').mockImplementation(sql=>wrap(prepare(sql),sql));
 vi.spyOn(db,'batch').mockImplementation(async statements=>{calls++;const sql=statements.map(s=>sqlByStatement.get(s)??'');batches.push(sql);const result=await batch(statements);afterBatch?.(sql);return result;});
 return {get calls(){return calls;},batches,reset(){calls=0;batches.length=0;}};
}

describe('hosted Ed persistence batching',()=>{
 it('persists 42 new rows and their statuses within 30 binding calls',async()=>{
  const t=await setup(),measured=measure(t.db);
  const result=await t.run(Array.from({length:42},(_,i)=>lesson(i+1)));
  expect(result).toMatchObject({insertedCount:42,updatedCount:0,statusUpdatedCount:42,failedCourseCount:0,lastErrorCode:null,lastSuccessfulAt:now});
  const calls=measured.calls,rows=await t.assignments();
  expect(rows).toHaveLength(42);expect(rows.every(row=>row.submissionStatus?.state==='submitted')).toBe(true);
  expect(calls).toBeLessThanOrEqual(30);
 });
 it('updates 42 existing rows within 30 binding calls without replacing their identities',async()=>{
  const t=await setup(),items=Array.from({length:42},(_,i)=>lesson(i+1));
  await t.run(items,before);const original=(await t.assignments()).map(a=>a.id).sort(),measured=measure(t.db);
  expect(await t.run(items.map(item=>({...item,title:'Revised',status:'unattempted'})))).toMatchObject({insertedCount:0,updatedCount:42,statusUpdatedCount:42});
  const calls=measured.calls,rows=await t.assignments();
  expect(rows.map(a=>a.id).sort()).toEqual(original);expect(rows.every(a=>a.title==='Revised'&&a.submissionStatus?.state==='unknown')).toBe(true);
  expect(calls).toBeLessThanOrEqual(30);
 });
 it.each([{count:101,maxCalls:32},{count:201,maxCalls:35}])('keeps $count rows within a bounded number of binding calls',async({count,maxCalls})=>{
  const t=await setup(),measured=measure(t.db);
  expect(await t.run(Array.from({length:count},(_,i)=>lesson(i+1)))).toMatchObject({insertedCount:count,updatedCount:0,statusUpdatedCount:count});
  const calls=measured.calls;expect(await t.assignments()).toHaveLength(count);expect(calls).toBeLessThanOrEqual(maxCalls);
 });
 it('preserves failed-course assignments while persisting a successful course',async()=>{
  const t=await setup(['123','456']);
  await new D1AssignmentRepository(t.db,scope).upsertMany(t.connection.id,[saved('900','456')],before);
  const result=await syncEdConnection(t.db,scope,keyring,{now:new Date(now),fetchImpl:(async(input)=>String(input).includes('/123/')?lessons([lesson(1)]):new Response('',{status:404})) as typeof fetch});
  expect(result).toMatchObject({insertedCount:1,statusUpdatedCount:1,failedCourseCount:1,lastErrorCode:'PARTIAL_SYNC',lastSuccessfulAt:now});
  expect(await t.assignments()).toEqual(expect.arrayContaining([expect.objectContaining({externalId:'900',title:'Previously saved',lastSeenAt:before,submissionStatus:null})]));
 });
 it('counts an empty successful course when recording partial-sync freshness',async()=>{
  const t=await setup(['123','456']);
  const result=await syncEdConnection(t.db,scope,keyring,{now:new Date(now),fetchImpl:(async(input)=>String(input).includes('/123/')?lessons([]):new Response('',{status:404})) as typeof fetch});
  expect(result).toMatchObject({insertedCount:0,updatedCount:0,statusUpdatedCount:0,failedCourseCount:1,lastErrorCode:'PARTIAL_SYNC',lastSuccessfulAt:now});
  expect(await new D1SourceConnectionRepository(t.db,scope).getByKind('ed')).toMatchObject({lastSyncStatus:'success',lastErrorCode:'PARTIAL_SYNC'});
 });
 it('preserves successful freshness when all courses fail',async()=>{
  const t=await setup();await t.run([lesson(1)],before);
  const result=await syncEdConnection(t.db,scope,keyring,{now:new Date(now),fetchImpl:(async()=>new Response('',{status:404})) as typeof fetch});
  expect(result).toMatchObject({insertedCount:0,statusUpdatedCount:0,failedCourseCount:1,lastErrorCode:'ED_COURSE_UNAVAILABLE',lastSuccessfulAt:before});
  expect((await t.assignments())[0]).toMatchObject({lastSeenAt:before,submissionStatus:{state:'submitted',checkedAt:before}});
  expect(await new D1SourceConnectionRepository(t.db,scope).getByKind('ed')).toMatchObject({lastSyncStatus:'error'});
 });
 it.each(['2026-10-06T11:59:59.000Z',now])('updates lesson metadata without regressing a status checked at the same or newer time (%s)',async(at)=>{
  const t=await setup();await t.run([lesson(1)],now);
  expect(await t.run([lesson(1,{title:'Metadata changed',status:'unattempted'})],at)).toMatchObject({insertedCount:0,updatedCount:1,statusUpdatedCount:0});
  expect((await t.assignments())[0]).toMatchObject({title:'Metadata changed',status:'pending',sourceStatusText:'unattempted',submissionStatus:{state:'submitted',checkedAt:now}});
 });
 it.each([0,99])('preserves duplicate order, counters, and first equal-time status with %i intervening rows',async(fillers)=>{
  const t=await setup();const items=[lesson(1,{title:'First',status:'completed'}),...Array.from({length:fillers},(_,i)=>lesson(i+2)),lesson(1,{title:'Last',status:'unattempted'})];
  expect(await t.run(items)).toMatchObject({insertedCount:fillers+1,updatedCount:1,statusUpdatedCount:fillers+1});
  const rows=await t.assignments();expect(rows).toHaveLength(fillers+1);
  expect(rows.find(row=>row.externalId==='1')).toMatchObject({title:'Last',sourceStatusText:'unattempted',submissionStatus:{state:'submitted',checkedAt:now}});
 });
 it('fences overlapping external IDs by tenant and source connection',async()=>{
  const t=await setup(),bob={userId:'bob'};
  const bobEd=await new D1SourceConnectionRepository(t.db,bob).upsertEd('Bob Ed');
  const canvas=await new D1SourceConnectionRepository(t.db,scope).upsertCanvas('Alice Canvas');
  await new D1AssignmentRepository(t.db,bob).upsertMany(bobEd.id,[saved('1')],before);
  await new D1AssignmentRepository(t.db,scope).upsertMany(canvas.id,[{...saved('1'),source:'canvas'}],before);
  expect(await t.run([lesson(1)])).toMatchObject({insertedCount:1,statusUpdatedCount:1});
  expect(await new D1AssignmentRepository(t.db,bob).list()).toMatchObject([{title:'Previously saved',submissionStatus:null,lastSeenAt:before}]);
  expect(await new D1AssignmentRepository(t.db,scope).list({source:'canvas'})).toMatchObject([{title:'Previously saved',submissionStatus:null,lastSeenAt:before}]);
  await expect(syncEdConnection(t.db,{userId:'unconfigured'},keyring,{fetchImpl:(async()=>{throw new Error('Unexpected provider fetch');}) as typeof fetch})).rejects.toMatchObject({code:'ED_NOT_CONNECTED'});
 });
 it.each(['paused','replaced owner'])('stops subsequent chunks when Ed has a %s after the first committed chunk',async(change)=>{
  const t=await setup();let changed=false;
  measure(t.db,sql=>{if(!changed&&sql.some(query=>query.includes('INSERT INTO assignments('))){
   changed=true;
   t.sqlite.exec(change==='paused'
    ?"UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:ed'"
    :"UPDATE operation_locks SET owner_nonce='replacement-owner' WHERE user_id='alice' AND operation_key='source:ed'");
  }});
  await expect(t.run(Array.from({length:201},(_,i)=>lesson(i+1)))).rejects.toBeDefined();
  expect(changed).toBe(true);const rows=await t.assignments();expect(rows).toHaveLength(100);
  expect(rows.every(row=>row.submissionStatus?.state==='submitted')).toBe(true);
  expect(t.sqlite.prepare('SELECT last_successful_at FROM submission_status_sync WHERE user_id=? AND source_connection_id=?').get(scope.userId,t.connection.id)).toEqual({last_successful_at:null});
 });
 it('rolls back lesson metadata when writing its submission status fails in the same chunk',async()=>{
  const t=await setup();
  t.sqlite.exec("CREATE TRIGGER fail_ed_status BEFORE INSERT ON assignment_submission_status BEGIN SELECT RAISE(ABORT,'Synthetic status write failure'); END");
  await expect(t.run([lesson(1),lesson(2)])).rejects.toThrow('Synthetic status write failure');
  expect(await t.assignments()).toEqual([]);
  expect(t.sqlite.prepare('SELECT count(*) AS n FROM assignment_submission_status').get()).toEqual({n:0});
  expect(t.sqlite.prepare('SELECT last_successful_at FROM submission_status_sync WHERE user_id=? AND source_connection_id=?').get(scope.userId,t.connection.id)).toEqual({last_successful_at:null});
 });
 it('rejects an oversized later row before persisting any earlier lesson metadata',async()=>{
  const t=await setup(),items=[...Array.from({length:100},(_,i)=>lesson(i+1)),lesson(101,{title:'\u754c'.repeat(350_000)})];
  await expect(t.run(items)).rejects.toMatchObject({code:'ED_PARSE_ERROR'});
  expect(await t.assignments()).toEqual([]);
  expect(t.sqlite.prepare('SELECT count(*) AS n FROM assignment_submission_status').get()).toEqual({n:0});
 });
 it.each([
  'missing statement result','failed statement','missing inserted count','fractional inserted count',
  'excessive inserted count','incomplete metadata write','missing status count','fractional status count','excessive status count',
 ])('rejects a malformed persistence result (%s) without writing later chunks or marking success',async(kind)=>{
  const t=await setup(),batch=t.db.batch.bind(t.db);
  vi.spyOn(t.db,'batch').mockImplementation(async statements=>{
   // Execute the real atomic transaction, then emulate a malformed D1 response.
   // An untrustworthy response cannot undo an already committed chunk.
   const result=await batch(statements);
   if(result[0]?.results[0]?.inserted===undefined)return result;
   const malformed:D1ResultLike[]=structuredClone(result);
   switch(kind){
    case 'missing statement result':return malformed.slice(0,2);
    case 'failed statement':malformed[2].success=false;break;
    case 'missing inserted count':malformed[0].results=[];break;
    case 'fractional inserted count':malformed[0].results[0].inserted=0.5;break;
    case 'excessive inserted count':malformed[0].results[0].inserted=101;break;
    case 'incomplete metadata write':malformed[1].meta.changes=99;break;
    case 'missing status count':malformed[2].meta={};break;
    case 'fractional status count':malformed[2].meta.changes=0.5;break;
    case 'excessive status count':malformed[2].meta.changes=101;break;
   }
   return malformed;
  });
  await expect(t.run(Array.from({length:201},(_,i)=>lesson(i+1)))).rejects.toThrow('The Ed result could not be committed.');
  const rows=await t.assignments();expect(rows).toHaveLength(100);
  expect(rows.every(row=>row.submissionStatus?.state==='submitted')).toBe(true);
  expect(t.sqlite.prepare('SELECT last_successful_at FROM submission_status_sync WHERE user_id=? AND source_connection_id=?').get(scope.userId,t.connection.id)).toEqual({last_successful_at:null});
 });
});
