import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1PreparedStatementLike} from "@/lib/db/d1/types";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
  type SecretPurpose,
} from "@/lib/security/credential-cipher";

type Row={
  canvas_feed_url_envelope:string|null;
  ed_api_token_envelope:string|null;
};

export class D1SourceCredentialRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
    private readonly keyring:CredentialKeyring,
  ){}

  private async prepareSet(
    connectionId:string,
    column:"canvas_feed_url_envelope"|"ed_api_token_envelope",
    purpose:SecretPurpose,
    plaintext:string,
  ):Promise<D1PreparedStatementLike>{
    const envelope=await encryptCredential({
      plaintext,
      userId:this.scope.userId,
      purpose,
      contextId:connectionId,
    },this.keyring);
    const at=new Date().toISOString();
    return this.db.prepare(`
      INSERT INTO source_credentials(user_id,source_connection_id,${column},updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(user_id,source_connection_id) DO UPDATE SET
        ${column}=excluded.${column},
        updated_at=excluded.updated_at
    `).bind(this.scope.userId,connectionId,envelope,at);
  }

  private async get(
    connectionId:string,
    column:keyof Row,
    purpose:SecretPurpose,
  ):Promise<string|null>{
    const row=await this.db.prepare(`
      SELECT canvas_feed_url_envelope,ed_api_token_envelope
      FROM source_credentials
      WHERE user_id=? AND source_connection_id=?
    `).bind(this.scope.userId,connectionId).first<Row>();
    const envelope=row?.[column]??null;
    if(!envelope)return null;
    return decryptCredential({
      envelope,
      userId:this.scope.userId,
      purpose,
      contextId:connectionId,
    },this.keyring);
  }

  prepareCanvasFeedUrl(connectionId:string,feedUrl:string){
    return this.prepareSet(connectionId,"canvas_feed_url_envelope","canvas_feed_url",feedUrl);
  }

  prepareEdApiToken(connectionId:string,token:string){
    return this.prepareSet(connectionId,"ed_api_token_envelope","ed_api_token",token);
  }

  async setCanvasFeedUrl(connectionId:string,feedUrl:string):Promise<void>{
    await (await this.prepareCanvasFeedUrl(connectionId,feedUrl)).run();
  }

  async setEdApiToken(connectionId:string,token:string):Promise<void>{
    await (await this.prepareEdApiToken(connectionId,token)).run();
  }

  getCanvasFeedUrl(connectionId:string){
    return this.get(connectionId,"canvas_feed_url_envelope","canvas_feed_url");
  }

  getEdApiToken(connectionId:string){
    return this.get(connectionId,"ed_api_token_envelope","ed_api_token");
  }
}
