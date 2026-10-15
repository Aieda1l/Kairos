import {expect,it} from 'vitest';
import {credentialKeyringFromBindings} from '@/lib/security/keyring-environment';
import {decryptCredential,encryptCredential} from '@/lib/security/credential-cipher';
const v1=new Uint8Array(32).fill(1),v2=new Uint8Array(32).fill(2);
const encoded=(key:Uint8Array)=>Buffer.from(key).toString('base64url');
const bindings={KAIROS_CREDENTIAL_KEY_V1:encoded(v1),KAIROS_CREDENTIAL_KEY_V2:encoded(v2)};
it('defaults to v1 while retaining both read keys',()=>{
  const keyring=credentialKeyringFromBindings(bindings);
  expect(keyring.activeKeyId).toBe('v1');expect(keyring.keys.v1).toEqual(v1);expect(keyring.keys.v2).toEqual(v2);
});
it('supports mixed v1/v2 reads and new v2 writes without changing the v1 envelope format',async()=>{
  const old=credentialKeyringFromBindings(bindings),active=credentialKeyringFromBindings({...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'});
  const input={plaintext:'synthetic-private-secret',userId:'synthetic-alice',purpose:'ed_api_token' as const,contextId:'synthetic-source'};
  const prior=await encryptCredential(input,old),next=await encryptCredential(input,active);
  expect(prior.startsWith('v1.v1.')).toBe(true);expect(next.startsWith('v1.v2.')).toBe(true);
  expect(await decryptCredential({...input,envelope:prior},active)).toBe(input.plaintext);
  expect(await decryptCredential({...input,envelope:next},old)).toBe(input.plaintext);
});
it.each([
  {},{KAIROS_CREDENTIAL_KEY_V1:encoded(new Uint8Array(31))},
  {...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'wrong'},
  {KAIROS_CREDENTIAL_KEY_V1:bindings.KAIROS_CREDENTIAL_KEY_V1,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'},
  {...bindings,KAIROS_CREDENTIAL_KEY_V2:bindings.KAIROS_CREDENTIAL_KEY_V1},
  {...bindings,KAIROS_CREDENTIAL_KEY_V1:bindings.KAIROS_CREDENTIAL_KEY_V1+'='},
])('rejects misconfigured keys with a sanitized error',env=>{
  expect(()=>credentialKeyringFromBindings(env)).toThrow();
  try{credentialKeyringFromBindings(env);}catch(error){expect(error).toMatchObject({code:'CREDENTIAL_KEY_INVALID'});expect(String(error)).not.toContain(bindings.KAIROS_CREDENTIAL_KEY_V1);}
});
