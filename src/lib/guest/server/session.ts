import 'server-only';
import {AuthChallengeError,verifyTurnstile} from '@/lib/auth/turnstile';
import {guestSessionRequestSchema,guestSessionEndRequestSchema} from '../sources/contracts';
import {getGuestEnabled} from './feature';
import {getGuestServerRuntime} from './runtime';
import {GuestRequestError,type GuestServerRuntime} from './types';
import {enforceGuestRequest,guestRequestNetwork} from './request';
import {guestErrorResponse,guestJson,readGuestJson} from './json';
import {enforceGuestBootstrapAdmission} from './policy';
import {guestCapabilityCookie,mintGuestCapability} from './capability';

export function createGuestSessionHandlers(deps:{isEnabled:()=>Promise<boolean>;getRuntime:()=>Promise<GuestServerRuntime>}={isEnabled:getGuestEnabled,getRuntime:getGuestServerRuntime}) {
  async function runtimeFor(request:Request):Promise<GuestServerRuntime> {
    if(!await deps.isEnabled())throw new GuestRequestError('GUEST_DISABLED');
    const runtime=await deps.getRuntime();enforceGuestRequest(request,runtime);return runtime;
  }
  return {
    async start(request:Request):Promise<Response> {
      try {
        const runtime=await runtimeFor(request);
        const input=await readGuestJson(request,guestSessionRequestSchema);
        const network=guestRequestNetwork(request.headers,runtime);
        await enforceGuestBootstrapAdmission(runtime,network);
        try {
          await verifyTurnstile({token:input.turnstileToken,expectedAction:'guest_sync',expectedHostname:runtime.hostname},
            {secret:runtime.turnstileSecret,fetchImpl:runtime.fetchImpl});
        }catch(error){
          throw new GuestRequestError(error instanceof AuthChallengeError&&error.code==='AUTH_CHALLENGE_FAILED'?'GUEST_CHALLENGE_FAILED':'GUEST_CHALLENGE_UNAVAILABLE');
        }
        const nowMs=runtime.now();
        const capability=await mintGuestCapability(runtime,nowMs);
        return guestJson({ok:true,schemaVersion:1,requestId:input.requestId,checkedAt:new Date(nowMs).toISOString(),expiresAt:capability.expiresAt},
          {headers:{'set-cookie':guestCapabilityCookie(runtime,capability.value)}});
      }catch(error){return guestErrorResponse(error);}
    },
    async end(request:Request):Promise<Response> {
      try {
        const runtime=await runtimeFor(request);
        await readGuestJson(request,guestSessionEndRequestSchema);
        return guestJson({ok:true},{headers:{'set-cookie':guestCapabilityCookie(runtime,'',true)}});
      }catch(error){return guestErrorResponse(error);}
    },
  };
}
