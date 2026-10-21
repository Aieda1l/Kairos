import {afterEach,expect,it,vi} from 'vitest';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {checkServiceHealth} from '@/lib/operations/health';
const bindings=vi.hoisted(()=>({DB:undefined as D1DatabaseLike|undefined}));
vi.mock('cloudflare:workers',()=>({env:bindings}));
vi.mock('@/lib/platform/source-runtime',()=>({getSourceRuntimeContext:()=>{throw new Error('Health must never load auth or credentials.');}}));
import {GET} from '@/app/api/health/route';
import {checkProductionHealth} from '../../scripts/check-production-health.mjs';
function database(first:()=>Promise<unknown>){
  const prepare=vi.fn(()=>({first,bind:vi.fn(),all:vi.fn(),run:vi.fn()}));
  const db={prepare,batch:vi.fn(),exec:vi.fn()} as unknown as D1DatabaseLike;
  return {db,prepare};
}
afterEach(()=>{bindings.DB=undefined;vi.useRealTimers();});
it('health_never_queries_user_tables_or_auth',async()=>{
  const {db,prepare}=database(async()=>({ok:1}));bindings.DB=db;
  const response=await GET();
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'ok'});
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(prepare).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS ok');
  expect(db.batch).not.toHaveBeenCalled();expect(db.exec).not.toHaveBeenCalled();
});
it('health_failure_returns_only_service_status',async()=>{
  bindings.DB=database(async()=>{throw new Error('D1_ERROR: SYNTHETIC_PRIVATE_database');}).db;
  const response=await GET();expect(response.status).toBe(503);
  expect(await response.json()).toEqual({status:'unavailable'});
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('uses a three second deadline without claiming to cancel the D1 query',async()=>{
  vi.useFakeTimers();let release!:(value:unknown)=>void;
  const {db}=database(()=>new Promise(resolve=>{release=resolve;}));
  const pending=checkServiceHealth(db).then(value=>value,()=> 'rejected');await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe('unavailable');
  release({ok:1});await vi.advanceTimersByTimeAsync(0);
});
it('an unavailable binding reveals no configuration identifiers',async()=>{
  expect(await (await GET()).json()).toEqual({status:'unavailable'});
});
it('synthetic_rejects_redirect_or_unexpected_payload',async()=>{
  const redirect=vi.fn<typeof fetch>(async()=>new Response(null,{status:302,headers:{location:'https://synthetic.invalid/private'}}));
  expect((await checkProductionHealth({fetchImpl:redirect})).ok).toBe(false);
  expect(redirect).toHaveBeenCalledWith('https://mykairos.me/api/health',expect.objectContaining({redirect:'error'}));
  for(const body of [{status:'ok',private:'SYNTHETIC_PRIVATE_body'},{status:'unavailable'},['ok'],'not-json']){
    const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(typeof body==='string'?body:JSON.stringify(body)));
    expect((await checkProductionHealth({fetchImpl})).ok).toBe(false);
  }
});
it('synthetic accepts only the canonical origin and its exact healthy payload',async()=>{
  const fetchImpl=vi.fn<typeof fetch>(async()=>Response.json({status:'ok'}));
  for(const origin of ['https://synthetic.invalid','http://mykairos.me','https://mykairos.me/path','https://mykairos.me/?private=synthetic']){
    expect((await checkProductionHealth({origin,fetchImpl})).ok).toBe(false);
  }
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(await checkProductionHealth({fetchImpl})).toEqual({ok:true,code:'HEALTH_OK',status:200});
});
it('identifies the health monitor so edge filtering does not challenge the default Node agent',async()=>{
  const fetchImpl=vi.fn<typeof fetch>(async(_url,init)=>{
    const headers=new Headers(init?.headers);
    return headers.get('user-agent')==='Kairos-Health/1.0 (+https://mykairos.me)'
      ?Response.json({status:'ok'})
      :new Response('challenge',{status:403});
  });
  expect(await checkProductionHealth({fetchImpl})).toEqual({ok:true,code:'HEALTH_OK',status:200});
});
it('synthetic bounds response size and the complete request deadline',async()=>{
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('x'.repeat(257)));
  expect((await checkProductionHealth({fetchImpl})).ok).toBe(false);
  const stalled=vi.fn<typeof fetch>(()=>new Promise(()=>{}));
  expect(await checkProductionHealth({fetchImpl:stalled,timeoutMs:1})).toEqual({ok:false,code:'HEALTH_TIMEOUT',status:0});
});
it('rechecks a transient Cloudflare challenge once before validating real storage health',async()=>{
  const cancel=vi.fn();
  const challenge=new Response(new ReadableStream({cancel}),{status:403,headers:{'cf-mitigated':'challenge'}});
  const fetchImpl=vi.fn<typeof fetch>()
    .mockResolvedValueOnce(challenge)
    .mockResolvedValueOnce(Response.json({status:'ok'}));
  expect(await checkProductionHealth({fetchImpl})).toEqual({ok:true,code:'HEALTH_OK',status:200});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchImpl.mock.calls[1]).toEqual(fetchImpl.mock.calls[0]);
});
it('fails after a second Cloudflare challenge without reading challenge content',async()=>{
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('challenge',{status:403,headers:{'cf-mitigated':'challenge'}}));
  expect(await checkProductionHealth({fetchImpl})).toEqual({ok:false,code:'HEALTH_CHECK_FAILED',status:403});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it.each([403,429,503])('does not retry ordinary HTTP %s failures',async status=>{
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('unavailable',{status}));
  expect(await checkProductionHealth({fetchImpl})).toEqual({ok:false,code:'HEALTH_CHECK_FAILED',status});
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it('retains payload validation and the total deadline on the challenge recheck',async()=>{
  const challenge=()=>new Response(null,{status:403,headers:{'cf-mitigated':'challenge'}});
  const invalid=vi.fn<typeof fetch>().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(Response.json({status:'unavailable'}));
  expect(await checkProductionHealth({fetchImpl:invalid})).toEqual({ok:false,code:'HEALTH_PAYLOAD_INVALID',status:200});
  const stalled=vi.fn<typeof fetch>().mockResolvedValueOnce(challenge()).mockImplementationOnce(()=>new Promise(()=>{}));
  expect(await checkProductionHealth({fetchImpl:stalled,timeoutMs:10})).toEqual({ok:false,code:'HEALTH_TIMEOUT',status:0});
  expect(stalled).toHaveBeenCalledTimes(2);
});
