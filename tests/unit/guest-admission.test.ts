import {afterEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {defaultGuestPolicy,enforceGuestReadAdmission,enforceGuestBootstrapAdmission,guestRateKeyParts} from '@/lib/guest/server/policy';
import {resolveGuestServerRuntime} from '@/lib/guest/server/runtime';
import {guestRequestNetwork} from '@/lib/guest/server/request';
import {hashRateKey} from '@/lib/abuse/keys';

const databases:ReturnType<typeof openD1TestDatabase>[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function setup(){
  const database=openD1TestDatabase();databases.push(database);
  const fetchImpl=vi.fn<typeof fetch>();
  const env={DB:database.db,KAIROS_GUEST_ENABLED:'true',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,1).toString('base64url'),KAIROS_APP_URL:'https://kairos.example',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_TURNSTILE_SITE_KEY:'site-key',KAIROS_TURNSTILE_SECRET_KEY:'secret-key'};
  return {...database,env,runtime:resolveGuestServerRuntime(env,fetchImpl),fetchImpl};
}
const network='ipv4:203.0.113.8',sessionId=Buffer.alloc(32,7).toString('base64url');
describe('anonymous guest admission',()=>{
  it('resolves only literal true, fixed independent budgets, and no account configuration',()=>{
    const {env,runtime}=setup();
    expect(runtime.guestEnabled).toBe(true);
    expect(defaultGuestPolicy()).toEqual({bootstrapNetwork:{limit:10,windowSeconds:600},readNetwork:{limit:60,windowSeconds:600},readSession:{limit:30,windowSeconds:600},readGlobal:{limit:60,windowSeconds:600}});
    expect(resolveGuestServerRuntime({...env,KAIROS_GUEST_ENABLED:'TRUE'}).guestEnabled).toBe(false);
    expect(runtime.fetchImpl).toBeTypeOf('function');
    expect(runtime.policy?.['auth-initiation']).toBeDefined();
  });
  it('charges bootstrap ten times then denies without invented users or fetch',async()=>{
    const {runtime,sqlite,fetchImpl}=setup();
    for(let i=0;i<10;i++)await enforceGuestBootstrapAdmission(runtime,network);
    await expect(enforceGuestBootstrapAdmission(runtime,network)).rejects.toMatchObject({code:'RATE_LIMITED'});
    expect(sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events WHERE user_id IS NULL').get()).toEqual({n:10});
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({n:0});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['network','session','global'] as const)('denies %s in order and retains earlier charges',async denied=>{
    const {runtime,sqlite}=setup();
    runtime.guestPolicy={bootstrapNetwork:{limit:10,windowSeconds:600},readNetwork:{limit:denied==='network'?1:10,windowSeconds:600},readSession:{limit:denied==='session'?1:10,windowSeconds:600},readGlobal:{limit:denied==='global'?1:10,windowSeconds:600}};
    await enforceGuestReadAdmission(runtime,{network,sessionId});
    const upstreamAfterDenial=vi.fn();
    await expect(enforceGuestReadAdmission(runtime,{network,sessionId}).then(upstreamAfterDenial)).rejects.toMatchObject({code:'RATE_LIMITED'});
    expect(upstreamAfterDenial).toHaveBeenCalledTimes(0);
    const count=async(subject:Parameters<typeof guestRateKeyParts>[0])=>sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events WHERE key_hash=?').get(await hashRateKey(runtime.hmacKey,guestRateKeyParts(subject)));
    expect(await count({class:'read-network',network})).toEqual({n:denied==='network'?1:2});
    expect(await count({class:'read-session',sessionId})).toEqual({n:denied==='global'?2:1});
    expect(await count({class:'read-global'})).toEqual({n:1});
    expect(sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events WHERE user_id IS NOT NULL').get()).toEqual({n:0});
  });
  it('fails closed on storage failure before upstream work',async()=>{
    const {runtime,sqlite}=setup();sqlite.exec('DROP TABLE abuse_rate_events');
    const upstreamAfterDenial=vi.fn();
    await expect(enforceGuestReadAdmission(runtime,{network,sessionId}).then(upstreamAfterDenial)).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
    expect(upstreamAfterDenial).toHaveBeenCalledTimes(0);
  });
  it('validates internal subjects and separates guest classes from account keys',()=>{
    expect(guestRateKeyParts({class:'read-network',network})).toEqual(['guest','read-network',network]);
    expect(()=>guestRateKeyParts({class:'read-network',network:'203.0.113.8'})).toThrow();
    expect(()=>guestRateKeyParts({class:'read-session',sessionId:'browser-selected'})).toThrow();
  });
  it('uses only trusted ingress, rejects Worker forwarding and selects loopback identity on the server',()=>{
    const {runtime}=setup();
    const headers=new Headers({'cf-connecting-ip':'203.0.113.8','x-forwarded-for':'198.51.100.1'});
    expect(guestRequestNetwork(headers,runtime)).toBe(network);
    headers.set('cf-worker','');expect(()=>guestRequestNetwork(headers,runtime)).toThrow();headers.delete('cf-worker');
    expect(()=>guestRequestNetwork(headers,{...runtime,trustedIngress:'none'})).toThrow();
    expect(guestRequestNetwork(headers,{...runtime,trustedIngress:'loopback',appOrigin:'http://localhost:3000'})).toBe('ipv4:127.0.0.1');
    expect(()=>guestRequestNetwork(headers,{...runtime,trustedIngress:'loopback'})).toThrow();
  });
});
