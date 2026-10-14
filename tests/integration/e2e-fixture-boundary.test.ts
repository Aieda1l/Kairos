import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
const worker=vi.hoisted(()=>({env:{} as Record<string,unknown>}));
vi.mock('cloudflare:workers',()=>worker);
vi.mock('@/lib/auth/user-scope',()=>({
 AuthenticationRequiredError:class extends Error{},requireUserScope:vi.fn(),
}));
import {POST,DELETE} from '@/app/api/test-fixtures/session/route';
import {POST as reset} from '@/app/api/test-fixtures/reset/route';
import {POST as tenant} from '@/app/api/test-fixtures/tenant-state/route';
import {POST as dueDate} from '@/app/api/test-fixtures/assignment-due-date/route';
import {POST as calendarMode} from '@/app/api/test-fixtures/calendar-mode/route';
import {GET as calendarState} from '@/app/api/test-fixtures/calendar-state/route';
import {GET as canvasFeed} from '@/app/api/test-fixtures/canvas-feed/route';
import {GET as authTransport} from '@/app/api/test-fixtures/auth-transport/route';
let database:ReturnType<typeof openD1TestDatabase>;
const local={KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback'};
beforeEach(()=>{
 database=openD1TestDatabase();for(const key of Object.keys(worker.env))delete worker.env[key];
 Object.assign(worker.env,local,{DB:database.db,E2E_FIXTURES:'1'});vi.stubEnv('E2E_FIXTURES','');
});
afterEach(()=>{database.close();vi.unstubAllEnvs();});
const request=(origin='http://127.0.0.1:3000',headers:Record<string,string>={})=>POST(new Request(origin+'/api/test-fixtures/session',{
 method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({user:'alice'}),
}));
it.each(['https://mykairos.me','http://mykairos.me','https://m7-preview.account.workers.dev','https://127.0.0.1:3000','http://127.0.0.1:4000'])(
 'rejects a hosted request even with all local fixture bindings retained: %s',async origin=>{
  expect((await request(origin)).status).toBe(404);
  expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({n:0});
 });
it('does not trust Origin or Host headers to turn a hosted request into local execution',async()=>{
 expect((await request('https://mykairos.me',{origin:'http://127.0.0.1:3000',host:'127.0.0.1:3000'})).status).toBe(404);
});
it.each([
 ['DELETE','session',DELETE],['POST','reset',reset],['POST','tenant-state',tenant],
 ['POST','assignment-due-date',dueDate],['POST','calendar-mode',calendarMode],
 ['GET','calendar-state',calendarState],['GET','canvas-feed',canvasFeed],['GET','auth-transport',authTransport],
] as const)('keeps the %s %s fixture unavailable to a hosted request',async(method,route,handler)=>{
 const result=await handler(new Request('https://mykairos.me/api/test-fixtures/'+route,{method}));
 expect(result.status).toBe(404);
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:0});
});
it.each([
 {KAIROS_APP_URL:'https://mykairos.me',KAIROS_LOCAL_AUTH:undefined,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare'},
 {KAIROS_APP_URL:'https://mykairos.me'},
 {KAIROS_LOCAL_AUTH:undefined},
 {KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare'},
 {KAIROS_APP_URL:'https://127.0.0.1:3000'},
])('rejects a retained fixture flag outside isolated local configuration: %j',async overrides=>{
 Object.assign(worker.env,overrides);vi.stubEnv('E2E_FIXTURES','1');
 expect((await request()).status).toBe(404);
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:0});
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({n:0});
});
it('retains explicit local browser fixture sessions from the Worker flag',async()=>{
 expect((await request()).status).toBe(200);
 expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({n:1});
});
it('retains the process flag only when Worker configuration is explicitly local',async()=>{
 delete worker.env.E2E_FIXTURES;vi.stubEnv('E2E_FIXTURES','1');expect((await request()).status).toBe(200);
});
it('does not enable local fixtures without either explicit fixture flag',async()=>{
 delete worker.env.E2E_FIXTURES;expect((await request()).status).toBe(404);
});
