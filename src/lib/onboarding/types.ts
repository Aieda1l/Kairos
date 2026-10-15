export type OnboardingStep="timezone"|"firefox"|"canvas"|"submission-status"|"gradescope"|"ed"|"calendars"|"finish";
export type IntegrationStep=Exclude<OnboardingStep,"timezone"|"finish">;
export type OnboardingState={
  version:1;
  revision:number;
  status:"active"|"deferred"|"completed";
  currentStep:OnboardingStep;
  skipped:IntegrationStep[];
  drafts:{timeZone?:string;gradescopeCourseIds?:string[];edCourseIds?:string[]};
};
export type OnboardingCommand=
  |{type:"visit";step:OnboardingStep}
  |{type:"skip";step:IntegrationStep}
  |{type:"save-draft";drafts:OnboardingState["drafts"]}
  |{type:"defer"|"resume"|"finish"};
