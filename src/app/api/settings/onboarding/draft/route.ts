import {z} from "zod";
import {D1OnboardingDraftRepository} from "@/lib/db/d1/repositories/onboarding-drafts";
import {resolveCalendarApiRuntime} from "@/lib/platform/calendar-api-runtime";
import {draftJson,onboardingDraftFailure,saveOnboardingDraft,useOnboardingDraft as runOnboardingDraft} from "@/lib/onboarding/draft-service";
import {ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES,OnboardingDraftValidationError,secretDraftKindSchema,validateSecretDraft} from "@/lib/onboarding/secret-draft";
const useSchema=z.object({kind:secretDraftKindSchema,action:z.enum(["test","connect"]),connectionId:z.string().trim().min(1).max(200).optional()}).strict()
  .refine(input=>!input.connectionId||(input.kind==="caldav"&&input.action==="connect"));
const discardSchema=z.object({kind:secretDraftKindSchema}).strict();

async function readBody(request:Request):Promise<unknown|Response>{
  const tooLarge=()=>draftJson({code:"PAYLOAD_TOO_LARGE",message:"Setup input is too large."},413);
  if(Number(request.headers.get("content-length"))>ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES)return tooLarge();
  if(!request.body)throw new OnboardingDraftValidationError();
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES){await reader.cancel();return tooLarge();}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch{throw new OnboardingDraftValidationError();}
  finally{reader.releaseLock();}
}

async function handle(method:"GET"|"PUT"|"POST"|"DELETE",request?:Request):Promise<Response>{
  try{
    const resolved=await resolveCalendarApiRuntime();
    if(!resolved.ok){resolved.response.headers.set("cache-control","no-store");return resolved.response;}
    if(resolved.runtime.kind!=="hosted")throw new Error("Hosted runtime required.");
    const runtime=resolved.runtime;
    const drafts=new D1OnboardingDraftRepository(runtime.db,runtime.scope,runtime.keyring);
    if(method==="GET")return draftJson({drafts:await drafts.availability()});
    const body=await readBody(request!);if(body instanceof Response)return body;
    if(method==="PUT")return draftJson(await saveOnboardingDraft(runtime,validateSecretDraft(body)));
    if(method==="POST"){
      const parsed=useSchema.safeParse(body);if(!parsed.success)throw new OnboardingDraftValidationError();
      return runOnboardingDraft(runtime,parsed.data.kind,parsed.data.action,{connectionId:parsed.data.connectionId});
    }
    const parsed=discardSchema.safeParse(body);if(!parsed.success)throw new OnboardingDraftValidationError();
    await drafts.discard(parsed.data.kind);return draftJson({kind:parsed.data.kind,saved:false});
  }catch(error){return onboardingDraftFailure(error);}
}
export const GET=()=>handle("GET");
export const PUT=(request:Request)=>handle("PUT",request);
export const POST=(request:Request)=>handle("POST",request);
export const DELETE=(request:Request)=>handle("DELETE",request);
