import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1Read} from "@/lib/db/d1/types";
import {DEFAULT_TIME_ZONE} from "@/lib/dates/format";
import {validateTimeZone} from "@/lib/dates/validate-timezone";

export class D1SettingsRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  private prepareGet(key:string){
    return this.db.prepare(
      "SELECT value FROM app_settings WHERE user_id=? AND key=?",
    ).bind(this.scope.userId,key);
  }

  private async get(key:string):Promise<string|null>{
    const row=await this.prepareGet(key).first<{value:string}>();
    return row?.value??null;
  }

  private async set(key:string,value:string):Promise<void>{
    await this.db.prepare(`
      INSERT INTO app_settings(user_id,key,value,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(user_id,key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).bind(this.scope.userId,key,value,new Date().toISOString()).run();
  }

  async getTimeZone():Promise<string>{
    return (await this.get("timezone"))??DEFAULT_TIME_ZONE;
  }

  async getCanvasSubmissionStatusEnabled():Promise<boolean>{
    return (await this.get("canvas_submission_status_enabled"))!=="0";
  }

  setCanvasSubmissionStatusEnabled(enabled:boolean):Promise<void>{
    return this.set("canvas_submission_status_enabled",enabled?"1":"0");
  }

  async setTimeZone(timeZone:string):Promise<void>{
    await this.set("timezone",validateTimeZone(timeZone));
  }

  async getCalendarHideSubmitted():Promise<boolean>{
    return (await this.get("calendar_hide_submitted"))!=="0";
  }

  prepareCalendarHideSubmitted():D1Read<boolean>{
    return {
      statement:this.prepareGet("calendar_hide_submitted"),
      read:result=>result.results[0]?.value!=="0",
    };
  }

  setCalendarHideSubmitted(hideSubmitted:boolean):Promise<void>{
    return this.set("calendar_hide_submitted",hideSubmitted?"1":"0");
  }
}
