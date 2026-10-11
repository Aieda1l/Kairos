import {z} from "zod";
import {validateTimeZone} from "@/lib/dates/validate-timezone";
import type {OnboardingCommand,OnboardingState} from "./types";

export const ONBOARDING_MAX_PAYLOAD_BYTES=16_384;
export const onboardingRevisionSchema=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stepSchema=z.enum(["timezone","firefox","canvas","submission-status","gradescope","ed","calendars","finish"]);
const integrationStepSchema=z.enum(["firefox","canvas","submission-status","gradescope","ed","calendars"]);
const courseIdSchema=z.string().regex(/^\d+$/).max(20);
const courseIds=(max:number)=>z.array(courseIdSchema).max(max).refine(
  values=>new Set(values).size===values.length,"Course identifiers must be unique.",
);
const draftsSchema=z.object({
  timeZone:z.string().trim().min(1).max(100).refine(value=>{
    if(/^[+-]/.test(value))return false;
    try{validateTimeZone(value);return true;}catch{return false;}
  },"Choose a valid IANA timezone.").optional(),
  gradescopeCourseIds:courseIds(50).optional(),
  edCourseIds:courseIds(100).optional(),
}).strict();

export const onboardingCommandSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("visit"),step:stepSchema}).strict(),
  z.object({type:z.literal("skip"),step:integrationStepSchema}).strict(),
  z.object({type:z.literal("save-draft"),drafts:draftsSchema}).strict(),
  z.object({type:z.literal("defer")}).strict(),
  z.object({type:z.literal("resume")}).strict(),
  z.object({type:z.literal("finish")}).strict(),
]);
export const onboardingStateSchema=z.object({
  version:z.literal(1),revision:onboardingRevisionSchema,
  status:z.enum(["active","deferred","completed"]),currentStep:stepSchema,
  skipped:z.array(integrationStepSchema).max(6).refine(values=>new Set(values).size===values.length),
  drafts:draftsSchema,
}).strict().refine(state=>state.status!=="completed"||state.currentStep==="finish");

export class OnboardingValidationError extends Error{
  readonly code="INVALID_ONBOARDING_COMMAND";
  constructor(){super("Choose valid setup progress.");this.name="OnboardingValidationError";}
}

export function validateOnboardingCommand(command:OnboardingCommand):OnboardingCommand{
  const parsed=onboardingCommandSchema.safeParse(command);
  if(!parsed.success)throw new OnboardingValidationError();
  return parsed.data;
}

export function createOnboardingState():OnboardingState{
  return {version:1,revision:0,status:"active",currentStep:"timezone",skipped:[],drafts:{}};
}
export function applyOnboardingCommand(state:OnboardingState,command:OnboardingCommand):OnboardingState{
  const current=onboardingStateSchema.parse(state);
  const input=validateOnboardingCommand(command);
  if(current.revision===Number.MAX_SAFE_INTEGER)throw new OnboardingValidationError();
  const next:OnboardingState={...current,revision:current.revision+1};
  // Completion is terminal. Even a delayed resume/visit consumes its revision
  // without reopening setup or overwriting the completed user's drafts.
  if(current.status==="completed")return next;
  switch(input.type){
    case "visit":next.currentStep=input.step;break;
    case "skip":next.skipped=[...new Set([...current.skipped,input.step])];break;
    case "save-draft":next.drafts={...current.drafts,...input.drafts};break;
    case "defer":next.status="deferred";break;
    case "resume":next.status="active";break;
    case "finish":next.status="completed";next.currentStep="finish";break;
  }
  return next;
}
