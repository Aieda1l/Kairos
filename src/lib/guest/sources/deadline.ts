import "server-only";
import {GUEST_SOURCE_DEADLINE_MS} from "../limits";
import {GuestSourceError} from "./errors";

export type GuestSourceContext={
  fetchImpl:typeof fetch;requestId:string;checkedAt:string;signal:AbortSignal;
  assertProviderCurrent:()=>Promise<void>;
};
export type GuestSourceScope={
  signal:AbortSignal;fetchImpl:typeof fetch;
  check:()=>void;wait:<T>(promise:Promise<T>)=>Promise<T>;
  assertProviderCurrent:()=>Promise<void>;
};

/** One clock and signal cover guards, all dispatches, redirects, body and parsing. */
export async function withGuestSourceDeadline<T>(context:GuestSourceContext,networkCode:"NETWORK_ERROR"|"ED_NETWORK_ERROR",work:(scope:GuestSourceScope)=>Promise<T>):Promise<T>{
  const deadlineAt=Date.now()+GUEST_SOURCE_DEADLINE_MS;
  const controller=new AbortController();
  const failure=()=>new GuestSourceError(networkCode);
  let onAbort!:()=>void;
  const aborted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(failure());});
  controller.signal.addEventListener("abort",onAbort,{once:true});
  // The caller may already be cancelled before the first wait installs its race.
  void aborted.catch(()=>{});
  const cancel=()=>controller.abort();
  context.signal.addEventListener("abort",cancel,{once:true});
  if(context.signal.aborted)cancel();
  const timer=setTimeout(cancel,GUEST_SOURCE_DEADLINE_MS);
  const check=()=>{
    if(Date.now()>=deadlineAt)cancel();
    if(controller.signal.aborted)throw failure();
  };
  const wait=async<V>(promise:Promise<V>):Promise<V>=>{
    // Attach rejection handling even when check discovers an elapsed deadline.
    const raced=Promise.race([promise,aborted]);
    void raced.catch(()=>{});
    check();const result=await raced;check();return result;
  };
  const assertProviderCurrent=async()=>{
    check();
    try{await wait(context.assertProviderCurrent());}catch{
      check();
      throw new GuestSourceError("SERVICE_UNAVAILABLE");
    }
    check();
  };
  const fetchImpl:typeof fetch=async(input,init)=>{
    await assertProviderCurrent();
    check();
    // A late guard or fetch resolution can never cause another dispatch.
    const fetchImpl=context.fetchImpl;
    return wait(fetchImpl(input,{...init,signal:controller.signal}).then(response=>{
      try{check();return response;}catch(error){
        try{void response.body?.cancel().catch(()=>{});}catch{/* Best effort only. */}
        throw error;
      }
    }));
  };
  try{
    check();
    return await wait(work({signal:controller.signal,fetchImpl,check,wait,assertProviderCurrent}));
  }finally{
    clearTimeout(timer);
    context.signal.removeEventListener("abort",cancel);
    controller.abort();
    controller.signal.removeEventListener("abort",onAbort);
  }
}
