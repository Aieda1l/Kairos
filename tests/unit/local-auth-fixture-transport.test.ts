import {expect,it,vi} from 'vitest';
import {localAuthFixtureFetch,localAuthFixtureStats} from '@/lib/testing/auth-transport';
import {verifyTurnstile} from '@/lib/auth/turnstile';
const local={E2E_FIXTURES:'1',KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback'};
it('only selects the controlled transport in explicit local fixture mode',()=>{
  expect(localAuthFixtureFetch(local)).toBeTypeOf('function');
  for(const env of [{...local,E2E_FIXTURES:undefined},{...local,KAIROS_APP_URL:'https://mykairos.me'},{...local,KAIROS_LOCAL_AUTH:undefined},{...local,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare'}]){
    expect(localAuthFixtureFetch(env)).toBeUndefined();expect(localAuthFixtureStats(env)).toBeUndefined();
  }
});
it('real verification still requires successful matching action and hostname',async()=>{
  const transport=localAuthFixtureFetch({...local})!;
  for(const [token,action] of [['fixture-google','auth_google'],['fixture-microsoft','auth_microsoft']]){
    await expect(verifyTurnstile({token,expectedAction:action,expectedHostname:'127.0.0.1'},{secret:'synthetic-secret',fetchImpl:transport})).resolves.toBeUndefined();
  }
  for(const token of ['fixture-invalid','fixture-google-wrong-host','fixture-google-wrong-action']){
    await expect(verifyTurnstile({token,expectedAction:'auth_google',expectedHostname:'127.0.0.1'},{secret:'synthetic-secret',fetchImpl:transport})).rejects.toMatchObject({code:'AUTH_CHALLENGE_FAILED'});
  }
});
it('rejects replay and unexpected destinations without a network call',async()=>{
  const outgoing=vi.spyOn(globalThis,'fetch');
  const transport=localAuthFixtureFetch({...local})!;
  const request={method:'POST',body:new URLSearchParams({secret:'synthetic-secret',response:'fixture-google'})};
  const url='https://challenges.cloudflare.com/turnstile/v0/siteverify';
  expect((await (await transport(url,request)).json()).success).toBe(true);
  expect((await (await transport(url,request)).json()).success).toBe(false);
  await expect(transport('https://unexpected.invalid/private')).rejects.toThrow();
  expect(outgoing).not.toHaveBeenCalled();outgoing.mockRestore();
});
