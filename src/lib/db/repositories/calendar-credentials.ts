import "server-only";
import type Database from "better-sqlite3";

export class CalendarCredentialRepository{
  constructor(private readonly db:Database.Database){}

  setOAuthRefreshToken(connectionId:string,token:string):void{
    const at=new Date().toISOString();
    this.db.prepare(`INSERT INTO calendar_credentials(calendar_connection_id,oauth_refresh_token,updated_at)
      VALUES (?,?,?)
      ON CONFLICT(calendar_connection_id) DO UPDATE SET
        oauth_refresh_token=excluded.oauth_refresh_token,
        updated_at=excluded.updated_at`).run(connectionId,token,at);
  }

  getOAuthRefreshToken(connectionId:string):string|null{
    const row=this.db.prepare("SELECT oauth_refresh_token FROM calendar_credentials WHERE calendar_connection_id=?")
      .get(connectionId) as {oauth_refresh_token:string|null}|undefined;
    return row?.oauth_refresh_token??null;
  }

  setCaldavCredentials(connectionId:string,username:string,secret:string):void{
    const at=new Date().toISOString();
    this.db.prepare(`INSERT INTO calendar_credentials(calendar_connection_id,caldav_username,caldav_secret,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(calendar_connection_id) DO UPDATE SET
        caldav_username=excluded.caldav_username,
        caldav_secret=excluded.caldav_secret,
        updated_at=excluded.updated_at`).run(connectionId,username,secret,at);
  }

  getCaldavCredentials(connectionId:string):{username:string;secret:string}|null{
    const row=this.db.prepare("SELECT caldav_username,caldav_secret FROM calendar_credentials WHERE calendar_connection_id=?")
      .get(connectionId) as {caldav_username:string|null;caldav_secret:string|null}|undefined;
    return row?.caldav_username&&row.caldav_secret?{username:row.caldav_username,secret:row.caldav_secret}:null;
  }

  delete(connectionId:string):void{
    this.db.prepare("DELETE FROM calendar_credentials WHERE calendar_connection_id=?").run(connectionId);
  }
}
