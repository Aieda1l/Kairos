import {z} from "zod";
import {validateCanvasFeedUrl} from "@/lib/sources/canvas-ical/validate-url";

export type SecretDraft=
  |{kind:"canvas";feedUrl:string}
  |{kind:"ed";token:string}
  |{kind:"caldav";username:string;secret:string};
export const secretDraftKindSchema=z.enum(["canvas","ed","caldav"]);
export const ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES=16_384;
export const secretDraftSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("canvas"),feedUrl:z.string().trim().min(1).max(4096).refine(value=>{
    try{validateCanvasFeedUrl(value);return true;}catch{return false;}
  })}).strict(),
  z.object({kind:z.literal("ed"),token:z.string().trim().min(1).max(4096)}).strict(),
  z.object({kind:z.literal("caldav"),username:z.string().trim().min(1).max(320),secret:z.string().min(1).max(4096).refine(value=>Boolean(value.trim()))}).strict(),
]);

export class OnboardingDraftValidationError extends Error{
  readonly code="INVALID_ONBOARDING_DRAFT";
  constructor(){super("Enter valid setup credentials.");this.name="OnboardingDraftValidationError";}
}
export function validateSecretDraft(input:unknown):SecretDraft{
  const parsed=secretDraftSchema.safeParse(input);
  if(!parsed.success||new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength>ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES)throw new OnboardingDraftValidationError();
  return parsed.data;
}
