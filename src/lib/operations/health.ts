import 'server-only';
import type {D1DatabaseLike} from '@/lib/db/d1/types';

export async function checkServiceHealth(db:D1DatabaseLike):Promise<'ok'|'unavailable'>{
  if(!db||typeof db.prepare!=='function')return 'unavailable';
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<'unavailable'>(resolve=>{timer=setTimeout(()=>resolve('unavailable'),3000);});
  // Rejection handling remains attached if the query finishes after the deadline.
  // D1 supplies no cancellation guarantee; this is a response deadline only.
  const query=Promise.resolve().then(()=>db.prepare('SELECT 1 AS ok').first<{ok:unknown}>())
    .then((row):'ok'|'unavailable'=>row?.ok===1?'ok':'unavailable',()=>'unavailable' as const);
  try{return await Promise.race([query,deadline]);}finally{clearTimeout(timer);}
}
