import 'server-only';
import {D1AbuseControlRepository} from '@/lib/db/d1/repositories/abuse-controls';
import {GUEST_SOURCE_DEADLINE_MS} from '../limits';
import {guestCanvasFeedRequestSchema,guestEdCoursesRequestSchema,guestEdLessonsRequestSchema,type GuestCanvasFeedRequest,type GuestEdCoursesRequest,type GuestEdLessonsRequest} from '../sources/contracts';
import {GuestSourceError} from '../sources/errors';
import {getGuestEnabled} from './feature';
import {getGuestServerRuntime} from './runtime';
import {GuestRequestError,type GuestServerRuntime} from './types';
import {enforceGuestRequest,guestRequestNetwork} from './request';
import {readGuestCapability} from './capability';
import {enforceGuestReadAdmission} from './policy';
import {guestErrorResponse,guestJson,readGuestJson} from './json';

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
      const input=await wait(readGuestJson<GuestCanvasFeedRequest|GuestEdCoursesRequest|GuestEdLessonsRequest>(request,
        operation==='canvas-feed'?guestCanvasFeedRequestSchema:operation==='ed-courses'?guestEdCoursesRequestSchema:guestEdLessonsRequestSchema,
        controller.signal));
      const network=guestRequestNetwork(request.headers,runtime);
      const controls=new D1AbuseControlRepository(runtime.db);
      const key=operation==='canvas-feed'?'provider:canvas':'provider:ed';
      const admitted=await wait(controls.get(key));
      if(!admitted.enabled)throw new GuestRequestError('SERVICE_UNAVAILABLE');
      await wait(enforceGuestReadAdmission(runtime,{network,sessionId:capability.sid}));
      const assertProviderCurrent=async()=>{
        check();
        const current=await wait(controls.get(key));
        if(!current.enabled||current.version!==admitted.version)throw new GuestRequestError('SERVICE_UNAVAILABLE');
      };
      const context={fetchImpl:runtime.fetchImpl,requestId:input.requestId,checkedAt:new Date(runtime.now()).toISOString(),signal:controller.signal,assertProviderCurrent};
      // Each reader validates its bounded response and guards every fetch/redirect.
      let result;
      if('feedUrl' in input){
        const {readGuestCanvas}=await wait(import('../sources/canvas'));
        result=await wait(readGuestCanvas(input,context));
      }else if('courseId' in input){
        const {readGuestEdLessons}=await wait(import('../sources/ed'));
        result=await wait(readGuestEdLessons(input,context));
      }else{
        const {readGuestEdCourses}=await wait(import('../sources/ed'));
        result=await wait(readGuestEdCourses(input,context));
      }
      await assertProviderCurrent();
      check();return guestJson(result);
    }catch(error){return guestErrorResponse(error);}
    finally{
      clearTimeout(timer);request.signal.removeEventListener('abort',cancel);
      controller.abort();controller.signal.removeEventListener('abort',onAbort);
    }
  };
}
