import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {POST as startSession} from '@/app/api/guest/session/route';
import {POST as canvasFeed,GET as canvasGet} from '@/app/api/guest/sources/canvas/feed/route';
import {POST as edCourses,GET as edCoursesGet} from '@/app/api/guest/sources/ed/courses/route';
import {POST as edLessons,GET as edLessonsGet} from '@/app/api/guest/sources/ed/lessons/route';

const bindings=vi.hoisted(()=>({env:{} as Record<string,unknown>}));
vi.mock('cloudflare:workers',()=>bindings);
beforeEach(()=>{vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));});
afterEach(()=>{vi.restoreAllMocks();});
it('anonymous source reads persist only admission metadata',async()=>{
  const database=openD1TestDatabase();
  try{
    const env={DB:database.db,E2E_FIXTURES:'1',KAIROS_GUEST_ENABLED:'true',KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,1).toString('base64url'),KAIROS_TURNSTILE_SITE_KEY:'synthetic-site',KAIROS_TURNSTILE_SECRET_KEY:'synthetic-secret'};
    bindings.env=env;
    const tables=(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'abuse_rate_events' ORDER BY name").all() as {name:string}[]).map(row=>row.name);
    const snapshot=()=>Object.fromEntries(tables.map(name=>[name,database.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
    const beforeProtectedTables=snapshot();
    expect(beforeProtectedTables.users).toEqual([]);expect(beforeProtectedTables.sessions).toEqual([]);
    const requestId='11111111-1111-4111-8111-111111111111';let cookie='';
    const request=(value:unknown)=>new Request(env.KAIROS_APP_URL+'/api/guest/session',{method:'POST',headers:{origin:env.KAIROS_APP_URL,'content-type':'application/json',cookie},body:JSON.stringify(value)});
    const session=await startSession(request({schemaVersion:1,requestId,turnstileToken:'fixture-guest-anonymous'}));
    expect(session.status).toBe(200);cookie=session.headers.get('set-cookie')!.split(';')[0];
    for(const [handler,fields,member] of [
      [canvasFeed,{feedUrl:'https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics'},'assignments'],
      [edCourses,{token:'fixture-guest-ed-token-never-echo'},'courses'],
      [edLessons,{token:'fixture-guest-ed-token-never-echo',courseId:'123'},'lessons'],
    ] as const){
      const response=await handler(request({schemaVersion:1,requestId,...fields}));
      expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
      expect((await response.json())[member].length).toBeGreaterThan(0);
    }
    const foreign=request({schemaVersion:1,requestId,token:'fixture-guest-ed-token-never-echo'});foreign.headers.set('origin','https://foreign.example');
    const foreignOriginResponse=await edCourses(foreign);
    expect(foreignOriginResponse.status).toBe(403);
    for(const handler of [canvasGet,edCoursesGet,edLessonsGet]){
      const response=await handler(new Request(env.KAIROS_APP_URL+'/api/guest/sources'));
      expect(response.status).toBe(400);expect(response.headers.get('cache-control')).toBe('no-store, private');
      expect((await response.json()).code).toBe('BAD_REQUEST');
    }
    const afterProtectedTables=snapshot();expect(afterProtectedTables).toEqual(beforeProtectedTables);
    const admissionRows=database.sqlite.prepare('SELECT * FROM abuse_rate_events').all() as {user_id:string|null;key_hash:string}[];
    expect(admissionRows).toHaveLength(10);expect(admissionRows.every(row=>row.user_id===null)).toBe(true);
    expect(admissionRows.every(row=>/^[A-Za-z0-9_-]{43}$/.test(row.key_hash))).toBe(true);
    expect(JSON.stringify(admissionRows)).not.toMatch(/fixture-guest|kairos-e2e|11111111/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }finally{database.close();}
});
