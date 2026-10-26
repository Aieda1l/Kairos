import 'server-only';
import {trustedClientNetwork} from '@/lib/abuse/keys';
import {AbuseClientAddressError} from '@/lib/abuse/types';
import {enforceRequestOrigin,isLoopbackOrigin} from '@/lib/security/request-origin';
import {GuestRequestError,type GuestServerRuntime} from './types';

export function enforceGuestRequest(request:Request,runtime:GuestServerRuntime):void {
  if(!runtime.guestEnabled)throw new GuestRequestError('GUEST_DISABLED');
  enforceRequestOrigin(request.headers,runtime.appOrigin);
}
export function guestRequestNetwork(headers:Headers,runtime:GuestServerRuntime):string {
  if(headers.has('cf-worker'))throw new AbuseClientAddressError();
  if(runtime.trustedIngress==='loopback'&&isLoopbackOrigin(new URL(runtime.appOrigin)))return 'ipv4:127.0.0.1';
  return trustedClientNetwork(headers,runtime.trustedIngress??'none');
}
