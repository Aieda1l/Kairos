import {expect,it,vi} from 'vitest';
import {createD1MaintenanceClient} from '../../scripts/lib/d1-maintenance-client.mjs';
const env={CLOUDFLARE_API_TOKEN:'synthetic-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_D1_DATABASE_ID:'11111111-1111-1111-1111-111111111111'};
const success=(results:unknown[]=[])=>Response.json({success:true,result:[{success:true,results,meta:{changes:1}}]});
it('uses only the fixed HTTPS API endpoint and never places parameters in the URL',async()=>{
  const request=vi.fn<typeof fetch>(async()=>success([{n:1}]));
  const db=createD1MaintenanceClient(env,{fetch:request});
  expect(await db.prepare('SELECT ? AS n').bind(1).first()).toEqual({n:1});
  const [url,init]=request.mock.calls[0];
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}/query`);
  expect(init).toMatchObject({method:'POST',redirect:'error',cache:'no-store'});
  expect(JSON.parse(init!.body as string)).toEqual({sql:'SELECT ? AS n',params:['1']});
});
it('rejects malformed addressing and missing credentials before any request',()=>{
  const request=vi.fn<typeof fetch>();
  for(const invalid of [{CLOUDFLARE_ACCOUNT_ID:'../private'},{CLOUDFLARE_D1_DATABASE_ID:'private'},{CLOUDFLARE_API_TOKEN:''}]){
    expect(()=>createD1MaintenanceClient({...env,...invalid},{fetch:request})).toThrow('Maintenance unavailable.');
  }
  expect(request).not.toHaveBeenCalled();
});
it('suppresses provider bodies, request errors, SQL and parameters on failure',async()=>{
  for(const request of [async()=>new Response('SYNTHETIC_PRIVATE_BODY',{status:403}),async()=>{throw new Error('SYNTHETIC_PRIVATE_ERROR');},async()=>Response.json({success:false,errors:[{message:'SYNTHETIC_PRIVATE_ERROR'}]})]){
    const db=createD1MaintenanceClient(env,{fetch:request as typeof fetch});
    await expect(db.prepare('SELECT ?').bind('SYNTHETIC_PRIVATE_PARAM').all()).rejects.toThrow(/^Maintenance unavailable\.$/);
  }
});
it('bounds fetch and body reads even when a mock ignores abort',async()=>{
  for(const request of [async()=>new Promise<Response>(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]){
    const db=createD1MaintenanceClient(env,{fetch:request as typeof fetch,timeoutMs:20});
    await expect(db.prepare('SELECT 1').all()).rejects.toThrow('Maintenance unavailable.');
  }
});
it('rejects oversized and malformed result sets',async()=>{
  for(const response of [new Response('x'.repeat(257)),Response.json({success:true,result:[]}),Response.json({success:true,result:[{success:true,results:{},meta:{}}]})]){
    const db=createD1MaintenanceClient(env,{fetch:async()=>response,maxResponseBytes:256});
    await expect(db.prepare('SELECT 1').all()).rejects.toThrow('Maintenance unavailable.');
  }
});
it('uses the documented batch body and rejects statements from another client',async()=>{
  const request=vi.fn<typeof fetch>(async()=>Response.json({success:true,result:[{success:true,results:[],meta:{changes:1}},{success:true,results:[],meta:{changes:1}}]}));
  const db=createD1MaintenanceClient(env,{fetch:request});
  expect(await db.batch([db.prepare('SELECT ?').bind('synthetic'),db.prepare('SELECT 2')])).toHaveLength(2);
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({batch:[{sql:'SELECT ?',params:['synthetic']},{sql:'SELECT 2',params:[]}]});
  await expect(db.batch([createD1MaintenanceClient(env).prepare('SELECT 1')])).rejects.toThrow('Maintenance unavailable.');
});
