import 'server-only';
import {D1AbuseControlRepository} from '@/lib/db/d1/repositories/abuse-controls';
import {GUEST_SOURCE_DEADLINE_MS} from '../limits';
import {guestCanvasFeedWireSchema,guestEdCoursesWireSchema,guestEdLessonsWireSchema,GUEST_READ_RECEIPT_HEADER,GUEST_SOURCE_VERSION_HEADER,type GuestCanvasFeedWireInput,type GuestEdCoursesWireInput,type GuestEdLessonsWireInput} from '../sources/wire';
import {relayGuestSource} from './source-relay';
import {mintGuestReadReceipt} from './read-receipt';
import {GuestSourceError} from '../sources/errors';
import {getGuestEnabled} from './feature';
import {getGuestServerRuntime} from './runtime';
import {GuestRequestError,type GuestServerRuntime} from './types';
import {enforceGuestRequest,guestRequestNetwork} from './request';
import {readGuestCapability} from './capability';
import {enforceGuestReadAdmission} from './policy';
import {guestErrorResponse,readGuestJson} from './json';

export function createGuestSourceHandler(operation:'canvas-feed'|'ed-courses'|'ed-lessons',runtimeFactory:()=>Promise<GuestServerRuntime>=getGuestServerRuntime):(request:Request)=>Promise<Response> {
  return async request=>{
    const controller=new AbortController();
    const deadlineAt=Date.now()+GUEST_SOURCE_DEADLINE_MS;
    const timeoutError=()=>new GuestSourceError(operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR');
    const cancel=()=>controller.abort();
    let onAbort!:()=>void;
    const aborted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(timeoutError());});
    void aborted.catch(()=>{});
    controller.signal.addEventListener('abort',onAbort,{once:true});
    request.signal.addEventListener('abort',cancel,{once:true});
    if(request.signal.aborted)cancel();
    const timer=setTimeout(cancel,GUEST_SOURCE_DEADLINE_MS);
    const check=()=>{
      if(Date.now()>=deadlineAt)cancel();
      if(controller.signal.aborted)throw timeoutError();
    };
    const wait=async<T>(promise:Promise<T>):Promise<T>=>{
      const raced=Promise.race([promise,aborted]);void raced.catch(()=>{});
      check();const result=await raced;check();return result;
    };
    try{
      // The flag is independent of runtime validation, D1 and provider modules.
      if(!await wait(getGuestEnabled()))throw new GuestRequestError('GUEST_DISABLED');
      if(request.method!=='POST')throw new GuestRequestError('BAD_REQUEST');
      const runtime=await wait(runtimeFactory());
      enforceGuestRequest(request,runtime);
      const capability=await wait(readGuestCapability(request.headers,runtime,runtime.now()));
      const input=await wait(readGuestJson<GuestCanvasFeedWireInput|GuestEdCoursesWireInput|GuestEdLessonsWireInput>(request,
        operation==='canvas-feed'?guestCanvasFeedWireSchema:operation==='ed-courses'?guestEdCoursesWireSchema:guestEdLessonsWireSchema,
        controller.signal));
      const network=guestRequestNetwork(request.headers,runtime);
      const controls=new D1AbuseControlRepository(runtime.db);
      const key=operation==='canvas-feed'?'provider:canvas':'provider:ed';
      const admitted=await wait(controls.get(key));
      if(!admitted.enabled)throw new GuestRequestError('SERVICE_UNAVAILABLE');
      await wait(enforceGuestReadAdmission(runtime,{network,sessionId:capability.sid,check}));
      const assertProviderCurrent=async()=>{
        check();
        const current=await wait(controls.get(key));
        if(!current.enabled||current.version!==admitted.version)throw new GuestRequestError('SERVICE_UNAVAILABLE');
      };
      const issuedAtMs=runtime.now();
      const remaining=deadlineAt-Date.now();
      const deadlineAtMs=Math.min(capability.expMs,issuedAtMs+remaining);
      if(!Number.isSafeInteger(issuedAtMs)||!Number.isSafeInteger(deadlineAtMs)||remaining<=0||deadlineAtMs<=issuedAtMs)throw timeoutError();
      const checkedAt=new Date(issuedAtMs).toISOString();
      const guardedFetch:typeof fetch=async (resource,init)=>{await assertProviderCurrent();return wait(runtime.fetchImpl(resource,init));};
      const bytes=await wait(relayGuestSource(operation,input,guardedFetch,controller.signal));
      await assertProviderCurrent();
      const receipt=await wait(mintGuestReadReceipt(runtime,capability,{operation,requestId:input.requestId,checkedAt,issuedAtMs,deadlineAtMs,providerVersion:admitted.version,courseId:'courseId' in input?input.courseId:null}));
      check();if(runtime.now()>=deadlineAtMs)throw timeoutError();return new Response(bytes,{headers:{'content-type':'application/octet-stream','cache-control':'no-store, private',[GUEST_SOURCE_VERSION_HEADER]:'2',[GUEST_READ_RECEIPT_HEADER]:receipt}});
    }catch(error){return guestErrorResponse(error);}
    finally{
      clearTimeout(timer);request.signal.removeEventListener('abort',cancel);
      controller.abort();controller.signal.removeEventListener('abort',onAbort);
    }
  };
}
