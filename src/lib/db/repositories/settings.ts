import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import {validateTimeZone} from "@/lib/dates/validate-timezone";
import {DEFAULT_TIME_ZONE} from "@/lib/dates/format";

export class SettingsRepository{
  constructor(private db:LegacyDatabase){}

  getTimeZone():string{
    const row=this.db.prepare("SELECT value FROM app_settings WHERE key='timezone'")
      .get() as {value:string}|undefined;
    return row?.value??DEFAULT_TIME_ZONE;
  }

  setTimeZone(timeZone:string):void{
    const value=validateTimeZone(timeZone);
    this.db.prepare(`
      INSERT INTO app_settings(key,value,updated_at)
      VALUES ('timezone',?,?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(value,new Date().toISOString());
  }

  getCalendarHideSubmitted():boolean{
    const row=this.db.prepare(
      "SELECT value FROM app_settings WHERE key='calendar_hide_submitted'",
    ).get() as {value:string}|undefined;
    return row?.value!=="0";
  }

  setCalendarHideSubmitted(hideSubmitted:boolean):void{
    this.db.prepare(`
      INSERT INTO app_settings(key,value,updated_at)
      VALUES ('calendar_hide_submitted',?,?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(hideSubmitted?"1":"0",new Date().toISOString());
  }
}
