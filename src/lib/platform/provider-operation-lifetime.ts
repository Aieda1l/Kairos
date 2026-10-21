import 'server-only';

/** Keep an admitted provider operation, including its final owner write, alive
 * during Cloudflare's disconnect grace period. Await the same work normally;
 * never retry it or treat a timeout as proof that a remote write settled. */
export async function withProviderOperationLifetime<T>(key:string,work:()=>Promise<T>):Promise<T>{
  if(!key.startsWith('calendar:')&&!key.startsWith('source:'))return work();
  let retain:((task:Promise<unknown>)=>void)|undefined;
  try{retain=(await import('cloudflare:workers')).waitUntil;}catch{
    // The legacy Node runtime and local service fixtures have no Worker context.
  }
  const pending=work();
  retain?.(pending.then(()=>undefined,()=>undefined));
  return pending;
}
