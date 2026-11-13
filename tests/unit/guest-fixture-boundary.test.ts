import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {localGuestFixtureFetch} from '@/lib/testing/guest-transport';
import {localAuthFixtureFetch} from '@/lib/testing/auth-transport';
import {verifyTurnstile} from '@/lib/auth/turnstile';
import {getGuestServerRuntime} from '@/lib/guest/server/runtime';
import {execFileSync} from 'node:child_process';

const bindings=vi.hoisted(()=>({env:{} as Record<string,unknown>}));
vi.mock('cloudflare:workers',()=>bindings);
beforeEach(()=>{vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));});
afterEach(()=>{vi.restoreAllMocks();});
const local={E2E_FIXTURES:'1',KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback'};
it('measures the portable client parser without provider requests',()=>{
  const report=JSON.parse(execFileSync(process.execPath,['scripts/measure-guest-source-parsers.mjs'],{encoding:'utf8',timeout:120000}));
  expect(report.evidenceType).toBe('node-simulated-client-process-cpu');
  expect(report.externalRequests).toBe(0);
  expect(report.results).toHaveLength(4);
  expect(report.results.every((row:{ok:boolean})=>row.ok)).toBe(true);
},120000);
it('requires the complete explicit local gate and exact canonical origin',()=>{
  expect(localGuestFixtureFetch({...local})).toBeTypeOf('function');
  expect(localGuestFixtureFetch({...local,KAIROS_APP_URL:'http://localhost:3000'})).toBeTypeOf('function');
  for(const env of [
    {...local,E2E_FIXTURES:undefined},{...local,E2E_FIXTURES:'true'},{...local,KAIROS_LOCAL_AUTH:undefined},
    {...local,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare'},
    ...['https://kairos.example','https://127.0.0.1:3000','http://127.0.0.1:3000/','http://localhost:3000/path','http://localhost.evil:3000','http://[::1]:3000'].map(KAIROS_APP_URL=>({...local,KAIROS_APP_URL})),
  ])expect(localGuestFixtureFetch(env)).toBeUndefined();
});
it('uses guest_sync proof, rejects replay across transport lookups, and preserves auth proof isolation',async()=>{
  const env={...local};const transport=localGuestFixtureFetch(env)!;expect(transport).toBeTypeOf('function');
  const verify=(token:string,fetchImpl=transport,expectedAction='guest_sync')=>verifyTurnstile({token,expectedAction,expectedHostname:'127.0.0.1'},{secret:'synthetic-secret',fetchImpl});
  await expect(verify('fixture-guest-once')).resolves.toBeUndefined();
  await expect(verify('fixture-guest-once',localGuestFixtureFetch(env)!)).rejects.toMatchObject({code:'AUTH_CHALLENGE_FAILED'});
  for(const token of ['fixture-google','fixture-microsoft','fixture-guest-wrong-host','fixture-guest-wrong-action','unrelated'])await expect(verify(token)).rejects.toMatchObject({code:'AUTH_CHALLENGE_FAILED'});
  const auth=localAuthFixtureFetch(env)!;
  await expect(verify('fixture-guest-auth',auth)).rejects.toMatchObject({code:'AUTH_CHALLENGE_FAILED'});
  await expect(verify('fixture-google-auth',auth,'auth_sign_in')).resolves.toBeUndefined();
});
it('serves only pinned synthetic provider requests without any real network fallback',async()=>{
  const outgoing=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));
  const transport=localGuestFixtureFetch({...local})!;expect(transport).toBeTypeOf('function');
  const canvas=await transport('https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics');expect(await canvas.text()).toContain('Fixture Homework');
  const headers={Authorization:'Bearer fixture-guest-ed-token-never-echo'};
  expect((await (await transport('https://us.edstem.org/api/user',{headers})).json()).courses[0].course.id).toBe(123);
  expect((await (await transport('https://us.edstem.org/api/courses/123/lessons',{headers})).json()).lessons.length).toBeGreaterThan(0);
  expect((await transport('https://us.edstem.org/api/user',{headers:{Authorization:'Bearer invalid'}})).status).toBe(401);
  for(const url of ['https://unexpected.invalid/private','http://127.0.0.1:3000/api/test-fixtures/canvas-feed','https://canvas.uw.edu/feeds/calendars/other.ics','https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics?extra=1','https://us.edstem.org/api/user?extra=1','https://us.edstem.org/api/courses/999/lessons'])await expect(transport(url,{headers})).rejects.toThrow('Unexpected local guest fixture request.');
  await expect(transport('https://us.edstem.org/api/user',{method:'POST',headers})).rejects.toThrow('Unexpected local guest fixture request.');
  expect(outgoing).not.toHaveBeenCalled();
});
it('default runtime reuses the binding object so proof replay stays denied across requests',async()=>{
  bindings.env={...local,DB:{prepare(){},batch(){},exec(){}},KAIROS_GUEST_ENABLED:'true',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,1).toString('base64url'),KAIROS_TURNSTILE_SITE_KEY:'synthetic-site',KAIROS_TURNSTILE_SECRET_KEY:'synthetic-secret'};
  const first=await getGuestServerRuntime();const second=await getGuestServerRuntime();
  const proof={token:'fixture-guest-runtime',expectedAction:'guest_sync',expectedHostname:'127.0.0.1'};
  await expect(verifyTurnstile(proof,{secret:first.turnstileSecret,fetchImpl:first.fetchImpl})).resolves.toBeUndefined();
  await expect(verifyTurnstile(proof,{secret:second.turnstileSecret,fetchImpl:second.fetchImpl})).rejects.toMatchObject({code:'AUTH_CHALLENGE_FAILED'});
});
