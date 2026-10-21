import 'server-only';

/** Keep an admitted calendar operation, including its final owner write, alive
 * during Cloudflare's disconnect grace period. Await the same work normally;
 * never retry it or treat a timeout as proof that a remote write settled. */
export async function withCalendarOperationLifetime<T>(key:string,work:()=>Promise<T>):Promise<T>{
  if(!key.startsWith('calendar:'))return work();
  let retain:((task:Promise<unknown>)=>void)|undefined;
  try{retain=(await import('cloudflare:workers')).waitUntil;}catch{
    // The legacy Node runtime and local service fixtures have no Worker context.
  }
  const pending=work();
  retain?.(pending.then(()=>undefined,()=>undefined));
  return pending;
}
