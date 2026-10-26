import 'server-only';
import {AbuseConfigurationError} from '@/lib/abuse/types';
import {resolveAbuseRuntime} from '@/lib/platform/abuse-runtime';
import {isGuestEnabled} from '../feature';
import {defaultGuestPolicy} from './policy';
import type {GuestServerRuntime} from './types';

export function resolveGuestServerRuntime(env:Record<string,unknown>,fetchImpl:typeof fetch=fetch):GuestServerRuntime {
  return {...resolveAbuseRuntime(env,fetchImpl),guestEnabled:isGuestEnabled(env),guestPolicy:defaultGuestPolicy(),now:()=>Date.now()};
}
export async function getGuestServerRuntime():Promise<GuestServerRuntime> {
  try {
    const {env}=await import('cloudflare:workers');
    return resolveGuestServerRuntime(env as unknown as Record<string,unknown>);
  }catch{throw new AbuseConfigurationError();}
}
