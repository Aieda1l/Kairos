import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
const fixture=vi.hoisted(()=>({runtime:vi.fn()}));
vi.mock('@/lib/testing/e2e-runtime',()=>({getE2EFixtureRuntime:fixture.runtime}));
import {POST} from '@/app/api/test-fixtures/session/route';
let test:ReturnType<typeof openD1TestDatabase>;
beforeEach(()=>{test=openD1TestDatabase();fixture.runtime.mockResolvedValue({db:test.db});});
afterEach(()=>test.close());
const signIn=(user:string,isolationKey?:string)=>POST(new Request('http://127.0.0.1:3000/api/test-fixtures/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user,...(isolationKey?{isolationKey}:{})})}));
it('isolates browser cases while repeated sign-in retains the same actor and data',async()=>{
  const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const a=await signIn('alice',first);expect(a.status).toBe(200);const actor=(await a.json()).user.id;
  test.sqlite.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run(actor,'time_zone','UTC','2000');
  const b=await signIn('alice',second);expect(b.status).toBe(200);expect((await b.json()).user.id).not.toBe(actor);
  const again=await signIn('alice',first);expect(again.status).toBe(200);expect((await again.json()).user.id).toBe(actor);
  expect(test.sqlite.prepare('SELECT value FROM app_settings WHERE user_id=?').get(actor)).toEqual({value:'UTC'});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:2});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({n:2});
});
it('keeps the established legacy fixture interface and rejects malformed namespaces',async()=>{
  const response=await signIn('bob');expect(response.status).toBe(200);expect((await response.json()).user.id).toBe('bob');
  expect((await signIn('alice','not-a-uuid')).status).toBe(400);
});
it('does not issue a session outside the fixture environment',async()=>{
  fixture.runtime.mockResolvedValue(null);expect((await signIn('alice')).status).toBe(404);
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:0});
});
