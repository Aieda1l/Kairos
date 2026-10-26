import 'server-only';
import {AbuseConfigurationError} from '@/lib/abuse/types';
import {resolveAbuseRuntime} from '@/lib/platform/abuse-runtime';
import {localGuestFixtureFetch} from '@/lib/testing/guest-transport';
import {isGuestEnabled} from '../feature';
import {defaultGuestPolicy} from './policy';
import type {GuestServerRuntime} from './types';

export function resolveGuestServerRuntime(env:Record<string,unknown>,fetchImpl:typeof fetch=fetch):GuestServerRuntime {
  return {...resolveAbuseRuntime(env,fetchImpl),guestEnabled:isGuestEnabled(env),guestPolicy:defaultGuestPolicy(),now:()=>Date.now()};
}
export async function getGuestServerRuntime():Promise<GuestServerRuntime> {
  try {
    const {env}=await import('cloudflare:workers');
    const bindings=env as unknown as Record<string,unknown>;
    return resolveGuestServerRuntime(bindings,localGuestFixtureFetch(bindings)??fetch);
  }catch{throw new AbuseConfigurationError();}
}
