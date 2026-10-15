import "server-only";
import {AbuseStorageUnavailableError,type ControlKey} from "@/lib/abuse/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

export const CONTROL_KEYS:readonly ControlKey[]=Object.freeze([
  "auth:initiation","auth:google","auth:microsoft-entra-id",
  "provider:canvas","provider:gradescope","provider:ed","provider:google","provider:microsoft","provider:caldav",
]);
export class D1AbuseControlRepository{
  constructor(private readonly db:D1DatabaseLike){}
  /** Internal operator API only; no request supplies a control or version. */
  async setEnabled(key:ControlKey,enabled:boolean):Promise<void>{
    try{
      if(!CONTROL_KEYS.includes(key)||typeof enabled!=="boolean")throw new AbuseStorageUnavailableError();
      await this.db.prepare(`UPDATE abuse_controls SET enabled=?,version=version+1,
        updated_at_ms=CAST(strftime('%s','now') AS INTEGER)*1000
        WHERE control_key=? AND enabled<>? AND version<9007199254740991`)
        .bind(enabled?1:0,key,enabled?1:0).run();
      if((await this.get(key)).enabled!==enabled)throw new AbuseStorageUnavailableError();
    }catch{throw new AbuseStorageUnavailableError();}
  }
  async get(key:ControlKey):Promise<{enabled:boolean;version:number}>{
    try{
      if(!CONTROL_KEYS.includes(key))throw new AbuseStorageUnavailableError();
      const row=await this.db.prepare("SELECT enabled,version FROM abuse_controls WHERE control_key=?")
        .bind(key).first<{enabled:number;version:number}>();
      if(!row||(row.enabled!==0&&row.enabled!==1)||!Number.isSafeInteger(row.version)||row.version<0)throw new AbuseStorageUnavailableError();
      return {enabled:row.enabled===1,version:row.version};
    }catch{throw new AbuseStorageUnavailableError();}
  }
}
