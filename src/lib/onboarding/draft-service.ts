import "server-only";
import {withProviderService} from "@/lib/abuse/provider-operation";
import {abuseErrorResponse} from "@/lib/abuse/guard";
import {D1OnboardingDraftRepository} from "@/lib/db/d1/repositories/onboarding-drafts";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import type {SourceRuntimeContext} from "@/lib/platform/source-runtime";
import {connectCanvas,testCanvasConnection} from "@/lib/sources/canvas-ical/connection-service";
import {connectEd,testEdConnection} from "@/lib/ed/discovery-service";
import {connectCaldavCalendar,testCaldavCredentials} from "@/lib/calendar/connection-service";
import {CanvasFeedUrlError} from "@/lib/sources/canvas-ical/validate-url";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {EdSourceError} from "@/lib/sources/ed/errors";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {OnboardingConflictError} from "@/lib/db/d1/repositories/onboarding";
import {OnboardingDraftValidationError,secretDraftKindSchema,type SecretDraft} from "./secret-draft";
export type {SecretDraft} from "./secret-draft";

export const draftJson=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export function onboardingDraftFailure(error:unknown):Response{
  const admission=abuseErrorResponse(error);if(admission)return admission;
  if(error instanceof OnboardingConflictError)return draftJson({code:error.code,message:error.message},409);
  if(error instanceof OnboardingDraftValidationError)return draftJson({code:error.code,message:error.message},400);
  // Stored-input/decryption failures are deliberately indistinguishable.
  return draftJson({code:"ONBOARDING_DRAFT_UNAVAILABLE",message:"Saved setup input is temporarily unavailable."},503);
}
export function saveOnboardingDraft(runtime:SourceRuntimeContext,draft:SecretDraft):Promise<{kind:SecretDraft["kind"];saved:true}>{
  return new D1OnboardingDraftRepository(runtime.db,runtime.scope,runtime.keyring).save(draft);
}

export async function useOnboardingDraft(runtime:SourceRuntimeContext,kind:SecretDraft["kind"],action:"test"|"connect",options:{connectionId?:string}={}):Promise<Response>{
  if(!secretDraftKindSchema.safeParse(kind).success||!["test","connect"].includes(action)
    ||(options.connectionId!==undefined&&(kind!=="caldav"||action!=="connect"||!options.connectionId.trim()||options.connectionId.length>200)))return onboardingDraftFailure(new OnboardingDraftValidationError());
  const {db,scope,keyring}=runtime;
  try{
    if(options.connectionId){
      const connection=await new D1CalendarConnectionRepository(db,scope).getById(options.connectionId);
      if(!connection||connection.provider!=="caldav")return draftJson({code:"CALENDAR_CONFIG_MISSING",message:"Calendar connection was not found."},404);
    }
    const drafts=new D1OnboardingDraftRepository(db,scope,keyring);
    if(await drafts.envelope(kind)===null)return draftJson({code:"ONBOARDING_DRAFT_NOT_FOUND",message:"No saved input is available for this source."},404);
    return await withProviderService(db,scope,{provider:kind,operation:"credential",...(options.connectionId?{resourceId:options.connectionId}:{})},async()=>{
      const selected=await drafts.read(kind);
      if(!selected)return draftJson({code:"ONBOARDING_DRAFT_NOT_FOUND",message:"No saved input is available for this source."},404);
      const {draft,envelope}=selected;
      try{
        switch(draft.kind){
          case "canvas":{
            if(action==="connect"){
              const {connection}=await connectCanvas(runtime,{feedUrl:draft.feedUrl},envelope);
              return draftJson({kind,connected:true,connection:{id:connection.id}});
            }
            const result=await testCanvasConnection(runtime,draft.feedUrl);
            return result.ok?draftJson(result):draftJson({ok:false,code:result.code,message:"Canvas could not be tested. Check the saved input."},result.code==="UNAUTHORIZED_OR_EXPIRED_FEED"?401:422);
          }
          case "ed":{
            if(action==="test")return draftJson(await testEdConnection(db,scope,draft.token));
            const {connection}=await connectEd(db,scope,keyring,draft.token,undefined,undefined,envelope);
            return draftJson({kind,connected:true,connection:{id:connection.id}});
          }
          case "caldav":{
            if(action==="test")return draftJson({ok:true,...await testCaldavCredentials(db,scope,draft.username,draft.secret)});
            const connection=await connectCaldavCalendar(db,scope,keyring,{username:draft.username,secret:draft.secret,...options},envelope);
            return draftJson({kind,connected:true,connection:{id:connection.id}});
          }
        }
      }catch(error){
        const admission=abuseErrorResponse(error);if(admission)return admission;
        if(error instanceof CanvasFeedUrlError)return draftJson({code:error.code,message:"Enter a valid UW Canvas feed URL."},400);
        if(error instanceof CanvasSourceError)return draftJson({code:error.code,message:"Canvas could not use the saved input."},error.code==="UNAUTHORIZED_OR_EXPIRED_FEED"?401:422);
        if(error instanceof EdSourceError)return draftJson({code:error.code,message:"Ed could not use the saved input."},error.code==="ED_AUTH_INVALID"?401:502);
        if(error instanceof CalendarSyncError)return draftJson({code:error.code,message:"Apple Calendar could not use the saved input."},["CALENDAR_AUTH_EXPIRED","CALENDAR_AUTH_REQUIRED"].includes(error.code)?401:error.code==="CALENDAR_CONFIG_MISSING"?404:502);
        return draftJson({code:"CONNECTION_FAILED",message:"Saved setup input could not be used. Try again."},502);
      }
    });
  }catch(error){return onboardingDraftFailure(error);}
}
