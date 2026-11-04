import 'server-only';
import {hashRateKey,normalizeClientNetwork} from '@/lib/abuse/keys';
import {AbuseSubjectError,RateLimitedError} from '@/lib/abuse/types';
import {D1RateLimitRepository} from '@/lib/db/d1/repositories/rate-limits';
import * as limits from '../limits';
import type {GuestPolicy,GuestRateSubject,GuestServerRuntime} from './types';

export function defaultGuestPolicy():GuestPolicy {
  const budget=(limit:number)=>({limit,windowSeconds:limits.GUEST_BUDGET_WINDOW_SECONDS});
  return {bootstrapNetwork:budget(limits.GUEST_BOOTSTRAP_NETWORK_BUDGET),readNetwork:budget(limits.GUEST_READ_NETWORK_BUDGET),
    readSession:budget(limits.GUEST_READ_SESSION_BUDGET),readGlobal:budget(limits.GUEST_READ_GLOBAL_BUDGET)};
}
export function guestRateKeyParts(subject:GuestRateSubject):string[] {
  switch(subject.class){
    case 'bootstrap-network':case 'read-network':{
      const network=subject.network;
      if(typeof network!=='string')throw new AbuseSubjectError();
      const address=network.startsWith('ipv4:')?network.slice(5):network.startsWith('ipv6:')&&network.endsWith('/64')?network.slice(5,-3):'';
      if(normalizeClientNetwork(address)!==network)throw new AbuseSubjectError();
      return ['guest',subject.class,network];
    }
    case 'read-session':
      // A 32-byte unpadded base64url identifier has exactly two zero pad bits.
      if(typeof subject.sessionId!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(subject.sessionId))throw new AbuseSubjectError();
      return ['guest',subject.class,subject.sessionId];
    case 'read-global':return ['guest',subject.class];
    default:throw new AbuseSubjectError();
  }
}
async function consume(runtime:GuestServerRuntime,subject:GuestRateSubject,budget:GuestPolicy[keyof GuestPolicy]):Promise<void> {
  const keyHash=await hashRateKey(runtime.hmacKey,guestRateKeyParts(subject));
  const decision=await new D1RateLimitRepository(runtime.db).consume({keyHash,userId:null,...budget});
  if(!decision.allowed)throw new RateLimitedError(decision.retryAfterSeconds);
}
export function enforceGuestBootstrapAdmission(runtime:GuestServerRuntime,network:string):Promise<void> {
  return consume(runtime,{class:'bootstrap-network',network},runtime.guestPolicy.bootstrapNetwork);
}
export async function enforceGuestReadAdmission(runtime:GuestServerRuntime,{network,sessionId}:{network:string;sessionId:string}):Promise<void> {
  await consume(runtime,{class:'read-network',network},runtime.guestPolicy.readNetwork);
  await consume(runtime,{class:'read-session',sessionId},runtime.guestPolicy.readSession);
  await consume(runtime,{class:'read-global'},runtime.guestPolicy.readGlobal);
}
