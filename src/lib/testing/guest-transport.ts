import 'server-only';
import {isLocalFixtureEnvironment} from './auth-transport';
import {canvasFixtureResponse} from '@/lib/sources/canvas-ical/e2e-fixture-fetch';

const transports=new WeakMap<object,typeof fetch>();

/** Synthetic guest-only transport. Never falls through to the network. */
export function localGuestFixtureFetch(env:Record<string,unknown>):typeof fetch|undefined {
  if(!isLocalFixtureEnvironment(env))return undefined;
  const prior=transports.get(env);if(prior)return prior;
  const origin=new URL(String(env.KAIROS_APP_URL));
  const spent=new Set<string>();
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
      const body=init?.body instanceof URLSearchParams?init.body.toString():typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
      const params=new URLSearchParams(body),token=params.get('response')??'',secret=params.get('secret');
      if(method!=='POST'||!['synthetic-secret','1x0000000000000000000000000000000AA'].includes(secret??'')||spent.has(token)||!/^fixture-guest(?:$|-)/.test(token))return Response.json({success:false});
      spent.add(token);
      return Response.json({success:true,hostname:token.endsWith('-wrong-host')?'unexpected.invalid':origin.hostname,action:token.endsWith('-wrong-action')?'unexpected':'guest_sync'});
    }
    if(method==='GET'&&url.href==='https://canvas.uw.edu/feeds/calendars/kairos-e2e-fixture.ics')return canvasFixtureResponse();
    if(method==='GET'&&['https://us.edstem.org/api/user','https://us.edstem.org/api/courses/123/lessons'].includes(url.href)){
      const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
      if(headers.get('authorization')!=='Bearer fixture-guest-ed-token-never-echo')return Response.json({error:'unauthorized'},{status:401});
      if(url.pathname==='/api/user')return Response.json({user:{id:7},courses:[{course:{id:123,code:'CSE 331',name:'Software Design',year:'2026',session:'Autumn'},role:{role:'student'}}]});
      return Response.json({modules:[],lessons:[
        {id:10,course_id:123,title:'Ed Dated Lesson',status:'unattempted',state:'active',is_hidden:false,is_unlisted:false,effective_due_at:'2026-10-12T06:59:00.000Z',effective_available_at:'2026-10-01T17:00:00.000Z'},
        {id:11,course_id:123,title:'Ed Undated Lesson',status:'attempted',state:'active',is_hidden:false,is_unlisted:false,due_at:null,effective_available_at:'2026-10-02T17:00:00.000Z'},
      ]});
    }
    throw new Error('Unexpected local guest fixture request.');
  };
  transports.set(env,transport);return transport;
}
