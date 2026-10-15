import {checkServiceHealth} from '@/lib/operations/health';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {createOperationContext} from '@/lib/operations/context';
import {emitOperationEvent} from '@/lib/operations/events';

export async function GET(){
  const context=createOperationContext('health.check');
  let status:'ok'|'unavailable'='unavailable';
  try{
    const {env}=await import('cloudflare:workers');
    status=await checkServiceHealth((env as unknown as Record<string,unknown>).DB as D1DatabaseLike);
  }catch{/* Health responses never expose binding or failure details. */}
  const code=status==='ok'?200:503;
  emitOperationEvent(context,{code:status==='ok'?'HEALTH_OK':'SERVICE_UNAVAILABLE',result:status==='ok'?'ok':'error',status:code});
  return Response.json({status},{status:code,headers:{'Cache-Control':'no-store'}});
}
