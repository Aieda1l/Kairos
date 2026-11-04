import {afterEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {createGuestSessionHandlers} from '@/lib/guest/server/session';
import {resolveGuestServerRuntime} from '@/lib/guest/server/runtime';
import {verifyGuestCapability} from '@/lib/guest/server/capability';
import {guestApiErrorSchema,guestSessionResponseSchema} from '@/lib/guest/sources/contracts';

const databases:ReturnType<typeof openD1TestDatabase>[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();vi.useRealTimers();});
const origin='https://kairos.example',requestId='11111111-1111-4111-8111-111111111111';
const body={schemaVersion:1,requestId,turnstileToken:'synthetic-proof'};
function request(value:unknown=body,headers:Record<string,string>={}){
  return new Request(origin+'/api/guest/session',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.8',...headers},body:JSON.stringify(value)});
}
function setup(){
  const database=openD1TestDatabase();databases.push(database);
  const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({success:true,hostname:'kairos.example',action:'guest_sync'}));
  const runtime=resolveGuestServerRuntime({DB:database.db,KAIROS_GUEST_ENABLED:'true',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,1).toString('base64url'),KAIROS_APP_URL:origin,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_TURNSTILE_SITE_KEY:'site-key',KAIROS_TURNSTILE_SECRET_KEY:'secret-key'},fetchImpl);
  const getRuntime=vi.fn(async()=>runtime);
  return {...database,runtime,fetchImpl,getRuntime,handlers:createGuestSessionHandlers({isEnabled:async()=>true,getRuntime})};
}
async function error(response:Response,status:number,code:string){
  expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('no-store, private');
  const result=await response.json();expect(guestApiErrorSchema.safeParse(result).success).toBe(true);expect(result.code).toBe(code);
  expect(response.headers.get('set-cookie')).toBeNull();
}
describe('guest session API',()=>{
  it('bootstraps with exact guest proof and fresh post-verification time, returning no token',async()=>{
    const {handlers,runtime,sqlite,fetchImpl}=setup();let now=1_800_000_000_000;runtime.now=()=>now;
    fetchImpl.mockImplementation(async()=>{now+=500;return Response.json({success:true,hostname:'kairos.example',action:'guest_sync'});});
    const response=await handlers.start(request());expect(response.status).toBe(200);
    const result=await response.json();expect(guestSessionResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual({ok:true,schemaVersion:1,requestId,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+1_800_000).toISOString()});
    const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('__Host-kairos-guest-sync=');
    const value=cookie.split(';')[0].split('=')[1];expect(JSON.stringify(result)).not.toContain(value);
    expect((await verifyGuestCapability(value,runtime,now)).iatMs).toBe(now);
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events WHERE user_id IS NULL').get()).toEqual({n:1});
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });
  it('rejects disabled entry before runtime validation and D1',async()=>{
    const getRuntime=vi.fn(async()=>{throw new Error('private config');});
    const handlers=createGuestSessionHandlers({isEnabled:async()=>false,getRuntime});
    await error(await handlers.start(request()),404,'GUEST_DISABLED');await error(await handlers.end(request({})),404,'GUEST_DISABLED');
    expect(getRuntime).not.toHaveBeenCalled();
  });
  it.each([undefined,'https://other.example','https://kairos.example/'])('requires exact Origin %s before proof or charge',async originValue=>{
    const {handlers,fetchImpl,sqlite}=setup();const req=request();if(originValue===undefined)req.headers.delete('origin');else req.headers.set('origin',originValue);
    await error(await handlers.start(req),403,'UNTRUSTED_ORIGIN');expect(fetchImpl).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events').get()).toEqual({n:0});
  });
  it.each([{...body,extra:true},{...body,schemaVersion:2},{...body,requestId:'bad'},{...body,turnstileToken:''}])('rejects strict bootstrap body %j',async value=>{
    const {handlers,fetchImpl}=setup();await error(await handlers.start(request(value)),400,'BAD_REQUEST');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('enforces content type, streamed byte size and fatal UTF-8 without trusting Content-Length',async()=>{
    const {handlers,fetchImpl}=setup();await error(await handlers.start(request(body,{'content-type':'text/plain'})),415,'UNSUPPORTED_MEDIA_TYPE');
    for(const bytes of [new TextEncoder().encode(' '.repeat(16_385)),new Uint8Array([0xff]),new TextEncoder().encode('{')]){
      const req=new Request(origin+'/api/guest/session',{method:'POST',headers:{origin,'content-type':'application/json','content-length':'1','cf-connecting-ip':'203.0.113.8'},body:bytes});
      await error(await handlers.start(req),400,'BAD_REQUEST');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('aborts stalled request streams without waiting on cancellation',async()=>{
    vi.useFakeTimers();const {handlers}=setup();
    const req=new Request(origin+'/api/guest/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})}),duplex:'half'} as RequestInit);
    const pending=handlers.start(req);await vi.advanceTimersByTimeAsync(15_001);await error(await pending,400,'BAD_REQUEST');
  });
  it('rejects auth proof and maps verifier failures to fixed guest errors',async()=>{
    const {handlers,fetchImpl}=setup();fetchImpl.mockResolvedValueOnce(Response.json({success:true,hostname:'kairos.example',action:'auth_sign_in'}));
    await error(await handlers.start(request()),403,'GUEST_CHALLENGE_FAILED');
    fetchImpl.mockRejectedValueOnce(new Error('secret upstream body'));await error(await handlers.start(request()),503,'GUEST_CHALLENGE_UNAVAILABLE');
    const before=fetchImpl.mock.calls.length;await error(await handlers.start(request({...body,turnstileToken:'x'.repeat(2049)})),403,'GUEST_CHALLENGE_FAILED');expect(fetchImpl.mock.calls).toHaveLength(before);
  });
  it('never verifies a proof after admission denial or storage failure',async()=>{
    const {handlers,fetchImpl,sqlite}=setup();for(let i=0;i<10;i++)expect((await handlers.start(request())).status).toBe(200);
    fetchImpl.mockClear();const denied=await handlers.start(request());expect(denied.headers.get('retry-after')).toMatch(/^\d+$/);await error(denied,429,'RATE_LIMITED');expect(fetchImpl).not.toHaveBeenCalled();
    sqlite.exec('DROP TABLE abuse_rate_events');await error(await handlers.start(request()),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects Worker ingress and missing trusted addresses without proof calls',async()=>{
    const {handlers,fetchImpl}=setup();await error(await handlers.start(request(body,{'cf-worker':'untrusted'})),503,'SERVICE_UNAVAILABLE');
    const req=request();req.headers.delete('cf-connecting-ip');await error(await handlers.start(req),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('session end accepts only empty JSON/exact origin, clears only the guest cookie and retains rates',async()=>{
    const {handlers,sqlite,fetchImpl}=setup();await handlers.start(request());fetchImpl.mockClear();
    await error(await handlers.end(request({extra:true})),400,'BAD_REQUEST');
    await error(await handlers.end(request({},{origin:'https://other.example'})),403,'UNTRUSTED_ORIGIN');
    const response=await handlers.end(request({},{cookie:'authjs.session-token=hosted'}));expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBe('__Host-kairos-guest-sync=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    expect(response.headers.get('cache-control')).toBe('no-store, private');expect(await response.json()).toEqual({ok:true});
    expect(sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events').get()).toEqual({n:1});expect(fetchImpl).not.toHaveBeenCalled();
  });
});
