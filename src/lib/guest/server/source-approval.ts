import 'server-only';
import {D1AbuseControlRepository} from '@/lib/db/d1/repositories/abuse-controls';
import {GUEST_SOURCE_DEADLINE_MS} from '../limits';
import {guestSourceApprovalRequestSchema,type GuestReadReceiptClaims} from '../sources/wire';
import {GuestSourceError} from '../sources/errors';
import {getGuestEnabled} from './feature';
import {getGuestServerRuntime} from './runtime';
import {GuestRequestError,type GuestServerRuntime} from './types';
import {enforceGuestRequest,guestRequestNetwork} from './request';
import {readGuestCapability} from './capability';
import {enforceGuestApprovalAdmission} from './policy';
import {guestErrorResponse,guestJson,readGuestJson} from './json';
import {verifyGuestReadReceipt} from './read-receipt';
export function createGuestSourceApprovalHandler(runtimeFactory:()=>Promise<GuestServerRuntime>=getGuestServerRuntime):(request:Request)=>Promise<Response>{return async request=>{
 const controller=new AbortController();const started=Date.now();let claims:GuestReadReceiptClaims|undefined;let runtime:GuestServerRuntime|undefined;let stopped=false;
 const timeout=()=>claims?new GuestSourceError(claims.operation==='canvas-feed'?'NETWORK_ERROR':'ED_NETWORK_ERROR'):new GuestRequestError('SERVICE_UNAVAILABLE');
 let rejectStop!:(error:Error)=>void;const interrupted=new Promise<never>((_,reject)=>{rejectStop=reject;});void interrupted.catch(()=>{});
 const stop=()=>{stopped=true;controller.abort();rejectStop(timeout());};let timer=setTimeout(stop,GUEST_SOURCE_DEADLINE_MS);request.signal.addEventListener('abort',stop,{once:true});if(request.signal.aborted)stop();
 const check=()=>{if(stopped||request.signal.aborted||Date.now()-started>=GUEST_SOURCE_DEADLINE_MS||(claims&&runtime&&runtime.now()>=claims.deadlineAtMs))throw timeout();};
 const wait=async<T>(promise:Promise<T>):Promise<T>=>{check();try{const result=await Promise.race([promise,interrupted]);check();return result;}catch(error){check();throw error;}};
 try{
  if(!await wait(getGuestEnabled()))throw new GuestRequestError('GUEST_DISABLED');if(request.method!=='POST')throw new GuestRequestError('BAD_REQUEST');
  runtime=await wait(runtimeFactory());enforceGuestRequest(request,runtime);const cap=await wait(readGuestCapability(request.headers,runtime,runtime.now()));
  const input=await wait(readGuestJson(request,guestSourceApprovalRequestSchema,controller.signal));guestRequestNetwork(request.headers,runtime);
  claims=await wait(verifyGuestReadReceipt(input.receipt,runtime,cap,input.requestId));check();
  const remaining=Math.min(GUEST_SOURCE_DEADLINE_MS-(Date.now()-started),claims.deadlineAtMs-runtime.now());clearTimeout(timer);timer=setTimeout(stop,remaining);
  await wait(enforceGuestApprovalAdmission(runtime,check));check();
  const current=await wait(new D1AbuseControlRepository(runtime.db).get(claims.operation==='canvas-feed'?'provider:canvas':'provider:ed'));check();
  if(!current.enabled||current.version!==claims.providerVersion)throw new GuestRequestError('SERVICE_UNAVAILABLE');
  return guestJson({ok:true,schemaVersion:2,requestId:claims.requestId,checkedAt:claims.checkedAt,operation:claims.operation,courseId:claims.courseId});
 }catch(error){return guestErrorResponse(error);}finally{controller.abort();clearTimeout(timer);request.signal.removeEventListener('abort',stop);}
 };}
