import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
const fixture=vi.hoisted(()=>({runtime:vi.fn(),resetCalendar:vi.fn()}));
vi.mock('@/lib/testing/e2e-runtime',()=>({getAuthenticatedE2EFixtureRuntime:fixture.runtime}));
vi.mock('@/lib/calendar/e2e-fixture-fetch',()=>({resetE2ECalendarFixture:fixture.resetCalendar}));
import {POST} from '@/app/api/test-fixtures/reset/route';
const reset=()=>POST(new Request('http://127.0.0.1:3000/api/test-fixtures/reset',{method:'POST'}));
let test:ReturnType<typeof openD1TestDatabase>;
beforeEach(()=>{
  test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-a'),('synthetic-b')");
  test.sqlite.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run('synthetic-a','time_zone','UTC','2000');
  test.sqlite.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run('synthetic-b','time_zone','Europe/London','2000');
  test.sqlite.prepare('INSERT INTO sync_all_runs VALUES (?,?,?,?)').run('synthetic-a','live-run',9999999999999,'[]');
  test.sqlite.prepare('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)').run('synthetic-event','A'.repeat(43),'synthetic-a',0,100);
  fixture.runtime.mockResolvedValue({db:test.db,userId:'synthetic-a'});fixture.resetCalendar.mockClear();
});
afterEach(()=>test.close());
it.each(['running','uncertain'])('does not erase data or run metadata while a %s owner exists',async state=>{
  test.sqlite.prepare('INSERT INTO operation_locks VALUES (?,?,?,?,?,?,?)').run('synthetic-a','source:canvas','synthetic-owner',state,0,0,0);
  const response=await reset();expect(response.status).toBe(409);expect(await response.json()).toEqual({code:'FIXTURE_WORK_PENDING'});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM app_settings').get()).toEqual({n:2});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_all_runs').get()).toEqual({n:1});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').get()).toEqual({n:1});
  expect(fixture.resetCalendar).not.toHaveBeenCalled();
});
it('resets only the settled actor and retains all run and ownership metadata',async()=>{
  test.sqlite.prepare('INSERT INTO operation_locks VALUES (?,?,?,?,?,?,?)').run('synthetic-a','source:canvas','synthetic-owner','idle',0,0,0);
  expect((await reset()).status).toBe(200);
  expect(test.sqlite.prepare('SELECT user_id FROM app_settings').all()).toEqual([{user_id:'synthetic-b'}]);
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').get()).toEqual({n:0});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_all_runs').get()).toEqual({n:1});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM operation_locks').get()).toEqual({n:1});
});
it('does nothing when fixture access is unavailable',async()=>{
  fixture.runtime.mockResolvedValue(null);expect((await reset()).status).toBe(404);
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM app_settings').get()).toEqual({n:2});
});
