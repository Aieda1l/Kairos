import {z} from 'zod';
import {GuestDataError,guestApiErrorCodeSchema} from '../errors';
import type {GuestSourceParseInput} from '../sources/wire';
import type {GuestCanvasFeedResponse,GuestEdCoursesResponse,GuestEdLessonsResponse} from '../sources/contracts';
type Result=GuestCanvasFeedResponse|GuestEdCoursesResponse|GuestEdLessonsResponse;
const messageSchema=z.union([z.object({id:z.string().uuid(),ok:z.literal(true),result:z.unknown()}).strict(),z.object({id:z.string().uuid(),ok:z.literal(false),code:guestApiErrorCodeSchema}).strict()]);
export function parseGuestSourceInWorker(input:GuestSourceParseInput,signal:AbortSignal,localDeadlineAtMs:number):Promise<Result>{
 return new Promise((resolve,reject)=>{
  let worker:Worker|undefined,done=false;
  const fail=()=>finish(()=>reject(new GuestDataError(signal.aborted?'GUEST_INTERRUPTED':input.operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR')));
  const finish=(action:()=>void)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',fail);worker?.terminate();action();};
  const timer=setTimeout(fail,Math.max(0,localDeadlineAtMs-Date.now()));
  signal.addEventListener('abort',fail,{once:true});
  if(signal.aborted||Date.now()>=localDeadlineAtMs){fail();return;}
  try{
   const id=crypto.randomUUID();worker=new Worker(new URL('../sources/source-parser.worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=(event:MessageEvent<unknown>)=>{const message=messageSchema.safeParse(event.data);if(!message.success||message.data.id!==id){finish(()=>reject(new GuestDataError('INVALID_RESULT')));return;}const data=message.data;if(data.ok)finish(()=>resolve(data.result as Result));else finish(()=>reject(new GuestDataError(data.code)));};
   worker.onerror=()=>finish(()=>reject(new GuestDataError('SERVICE_UNAVAILABLE')));
   worker.onmessageerror=()=>finish(()=>reject(new GuestDataError('INVALID_RESULT')));
   worker.postMessage({id,input},[input.bytes]);
  }catch{finish(()=>reject(new GuestDataError('SERVICE_UNAVAILABLE')));}
 });
}
