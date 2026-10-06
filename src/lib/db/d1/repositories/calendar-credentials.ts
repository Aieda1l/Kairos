import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarProvider} from "@/lib/calendar/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
  type SecretPurpose,
} from "@/lib/security/credential-cipher";

type Row={
  oauth_refresh_token_envelope:string|null;
  caldav_username:string|null;
  caldav_secret_envelope:string|null;
};

export class D1CalendarCredentialRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
    private readonly keyring:CredentialKeyring,
  ){}

  private async provider(connectionId:string):Promise<CalendarProvider|null>{
    const row=await this.db.prepare(`
      SELECT provider FROM calendar_connections WHERE user_id=? AND id=?
    `).bind(this.scope.userId,connectionId).first<{provider:CalendarProvider}>();
    return row?.provider??null;
  }

  private oauthPurpose(provider:CalendarProvider|null):SecretPurpose{
    return provider==="microsoft"?"microsoft_refresh_token":"google_refresh_token";
  }

  async setOAuthRefreshToken(connectionId:string,token:string):Promise<void>{
    const provider=await this.provider(connectionId);
    if(provider==="caldav"){
      throw new Error("OAuth refresh tokens require a Google or Microsoft calendar connection.");
    }
    const purpose=this.oauthPurpose(provider);
    const envelope=await encryptCredential({
      plaintext:token,
      userId:this.scope.userId,
      purpose,
      contextId:connectionId,
    },this.keyring);
    const at=new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO calendar_credentials(
        user_id,calendar_connection_id,oauth_refresh_token_envelope,updated_at
      ) VALUES (?,?,?,?)
      ON CONFLICT(user_id,calendar_connection_id) DO UPDATE SET
        oauth_refresh_token_envelope=excluded.oauth_refresh_token_envelope,
        updated_at=excluded.updated_at
    `).bind(this.scope.userId,connectionId,envelope,at).run();
  }

  async getOAuthRefreshToken(connectionId:string):Promise<string|null>{
    const provider=await this.provider(connectionId);
    if(!provider || provider==="caldav")return null;
    const row=await this.db.prepare(`
      SELECT oauth_refresh_token_envelope,caldav_username,caldav_secret_envelope
      FROM calendar_credentials WHERE user_id=? AND calendar_connection_id=?
    `).bind(this.scope.userId,connectionId).first<Row>();
    const envelope=row?.oauth_refresh_token_envelope??null;
    if(!envelope)return null;
    return decryptCredential({
      envelope,
      userId:this.scope.userId,
      purpose:this.oauthPurpose(provider),
      contextId:connectionId,
    },this.keyring);
  }

  async setCaldavCredentials(
    connectionId:string,
    username:string,
    secret:string,
  ):Promise<void>{
    const envelope=await encryptCredential({
      plaintext:secret,
      userId:this.scope.userId,
      purpose:"caldav_secret",
      contextId:connectionId,
    },this.keyring);
    const at=new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO calendar_credentials(
        user_id,calendar_connection_id,caldav_username,caldav_secret_envelope,updated_at
      ) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,calendar_connection_id) DO UPDATE SET
        caldav_username=excluded.caldav_username,
        caldav_secret_envelope=excluded.caldav_secret_envelope,
        updated_at=excluded.updated_at
    `).bind(this.scope.userId,connectionId,username,envelope,at).run();
  }

  async getCaldavCredentials(
    connectionId:string,
  ):Promise<{username:string;secret:string}|null>{
    const row=await this.db.prepare(`
      SELECT oauth_refresh_token_envelope,caldav_username,caldav_secret_envelope
      FROM calendar_credentials WHERE user_id=? AND calendar_connection_id=?
    `).bind(this.scope.userId,connectionId).first<Row>();
    if(!row?.caldav_username || !row.caldav_secret_envelope)return null;
    const secret=await decryptCredential({
      envelope:row.caldav_secret_envelope,
      userId:this.scope.userId,
      purpose:"caldav_secret",
      contextId:connectionId,
    },this.keyring);
    return {username:row.caldav_username,secret};
  }

  async delete(connectionId:string):Promise<void>{
    await this.db.prepare(`
      DELETE FROM calendar_credentials WHERE user_id=? AND calendar_connection_id=?
    `).bind(this.scope.userId,connectionId).run();
  }
}
