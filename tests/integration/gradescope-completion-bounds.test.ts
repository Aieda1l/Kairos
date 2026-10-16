import {afterEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {D1SourceCourseRepository} from '@/lib/db/d1/repositories/source-courses';
import {D1AssignmentRepository} from '@/lib/db/d1/repositories/assignments';
import {startGradescopeSync,completeGradescopeSync} from '@/lib/gradescope/sync-service';
import type {D1DatabaseLike,D1PreparedStatementLike} from '@/lib/db/d1/types';
afterEach(()=>vi.restoreAllMocks());
it.each([21,101])('completes three courses and %i statuses within a bounded D1 request budget',async count=>{
  const test=openD1TestDatabase();
  try{
    test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run('bounded-user');
    const scope={userId:'bounded-user'},at=new Date().toISOString();
    const connection=await new D1SourceConnectionRepository(test.db,scope).upsertGradescope('Synthetic');
    const courseRepo=new D1SourceCourseRepository(test.db,scope);
    await courseRepo.upsertDiscovered(connection.id,['123','456','789'].map(externalCourseId=>({externalCourseId,shortName:null,fullName:'Synthetic',term:null,year:null})),at);
    await courseRepo.setEnabled(connection.id,['123','456','789']);
    let calls=0;const native=new WeakMap<D1PreparedStatementLike,D1PreparedStatementLike>();
    const tick=()=>{if(++calls>50)throw new Error('Synthetic per-invocation D1 budget exceeded');};
    const wrap=(statement:D1PreparedStatementLike):D1PreparedStatementLike=>{
      const result:D1PreparedStatementLike={bind:(...values)=>wrap(statement.bind(...values)),first:async()=>{tick();return statement.first();},all:async()=>{tick();return statement.all();},run:async()=>{tick();return statement.run();}};
      native.set(result,statement);return result;
    };
    const db:D1DatabaseLike={prepare:sql=>wrap(test.db.prepare(sql)),batch:async statements=>{tick();return test.db.batch(statements.map(s=>native.get(s)!));},exec:async sql=>{tick();return test.db.exec(sql);}};
    installProviderRuntime(db);
    const started=await startGradescopeSync(db,scope);
    const perCourse=Math.ceil(count/3);
    const courses=['123','456','789'].map((courseId,index)=>({courseId,checkedAt:at,errorCode:null,parseDiagnosticCounts:[],assignments:Array.from({length:Math.min(perCourse,count-index*perCourse)},(_,j)=>({courseId,assignmentId:String(1000+index*perCourse+j),title:'Synthetic',releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:'Submitted25 Minutes Late',state:'unknown' as const,isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,gradeDisplay:null,checkedAt:at,extractorVersion:'gradescope-html-v1'}))}));
    calls=0;
    const result=await completeGradescopeSync(db,scope,{requestId:started.requestId,batches:[{protocolVersion:1,requestId:started.requestId,courses,errorCode:null}]});
    expect(result).toMatchObject({insertedCount:count,statusUpdatedCount:count,lastErrorCode:null});
    expect(calls).toBeLessThanOrEqual(35);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks WHERE user_id='bounded-user' AND operation_key='source:gradescope'").get()).toEqual({state:'idle'});
    expect(test.sqlite.prepare("SELECT COUNT(*) AS n FROM assignment_submission_status WHERE state='submitted' AND is_late=1").get()).toEqual({n:count});
  }finally{test.close();}
});

it('rolls back assignment metadata when its status batch fails',async()=>{
  const test=openD1TestDatabase();
  try{
    const scope={userId:'rollback-user'},at=new Date().toISOString();
    test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);installProviderRuntime(test.db);
    const connection=await new D1SourceConnectionRepository(test.db,scope).upsertGradescope('Synthetic');
    const courses=new D1SourceCourseRepository(test.db,scope);
    await courses.upsertDiscovered(connection.id,[{externalCourseId:'123',shortName:null,fullName:'Synthetic',term:null,year:null}],at);
    await courses.setEnabled(connection.id,['123']);
    await new D1AssignmentRepository(test.db,scope).upsertMany(connection.id,[{source:'gradescope',externalId:'1000',courseId:'123',courseName:'Synthetic',title:'Original title',releaseAt:null,dueAt:null,lateDueAt:null,status:'unknown',sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}],at);
    const started=await startGradescopeSync(test.db,scope);
    test.sqlite.exec("CREATE TRIGGER fail_status BEFORE INSERT ON assignment_submission_status BEGIN SELECT RAISE(ABORT,'Synthetic status write rejection'); END");
    await expect(completeGradescopeSync(test.db,scope,{requestId:started.requestId,batches:[{protocolVersion:1,requestId:started.requestId,errorCode:null,courses:[{courseId:'123',checkedAt:at,errorCode:null,parseDiagnosticCounts:[],assignments:[{
      courseId:'123',assignmentId:'1000',title:'Replacement title',releaseAt:null,dueAt:null,lateDueAt:null,sourceStatusText:'Submitted',state:'submitted',isLate:false,isMissing:false,submittedAt:null,gradeScore:null,gradeMax:null,gradeDisplay:null,checkedAt:at,extractorVersion:'synthetic',
    }]}]}]})).rejects.toThrow('Synthetic status write rejection');
    expect(test.sqlite.prepare('SELECT title FROM assignments').all()).toEqual([{title:'Original title'}]);
    expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM assignment_submission_status').get()).toEqual({n:0});
    expect(test.sqlite.prepare("SELECT state FROM operation_locks WHERE user_id='rollback-user'").get()).toEqual({state:'idle'});
  }finally{test.close();}
});
