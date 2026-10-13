import {abuseErrorResponse} from '@/lib/abuse/guard';
import {startSyncAll} from '@/lib/abuse/sync-all';
import {getAbuseRuntime} from '@/lib/platform/abuse-runtime';
import {resolveSourceApiRuntime} from '@/lib/platform/source-api-runtime';

export async function POST(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok){resolved.response.headers.set('Cache-Control','no-store');return resolved.response;}
  try{
    if(resolved.runtime.kind!=='hosted')return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
    const runtime={...await getAbuseRuntime(),db:resolved.runtime.db};
    return Response.json(await startSyncAll(runtime,resolved.runtime.scope),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return abuseErrorResponse(error)??Response.json({code:'SERVICE_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
