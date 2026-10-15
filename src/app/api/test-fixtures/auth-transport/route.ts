import {localAuthFixtureStats} from '@/lib/testing/auth-transport';
import {getE2EFixtureRuntime} from '@/lib/testing/e2e-runtime';
export async function GET(request:Request){
  if(!await getE2EFixtureRuntime(request))return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  try{
    const {env}=await import('cloudflare:workers');
    const stats=localAuthFixtureStats(env as unknown as Record<string,unknown>);
    if(stats)return Response.json(stats,{headers:{'cache-control':'no-store'}});
  }catch{/* Fixture inspection is unavailable outside the isolated local runtime. */}
  return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
}
