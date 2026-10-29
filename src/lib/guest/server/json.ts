import 'server-only';
import type {z} from 'zod';
import {RateLimitedError} from '@/lib/abuse/types';
import {RequestOriginError} from '@/lib/security/request-origin';
import {readBoundedJson} from '@/lib/http/bounded-body';
import {guestSafeMessage,type GuestApiErrorCode} from '../errors';
import {GUEST_MAX_REQUEST_BYTES,GUEST_SOURCE_DEADLINE_MS} from '../limits';
import {GuestRequestError} from './types';
import {GuestSourceError} from '../sources/errors';

export async function readGuestJson<T>(request:Request,schema:z.ZodType<T>,signal?:AbortSignal):Promise<T> {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new GuestRequestError('UNSUPPORTED_MEDIA_TYPE');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  const signals=[request.signal,...(signal?[signal]:[])];
  for(const item of signals){if(item.aborted)abort();else item.addEventListener('abort',abort,{once:true});}
  const timer=setTimeout(abort,GUEST_SOURCE_DEADLINE_MS);
  try {
    const value=await readBoundedJson(request.body,{maxBytes:GUEST_MAX_REQUEST_BYTES,signal:controller.signal});
    const parsed=schema.safeParse(value);
    if(!parsed.success)throw new GuestRequestError('BAD_REQUEST');
    return parsed.data;
  }catch{throw new GuestRequestError('BAD_REQUEST');}
  finally{clearTimeout(timer);for(const item of signals)item.removeEventListener('abort',abort);}
}
export function guestJson(value:unknown,init:ResponseInit={}):Response {
  const headers=new Headers(init.headers);headers.set('cache-control','no-store, private');
  return Response.json(value,{...init,headers});
}
export function guestErrorResponse(error:unknown):Response {
  const code:GuestApiErrorCode=error instanceof GuestRequestError||error instanceof GuestSourceError?error.code:error instanceof RateLimitedError?'RATE_LIMITED':error instanceof RequestOriginError?'UNTRUSTED_ORIGIN':'SERVICE_UNAVAILABLE';
  const status=code==='GUEST_DISABLED'?404:code==='GUEST_SESSION_REQUIRED'?401:code==='UNTRUSTED_ORIGIN'||code==='GUEST_CHALLENGE_FAILED'?403:code==='UNSUPPORTED_MEDIA_TYPE'?415:code==='RATE_LIMITED'?429:code==='SERVICE_UNAVAILABLE'||code==='GUEST_CHALLENGE_UNAVAILABLE'?503:error instanceof GuestSourceError&&code!=='BAD_REQUEST'?422:400;
  const retryAfterSeconds=error instanceof RateLimitedError?error.retryAfterSeconds:undefined;
  return guestJson({ok:false,code,message:guestSafeMessage(code),...(retryAfterSeconds?{retryAfterSeconds}:{})},
    {status,...(retryAfterSeconds?{headers:{'retry-after':String(retryAfterSeconds)}}:{})});
}
