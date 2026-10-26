import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import type {GuestServerRuntime} from '@/lib/guest/server/types';
import {mintGuestCapability,verifyGuestCapability,guestCookieName,guestCapabilityCookie,readGuestCapability} from '@/lib/guest/server/capability';
import {consumeAuthAttempt} from '@/lib/auth/initiation';

const now=1_800_000_000_000;
const key=Uint8Array.from({length:32},(_,i)=>i+1);
const runtime={hmacKey:key,appOrigin:'https://kairos.example',trustedIngress:'cloudflare'} as GuestServerRuntime;
const sid=Buffer.alloc(32,7).toString('base64url');
const claims={v:1,sid,aud:runtime.appOrigin,iatMs:now,expMs:now+1_800_000};
function signed(value:unknown,purpose='guest-capability',raw?:Buffer){
  const payload=(raw??Buffer.from(JSON.stringify(value))).toString('base64url');
  const subkey=createHmac('sha256',key).update(JSON.stringify(['kairos:abuse:v1','subkey',purpose])).digest();
  return payload+'.'+createHmac('sha256',subkey).update(payload).digest('base64url');
}

describe('guest capability and policy cannot authorize account work',()=>{
  it('mints a unique 32-byte session, exact 30-minute expiry and strict production cookie',async()=>{
    const minted=await mintGuestCapability(runtime,now);
    const result=await verifyGuestCapability(minted.value,runtime,now);
    expect(result).toMatchObject({v:1,aud:runtime.appOrigin,iatMs:now,expMs:now+1_800_000});
    expect(Buffer.from(result.sid,'base64url')).toHaveLength(32);
    expect((await mintGuestCapability(runtime,now)).value).not.toBe(minted.value);
    expect(minted.expiresAt).toBe(new Date(now+1_800_000).toISOString());
    const setCookie=guestCapabilityCookie(runtime,minted.value);
    expect(setCookie).toContain('__Host-kairos-guest-sync=');
    for(const attribute of ['Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=1800'])expect(setCookie).toContain(attribute);
    expect(setCookie).not.toMatch(/Domain=/i);
    const headers=new Headers({cookie:'kairos.auth-attempt.google='+minted.value});
    await expect(consumeAuthAttempt(runtime,'google',headers,'state')).rejects.toMatchObject({code:'AUTH_ATTEMPT_INVALID'});
  });
  it.each([
    {v:2},{aud:'https://other.example'},{iatMs:now+30_001,expMs:now+30_001+1_800_000},
    {iatMs:now-1_800_000,expMs:now},{expMs:now+1_800_001},{iatMs:0.5},
    {sid:'short'},{sid:sid.slice(0,-1)+'d'},{extra:true},{iatMs:-1,expMs:1_799_999},
  ])('rejects signed invalid claims %j',async patch=>{
    await expect(verifyGuestCapability(signed({...claims,...patch}),runtime,now)).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
  });
  it('accepts exactly 30 seconds of clock skew and rejects wrong-purpose/auth tokens',async()=>{
    await expect(verifyGuestCapability(signed({...claims,iatMs:now+30_000,expMs:now+1_830_000}),runtime,now)).resolves.toMatchObject({sid});
    await expect(verifyGuestCapability(signed(claims,'auth-attempt'),runtime,now)).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
  });
  it('rejects noncanonical encoding, malformed UTF-8, wrong signatures and oversized tokens',async()=>{
    const good=signed(claims),[payload,signature]=good.split('.');
    const last='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(signature.at(-1)!);
    const badPad=signature.slice(0,-1)+'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[last+1];
    for(const value of [payload+'=.'+signature,payload+'.'+badPad,good+'=',good+'.x','x'.repeat(1025),payload+'.'+'A'.repeat(43),signed({},'guest-capability',Buffer.from([0xff]))]){
      await expect(verifyGuestCapability(value,runtime,now)).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
    }
  });
  it('rejects duplicate selected cookies and never reads a development cookie in production',async()=>{
    const value=signed(claims),name=guestCookieName(runtime);
    await expect(readGuestCapability(new Headers({cookie:`${name}=${value}; ${name}=${value}`}),runtime,now)).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
    await expect(readGuestCapability(new Headers({cookie:`kairos-guest-sync-dev=${value}`}),runtime,now)).rejects.toMatchObject({code:'GUEST_SESSION_REQUIRED'});
    await expect(readGuestCapability(new Headers({cookie:`other=one; ${name}=${value}`}),runtime,now)).resolves.toMatchObject({sid});
    const local={...runtime,appOrigin:'http://localhost:3000',trustedIngress:'loopback' as const};
    expect(guestCookieName(local)).toBe('kairos-guest-sync-dev');
    expect(guestCapabilityCookie(local,value)).not.toContain('Secure');
    expect(()=>guestCookieName({...local,trustedIngress:'cloudflare'})).toThrow();
    expect(guestCapabilityCookie(runtime,'',true)).toContain('Max-Age=0');
  });
});
