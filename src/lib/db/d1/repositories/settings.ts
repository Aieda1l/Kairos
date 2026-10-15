import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {DEFAULT_TIME_ZONE} from "@/lib/dates/format";
import {validateTimeZone} from "@/lib/dates/validate-timezone";

export class D1SettingsRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  private async get(key:string):Promise<string|null>{
    const row=await this.db.prepare(
      "SELECT value FROM app_settings WHERE user_id=? AND key=?",
    ).bind(this.scope.userId,key).first<{value:string}>();
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

  async setTimeZone(timeZone:string):Promise<void>{
    await this.set("timezone",validateTimeZone(timeZone));
  }

  async getCalendarHideSubmitted():Promise<boolean>{
    return (await this.get("calendar_hide_submitted"))!=="0";
  }

  setCalendarHideSubmitted(hideSubmitted:boolean):Promise<void>{
    return this.set("calendar_hide_submitted",hideSubmitted?"1":"0");
  }
}
