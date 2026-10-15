import {describe,expect,it} from "vitest";
import {applyOnboardingCommand,createOnboardingState,onboardingCommandSchema,onboardingStateSchema} from "@/lib/onboarding/state";
import type {OnboardingCommand,OnboardingState} from "@/lib/onboarding/types";

describe("onboarding progress",()=>{
  it("back_and_resume_preserve_drafts_and_skips",()=>{
    let state=createOnboardingState();
    state=applyOnboardingCommand(state,{type:"save-draft",drafts:{timeZone:"Asia/Kolkata",gradescopeCourseIds:["42"]}});
    state=applyOnboardingCommand(state,{type:"skip",step:"firefox"});
    state=applyOnboardingCommand(state,{type:"visit",step:"canvas"});
    state=applyOnboardingCommand(state,{type:"defer"});
    expect(state).toMatchObject({revision:4,status:"deferred",currentStep:"canvas",skipped:["firefox"]});
    state=applyOnboardingCommand(state,{type:"resume"});
    state=applyOnboardingCommand(state,{type:"visit",step:"timezone"});
    state=applyOnboardingCommand(state,{type:"save-draft",drafts:{edCourseIds:["9"]}});
    expect(state).toEqual({version:1,revision:7,status:"active",currentStep:"timezone",skipped:["firefox"],drafts:{timeZone:"Asia/Kolkata",gradescopeCourseIds:["42"],edCourseIds:["9"]}});
  });

  it("skip_is_unique_and_preserves_inputs_without_mutating_prior_state",()=>{
    const initial:OnboardingState={...createOnboardingState(),drafts:{edCourseIds:["9"]}};
    const skipped=applyOnboardingCommand(initial,{type:"skip",step:"ed"});
    const again=applyOnboardingCommand(skipped,{type:"skip",step:"ed"});
    expect(again.skipped).toEqual(["ed"]);
    expect(again.drafts).toEqual({edCourseIds:["9"]});
    expect(initial).toMatchObject({revision:0,skipped:[]});
  });

  it("finish_requires_no_connected_integration",()=>{
    expect(applyOnboardingCommand(createOnboardingState(),{type:"finish"})).toEqual({
      version:1,revision:1,status:"completed",currentStep:"finish",skipped:[],drafts:{},
    });
  });

  it.each<OnboardingCommand>([{type:"resume"},{type:"defer"},{type:"visit",step:"canvas"},{type:"skip",step:"ed"},{type:"save-draft",drafts:{timeZone:"UTC"}}])("completed_state_cannot_reopen_accidentally: %j",command=>{
    const completed:OnboardingState={version:1,revision:2,status:"completed",currentStep:"finish",skipped:[],drafts:{}};
    expect(applyOnboardingCommand(completed,command)).toMatchObject({status:"completed",currentStep:"finish",drafts:{}});
  });

  it.each([
    {type:"skip",step:"timezone"},{type:"skip",step:"finish"},{type:"visit",step:"unknown"},
    {type:"save-draft",drafts:{timeZone:"not/a-zone"}},
    {type:"save-draft",drafts:{gradescopeCourseIds:["https://example.invalid/private"]}},
    {type:"save-draft",drafts:{edCourseIds:["1","1"]}},
    {type:"save-draft",drafts:{edCourseIds:["1".repeat(21)]}},
    {type:"save-draft",drafts:{gradescopeCourseIds:Array.from({length:51},(_,i)=>String(i))}},
    {type:"save-draft",drafts:{edCourseIds:Array.from({length:101},(_,i)=>String(i))}},
    {type:"save-draft",drafts:{feedUrl:"fixture-private-feed"}},
    {type:"save-draft",drafts:{token:"fixture-private-token"}},
    {type:"finish",secret:"fixture-private-secret"},
  ])("rejects_invalid_or_private_command: %j",command=>{
    expect(onboardingCommandSchema.safeParse(command).success).toBe(false);
  });

  it("accepts_valid_nonpreset_timezone_and_bounded_decimal_course_ids",()=>{
    expect(onboardingCommandSchema.safeParse({type:"save-draft",drafts:{timeZone:"Asia/Kolkata",gradescopeCourseIds:["42"],edCourseIds:["9"]}}).success).toBe(true);
  });

  it("rejects_corrupt_or_secret_bearing_stored_state",()=>{
    for(const value of [
      {...createOnboardingState(),version:2},
      {...createOnboardingState(),revision:-1},
      {...createOnboardingState(),revision:Number.MAX_SAFE_INTEGER+1},
      {...createOnboardingState(),drafts:{token:"fixture-token"}},
      {...createOnboardingState(),skipped:["timezone"]},
    ])expect(onboardingStateSchema.safeParse(value).success).toBe(false);
  });
});
