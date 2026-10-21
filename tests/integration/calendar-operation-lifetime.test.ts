import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {withOwnedOperation} from '@/lib/abuse/operation-lock';
import {openD1TestDatabase} from '../helpers/d1-test-db';

const lifetime=vi.hoisted(()=>({tasks:[] as Promise<unknown>[]}));
vi.mock('cloudflare:workers',()=>({waitUntil:(task:Promise<unknown>)=>lifetime.tasks.push(task)}));
const databases:ReturnType<typeof openD1TestDatabase>[]=[];
const scope={userId:'calendar-lifetime-user'};
function open(){const test=openD1TestDatabase();databases.push(test);test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);return test;}
function barrier(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{lifetime.tasks=[];});
afterEach(()=>{for(const test of databases.splice(0))test.close();});

it('retains the complete calendar operation and lock settlement when its caller stops waiting',async()=>{
  const {db,sqlite}=open();
  const started=barrier(),resume=barrier();
  const pending=withOwnedOperation(db,scope,'calendar:microsoft',async()=>{started.resolve();await resume.promise;return 'settled';});
  await started.promise;
  expect(lifetime.tasks).toHaveLength(1);
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'running'});
  await expect(withOwnedOperation(db,scope,'calendar:microsoft',async()=>{})).rejects.toMatchObject({code:'SYNC_IN_PROGRESS'});
  resume.resolve();
  await Promise.all(lifetime.tasks);
  expect(await pending).toBe('settled');
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});

it('preserves the caller error while settling the retained task and durable owner',async()=>{
  const {db,sqlite}=open();
  await expect(withOwnedOperation(db,scope,'calendar:google',async()=>{throw new Error('synthetic provider failure');})).rejects.toThrow('synthetic provider failure');
  expect(lifetime.tasks).toHaveLength(1);
  await expect(Promise.all(lifetime.tasks)).resolves.toBeDefined();
  expect(sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});
