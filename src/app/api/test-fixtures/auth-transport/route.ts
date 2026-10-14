import {localAuthFixtureStats} from '@/lib/testing/auth-transport';
export async function GET(){
  try{
    const {env}=await import('cloudflare:workers');
    const stats=localAuthFixtureStats(env as unknown as Record<string,unknown>);
    if(stats)return Response.json(stats,{headers:{'cache-control':'no-store'}});
  }catch{/* Fixture inspection is unavailable outside the isolated local runtime. */}
  return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
}
