import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {OnboardingCommand,OnboardingState} from "@/lib/onboarding/types";
import {D1OnboardingDraftRepository} from "./onboarding-drafts";
import {
  applyOnboardingCommand,createOnboardingState,onboardingRevisionSchema,
  onboardingStateSchema,ONBOARDING_MAX_PAYLOAD_BYTES,
  OnboardingValidationError,validateOnboardingCommand,
} from "@/lib/onboarding/state";

export class OnboardingConflictError extends Error{
  readonly code="ONBOARDING_CONFLICT";
  constructor(){super("Setup progress changed. Reload before saving again.");this.name="OnboardingConflictError";}
}

function readState(value:string):OnboardingState{
  if(new TextEncoder().encode(value).byteLength>ONBOARDING_MAX_PAYLOAD_BYTES){
    throw new Error("Invalid stored onboarding state.");
  }
  return onboardingStateSchema.parse(JSON.parse(value));
}

export class D1OnboardingRepository{
  constructor(private readonly db:D1DatabaseLike,private readonly scope:UserScope){}
  private read():Promise<{value:string}|null>{
    return this.db.prepare("SELECT value FROM app_settings WHERE user_id=? AND key='onboarding'")
      .bind(this.scope.userId).first<{value:string}>();
  }

  async ensureInitialized():Promise<OnboardingState>{
    const now=new Date().toISOString();
    // The migration's completed row is authoritative for pre-cutover users.
    // Both inserts run in a D1 transaction; concurrent calls cannot replace it
    // or expose active onboarding without its default submission preference.
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,'onboarding',?,?)
        ON CONFLICT(user_id,key) DO NOTHING
      `).bind(this.scope.userId,JSON.stringify(createOnboardingState()),now),
      this.db.prepare(`
        INSERT INTO app_settings(user_id,key,value,updated_at)
        SELECT user_id,'canvas_submission_status_enabled',
          CASE WHEN json_extract(value,'$.status')='completed' THEN '1' ELSE '0' END,?
        FROM app_settings WHERE user_id=? AND key='onboarding'
        ON CONFLICT(user_id,key) DO NOTHING
      `).bind(now,this.scope.userId),
    ]);
    const state=await this.get();
    if(!state)throw new Error("Onboarding initialization failed.");
    return state;
  }

  async get():Promise<OnboardingState|null>{
    const row=await this.read();
    return row?readState(row.value):null;
  }

  async apply(command:OnboardingCommand,expectedRevision:number):Promise<OnboardingState>{
    const input=validateOnboardingCommand(command);
    if(!onboardingRevisionSchema.safeParse(expectedRevision).success)throw new OnboardingValidationError();
    await this.ensureInitialized();
    const row=await this.read();
    if(!row)throw new OnboardingConflictError();
    const state=readState(row.value);
    if(state.revision!==expectedRevision)throw new OnboardingConflictError();
    const next=applyOnboardingCommand(state,input);
    const value=JSON.stringify(next);
    if(new TextEncoder().encode(value).byteLength>ONBOARDING_MAX_PAYLOAD_BYTES)throw new OnboardingValidationError();
    const update=this.db.prepare(`
      UPDATE app_settings SET value=?,updated_at=?
      WHERE user_id=? AND key='onboarding' AND value=?
    `).bind(value,new Date().toISOString(),this.scope.userId,row.value);
    const result=next.status==="completed"
      ?(await this.db.batch([update,new D1OnboardingDraftRepository(this.db,this.scope).prepareFinishCleanup(value)]))[0]!
      :await update.run();
    if(result.meta.changes!==1)throw new OnboardingConflictError();
    return next;
  }
}
