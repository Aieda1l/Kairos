import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import HomePage from '@/app/page';
import GuestLayout from '@/app/guest/layout';
import {POST as start} from '@/app/api/guest/session/route';
import {POST as end} from '@/app/api/guest/session/end/route';
import {POST as canvas} from '@/app/api/guest/sources/canvas/feed/route';
import {POST as courses} from '@/app/api/guest/sources/ed/courses/route';
import {POST as lessons} from '@/app/api/guest/sources/ed/lessons/route';
import {localGuestFixtureFetch} from '@/lib/testing/guest-transport';
import {resolveGuestServerRuntime} from '@/lib/guest/server/runtime';
import {guestCapabilityCookie,readGuestCapability,mintGuestCapability} from '@/lib/guest/server/capability';
import {openD1TestDatabase} from '../helpers/d1-test-db';

const bindings=vi.hoisted(()=>({env:{} as Record<string,unknown>}));
vi.mock('cloudflare:workers',()=>bindings);
beforeEach(()=>{vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('External network forbidden'));});
afterEach(()=>{vi.restoreAllMocks();bindings.env={};});

// A permissive feature parser or a gate moved after runtime construction breaks these cases.
it.each([undefined,'false','TRUE','1',true])('default/disabled flag %s hides entry and rejects all API work before runtime',async flag=>{
  const db=vi.fn(()=>{throw new Error('Disabled guest reached D1');});
  bindings.env={KAIROS_GUEST_ENABLED:flag,get DB(){return db();}};
  expect(renderToStaticMarkup(await HomePage())).not.toContain('/guest/upcoming');
  await expect(GuestLayout({children:null})).rejects.toMatchObject({digest:'NEXT_HTTP_ERROR_FALLBACK;404'});
  for(const handler of [start,end,canvas,courses,lessons]){
    const response=await handler(new Request('https://guest.invalid/api/guest/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
    expect(response.status).toBe(404);expect((await response.json()).code).toBe('GUEST_DISABLED');
  }
  expect(db).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
});

// Retained local flags must not turn a hosted origin into a synthetic transport or dev-cookie authority.
it('hosted configuration cannot use fixture transport or the loopback cookie namespace',async()=>{
  const database=openD1TestDatabase();
  try{
    const env={DB:database.db,KAIROS_GUEST_ENABLED:'true',KAIROS_APP_URL:'https://guest.invalid',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,7).toString('base64url'),KAIROS_TURNSTILE_SITE_KEY:'synthetic-guest-site',KAIROS_TURNSTILE_SECRET_KEY:'synthetic-guest-secret',E2E_FIXTURES:'1',KAIROS_LOCAL_AUTH:'loopback'};
    expect(localGuestFixtureFetch(env)).toBeUndefined();
    expect(()=>resolveGuestServerRuntime(env)).toThrow();
    const runtime=resolveGuestServerRuntime({...env,E2E_FIXTURES:undefined,KAIROS_LOCAL_AUTH:undefined}),capability=await mintGuestCapability(runtime,Date.now());
    expect(guestCapabilityCookie(runtime,capability.value)).toMatch(/^__Host-kairos-guest-sync=.*; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800$/);
    await expect(readGuestCapability(new Headers({cookie:`kairos-guest-sync-dev=${capability.value}; authjs.session-token=synthetic-account`}),runtime,Date.now())).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }finally{database.close();}
});
