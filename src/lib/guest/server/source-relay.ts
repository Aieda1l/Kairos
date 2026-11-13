import 'server-only';
import {BoundedBodyError,readBoundedBytes} from '@/lib/http/bounded-body';
import {fetchCanvasFeedResponse} from '@/lib/sources/canvas-ical/transport';
import {CanvasFeedUrlError,validateCanvasFeedUrl} from '@/lib/sources/canvas-ical/validate-url';
import {CanvasSourceError} from '@/lib/sources/canvas-ical/errors';
import {fetchEdResponse} from '@/lib/sources/ed/transport';
import {EdSourceError} from '@/lib/sources/ed/errors';
import {GUEST_MAX_UPSTREAM_BYTES} from '../limits';
import {GuestSourceError} from '../sources/errors';
import {GuestRequestError} from './types';
import type {GuestSourceOperation,GuestCanvasFeedWireInput,GuestEdCoursesWireInput,GuestEdLessonsWireInput} from '../sources/wire';
export async function relayGuestSource(operation:GuestSourceOperation,input:GuestCanvasFeedWireInput|GuestEdCoursesWireInput|GuestEdLessonsWireInput,fetchImpl:typeof fetch,signal:AbortSignal):Promise<Uint8Array<ArrayBuffer>>{
 try{
  const response=operation==='canvas-feed'?await fetchCanvasFeedResponse(validateCanvasFeedUrl((input as GuestCanvasFeedWireInput).feedUrl),fetchImpl,signal):await fetchEdResponse((input as GuestEdCoursesWireInput).token,operation==='ed-lessons'?{kind:'lessons',courseId:(input as GuestEdLessonsWireInput).courseId}:{kind:'user'},fetchImpl,signal);
  if(!response.ok){try{void response.body?.cancel().catch(()=>{});}catch{} }
  if(response.status===401||response.status===403)throw new GuestSourceError(operation==='canvas-feed'?'UNAUTHORIZED_OR_EXPIRED_FEED':'ED_AUTH_INVALID');
  if(operation!=='canvas-feed'&&response.status===429)throw new GuestSourceError('ED_RATE_LIMITED');
  if(operation==='ed-lessons'&&response.status===404)throw new GuestSourceError('ED_COURSE_UNAVAILABLE');
  if(!response.ok)throw new GuestSourceError(operation==='canvas-feed'?'NETWORK_ERROR':'ED_UPSTREAM_ERROR');
  return await readBoundedBytes(response.body,{maxBytes:GUEST_MAX_UPSTREAM_BYTES,signal});
 }catch(error){if(error instanceof GuestSourceError||error instanceof GuestRequestError)throw error;if(error instanceof CanvasFeedUrlError)throw new GuestSourceError('INVALID_FEED_URL');if(error instanceof CanvasSourceError||error instanceof EdSourceError)throw new GuestSourceError(error.code);if(error instanceof BoundedBodyError&&error.code==='BODY_TOO_LARGE')throw new GuestSourceError('SOURCE_RESULT_TOO_LARGE');throw new GuestSourceError(operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR');}
}
