import {z} from 'zod';
import {D1SettingsRepository} from '@/lib/db/d1/repositories/settings';
import {D1OnboardingRepository} from '@/lib/db/d1/repositories/onboarding';
import {resolveCalendarApiRuntime} from '@/lib/platform/calendar-api-runtime';
const schema=z.object({enabled:z.boolean()}).strict();
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function handle(request?:Request){
  try{
    const resolved=await resolveCalendarApiRuntime();
    if(!resolved.ok){resolved.response.headers.set('cache-control','no-store');return resolved.response;}
    if(resolved.runtime.kind!=='hosted')throw new Error('Hosted runtime required');
    const {db,scope}=resolved.runtime;
    let enabled:boolean|undefined;
    if(request){
      // This preference is one small boolean, not a credential payload.
      const reader=request.body?.getReader();if(!reader)return json({code:'INVALID_REQUEST'},400);
      let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return json({code:'PAYLOAD_TOO_LARGE'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
      catch{return json({code:'INVALID_REQUEST'},400);}finally{reader.releaseLock();}
      let parsed;try{parsed=schema.safeParse(JSON.parse(text));}catch{return json({code:'INVALID_REQUEST'},400);}
      if(!parsed.success)return json({code:'INVALID_REQUEST'},400);enabled=parsed.data.enabled;
    }
    await new D1OnboardingRepository(db,scope).ensureInitialized();
    const settings=new D1SettingsRepository(db,scope);
    if(enabled!==undefined)await settings.setCanvasSubmissionStatusEnabled(enabled);
    return json({enabled:await settings.getCanvasSubmissionStatusEnabled()});
  }catch{return json({code:'SETTINGS_UNAVAILABLE',message:'Submission preference is temporarily unavailable.'},503);}
}
export const GET=()=>handle();
export const PUT=(request:Request)=>handle(request);
