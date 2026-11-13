import {describe,it,expect} from 'vitest';
import {mintGuestReadReceipt,verifyGuestReadReceipt} from '@/lib/guest/server/read-receipt';
import {readGuestReadReceiptMetadata} from '@/lib/guest/sources/wire';
import type {GuestCapability,GuestServerRuntime} from '@/lib/guest/server/types';
const now=Date.parse('2026-01-01T00:00:00.000Z'),id='00000000-0000-4000-8000-000000000001';
const runtime={hmacKey:new Uint8Array(32).fill(1),appOrigin:'https://kairos.example',now:()=>now} as GuestServerRuntime;
const cap={v:1,sid:'A'.repeat(43),aud:runtime.appOrigin,iatMs:now-1000,expMs:now+100000} as GuestCapability;
const claims={operation:'ed-lessons' as const,requestId:id,checkedAt:new Date(now).toISOString(),issuedAtMs:now,deadlineAtMs:now+10000,providerVersion:3,courseId:'12'};
describe('read receipts',()=>{
 it('binds signature, session, audience and correlation',async()=>{const token=await mintGuestReadReceipt(runtime,cap,claims);expect(readGuestReadReceiptMetadata(token)).toMatchObject(claims);expect(token).not.toContain(cap.sid);expect(await verifyGuestReadReceipt(token,runtime,cap,id)).toMatchObject(claims);for(const [value,rt,c,request] of [[token.slice(0,-1)+(token.endsWith('A')?'B':'A'),runtime,cap,id],[token,runtime,{...cap,sid:'B'.repeat(43)},id],[token,{...runtime,appOrigin:'https://other.example'},cap,id],[token,runtime,cap,'00000000-0000-4000-8000-000000000002']] as const)await expect(verifyGuestReadReceipt(value,rt,c,request)).rejects.toMatchObject({code:'BAD_REQUEST'});});
 it('rejects future issuance and deadlines beyond the capability',async()=>{const token=await mintGuestReadReceipt(runtime,cap,claims);await expect(verifyGuestReadReceipt(token,{...runtime,now:()=>now-1},cap,id)).rejects.toMatchObject({code:'BAD_REQUEST'});await expect(mintGuestReadReceipt(runtime,cap,{...claims,deadlineAtMs:cap.expMs+1})).rejects.toThrow();});
 it('does not accept hostile authority fields or invalid dates',async()=>{const token=await mintGuestReadReceipt(runtime,cap,{...claims,v:1,aud:'https://evil.example',sessionTag:'bad'} as unknown as typeof claims);const decoded=readGuestReadReceiptMetadata(token);expect(decoded).toMatchObject({v:2,aud:runtime.appOrigin});expect(decoded?.sessionTag).not.toBe('bad');await expect(mintGuestReadReceipt(runtime,cap,{...claims,issuedAtMs:Number.MAX_SAFE_INTEGER,deadlineAtMs:Number.MAX_SAFE_INTEGER,checkedAt:'x'})).rejects.toThrow();await expect(mintGuestReadReceipt(runtime,cap,{...claims,unexpected:'private'} as unknown as typeof claims)).rejects.toThrow();expect(readGuestReadReceiptMetadata('bad.')).toBeNull();});
});
