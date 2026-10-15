import {z} from "zod";
import {D1OnboardingRepository,OnboardingConflictError} from "@/lib/db/d1/repositories/onboarding";
import {
  onboardingCommandSchema,onboardingRevisionSchema,
  ONBOARDING_MAX_PAYLOAD_BYTES,OnboardingValidationError,
} from "@/lib/onboarding/state";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";

const patchSchema=z.object({command:onboardingCommandSchema,expectedRevision:onboardingRevisionSchema}).strict();
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const invalid=()=>json({code:"INVALID_ONBOARDING_COMMAND",message:"Choose valid setup progress."},400);
const tooLarge=()=>json({code:"PAYLOAD_TOO_LARGE",message:"Setup progress is too large."},413);
function failure(error:unknown):Response{
  if(error instanceof OnboardingConflictError)return json({code:error.code,message:error.message},409);
  if(error instanceof OnboardingValidationError)return invalid();
  return json({code:"ONBOARDING_UNAVAILABLE",message:"Setup progress is temporarily unavailable."},503);
}

export async function GET(){
  try{
    const resolved=await resolveCalendarApiRuntime();
    if(!resolved.ok){resolved.response.headers.set("cache-control","no-store");return resolved.response;}
    if(resolved.runtime.kind!=="hosted")throw new Error("Hosted runtime required.");
    const {db,scope}=resolved.runtime;
    return json({state:await new D1OnboardingRepository(db,scope).ensureInitialized()});
  }catch(error){return failure(error);}
}

export async function PATCH(request:Request){
  try{
    const resolved=await resolveCalendarApiRuntime();
    if(!resolved.ok){resolved.response.headers.set("cache-control","no-store");return resolved.response;}
    if(resolved.runtime.kind!=="hosted")throw new Error("Hosted runtime required.");
    if(Number(request.headers.get("content-length"))>ONBOARDING_MAX_PAYLOAD_BYTES)return tooLarge();
    if(!request.body)return invalid();
    const reader=request.body.getReader();
    const chunks:Uint8Array[]=[];
    let size=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>ONBOARDING_MAX_PAYLOAD_BYTES){await reader.cancel();return tooLarge();}
        chunks.push(value);
      }
    }catch{return invalid();}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let body:unknown;
    try{body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
    catch{return invalid();}
    const parsed=patchSchema.safeParse(body);
    if(!parsed.success)return invalid();
    const {db,scope}=resolved.runtime;
    return json({state:await new D1OnboardingRepository(db,scope)
      .apply(parsed.data.command,parsed.data.expectedRevision)});
  }catch(error){return failure(error);}
}
