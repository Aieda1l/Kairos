const active=new Set<string>();export function acquireSyncLock(key:string):(()=>void)|null{if(active.has(key))return null;active.add(key);return()=>active.delete(key);}
