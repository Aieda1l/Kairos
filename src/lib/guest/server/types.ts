import 'server-only';
import type {AbuseRuntime,RateBudget} from '@/lib/abuse/types';
import {guestSafeMessage,type GuestApiErrorCode} from '../errors';

export type GuestPolicy={bootstrapNetwork:RateBudget;readNetwork:RateBudget;readSession:RateBudget;readGlobal:RateBudget};
export type GuestServerRuntime=AbuseRuntime & {guestEnabled:boolean;guestPolicy:GuestPolicy;now:()=>number};
export type GuestCapability={v:1;sid:string;aud:string;iatMs:number;expMs:number};
export type GuestRateSubject=
  |{class:'bootstrap-network'|'read-network';network:string}
  |{class:'read-session';sessionId:string}
  |{class:'read-global'};
export class GuestRequestError extends Error {
  constructor(readonly code:GuestApiErrorCode){super(guestSafeMessage(code));this.name='GuestRequestError';}
}
