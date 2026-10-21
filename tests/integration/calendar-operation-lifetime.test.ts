import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {acquireOperation,runWithOperationOwnership,withBridgeCompletion,withOwnedOperation,type OperationKey} from '@/lib/abuse/operation-lock';
import {withProviderService} from '@/lib/abuse/provider-operation';
import {D1SyncRequestRepository} from '@/lib/db/d1/repositories/sync-requests';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {openD1TestDatabase} from '../helpers/d1-test-db';

const lifetime=vi.hoisted(()=>({tasks:[] as Promise<unknown>[]}));
vi.mock('cloudflare:workers',()=>({waitUntil:(task:Promise<unknown>)=>lifetime.tasks.push(task)}));
const databases:ReturnType<typeof openD1TestDatabase>[]=[];
const scope={userId:'calendar-lifetime-user'};
function open(){const test=openD1TestDatabase();databases.push(test);test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);installProviderRuntime(test.db);return test;}
function barrier(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{lifetime.tasks=[];});
afterEach(()=>{vi.restoreAllMocks();for(const test of databases.splice(0))test.close();});
const operationKeys:OperationKey[]=['calendar:google','calendar:microsoft','calendar:caldav','source:canvas','source:ed','source:gradescope'];

it.each(operationKeys)('retains the complete %s operation and lock settlement when its caller stops waiting',async key=>{
  const {db,sqlite}=open();
  const started=barrier(),resume=barrier();
  const pending=withOwnedOperation(db,scope,key,async()=>{started.resolve();await resume.promise;return 'settled';});
  await started.promise;
  expect(lifetime.tasks).toHaveLength(1);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'running'});
  await expect(withOwnedOperation(db,scope,key,async()=>{})).rejects.toMatchObject({code:'SYNC_IN_PROGRESS'});
  resume.resolve();
  await Promise.all(lifetime.tasks);
  expect(await pending).toBe('settled');
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});

it.each(operationKeys)('preserves the %s caller error while settling the retained task and durable owner',async key=>{
  const {db,sqlite}=open();
  await expect(withOwnedOperation(db,scope,key,async()=>{throw new Error('synthetic provider failure');})).rejects.toThrow('synthetic provider failure');
  expect(lifetime.tasks).toHaveLength(1);
  await expect(Promise.all(lifetime.tasks)).resolves.toBeDefined();
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});

it('retains source work entered through an issued ownership handle',async()=>{
  const {db,sqlite}=open(),started=barrier(),resume=barrier();
  const lock=await acquireOperation({db} as Parameters<typeof acquireOperation>[0],scope,'source:ed');
  const pending=runWithOperationOwnership(lock,async()=>{started.resolve();await resume.promise;});
  await started.promise;expect(lifetime.tasks).toHaveLength(1);
  resume.resolve();await pending;await Promise.all(lifetime.tasks);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});

it('retains bridge completion and releases only after the one-use request is claimed and work settles',async()=>{
  const {db,sqlite}=open(),requestId=crypto.randomUUID(),now=new Date();
  const repo=new D1SyncRequestRepository(db,scope);
  await withProviderService(db,scope,{provider:'gradescope',operation:'credential'},()=>repo.register({requestId,kind:'gradescope_sync',payload:{},createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()}));
  await Promise.all(lifetime.tasks);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'running'});
  lifetime.tasks=[];const started=barrier(),resume=barrier();
  const pending=withBridgeCompletion(db,scope,requestId,'gradescope_sync',now,async()=>{await repo.consume(requestId,'gradescope_sync',now);started.resolve();await resume.promise;return 'settled';});
  await started.promise;expect(lifetime.tasks).toHaveLength(1);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'running'});
  resume.resolve();expect(await pending).toBe('settled');await Promise.all(lifetime.tasks);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
  await expect(withBridgeCompletion(db,scope,requestId,'gradescope_sync',now,async()=>{})).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});
});
